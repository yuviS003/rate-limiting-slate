/**
 * PHASE 1 — Rate limiting with nothing but JavaScript.
 *
 * No Redis. No database. No npm install. Every limiter here is a Map plus
 * arithmetic, and every one of them is a complete, working implementation of
 * an algorithm that real APIs run in production.
 *
 * Each limiter takes an explicit `now` so the behaviour is testable without
 * sleeping. In real code you would default it to Date.now().
 */

function positive(name, value, { integer = false } = {}) {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
    throw new RangeError(`${name} must be ${integer ? "a positive safe integer" : "finite and > 0"}`);
  }
}

function timestamp(value) {
  if (!Number.isFinite(value)) throw new RangeError("now must be a finite timestamp");
}

// ---------------------------------------------------------------------------
// 1. FIXED WINDOW
// "How many requests have you made since the top of the minute?"
// ---------------------------------------------------------------------------
export function createFixedWindow({ limit = 100, windowMs = 60_000 } = {}) {
  positive("limit", limit, { integer: true });
  positive("windowMs", windowMs);
  const state = new Map(); // key -> { window, count }

  return function check(key, now = Date.now()) {
    timestamp(now);
    const window = Math.floor(now / windowMs);
    const entry = state.get(key);

    if (!entry || entry.window !== window) {
      state.set(key, { window, count: 1 });
      return { allowed: true, remaining: limit - 1, resetMs: (window + 1) * windowMs - now };
    }

    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      resetMs: (window + 1) * windowMs - now,
    };
  };
}

// ---------------------------------------------------------------------------
// 2. SLIDING WINDOW LOG
// Keep every timestamp. Exact, and the memory bill scales with traffic.
// ---------------------------------------------------------------------------
export function createSlidingWindowLog({ limit = 100, windowMs = 60_000 } = {}) {
  positive("limit", limit, { integer: true });
  positive("windowMs", windowMs);
  const state = new Map(); // key -> number[] of timestamps

  return function check(key, now = Date.now()) {
    timestamp(now);
    const cutoff = now - windowMs;
    const log = (state.get(key) ?? []).filter((t) => t > cutoff);

    if (log.length >= limit) {
      state.set(key, log);
      // the oldest request in the window is the one that has to age out
      return { allowed: false, remaining: 0, resetMs: log[0] - cutoff };
    }

    log.push(now);
    state.set(key, log);
    return { allowed: true, remaining: limit - log.length, resetMs: windowMs };
  };
}

// ---------------------------------------------------------------------------
// 3. SLIDING WINDOW COUNTER
// Cloudflare's trick: approximate the log with two integers by weighting the
// previous window by how far you have slid out of it.
// ---------------------------------------------------------------------------
export function createSlidingWindowCounter({ limit = 100, windowMs = 60_000 } = {}) {
  positive("limit", limit, { integer: true });
  positive("windowMs", windowMs);
  const state = new Map(); // key -> { window, count, prevCount }

  return function check(key, now = Date.now()) {
    timestamp(now);
    const window = Math.floor(now / windowMs);
    let entry = state.get(key);

    if (!entry) {
      entry = { window, count: 0, prevCount: 0 };
    } else if (entry.window !== window) {
      // slid forward: last window's count becomes the "previous", unless we
      // skipped a whole window, in which case there is no history to carry
      entry = {
        window,
        count: 0,
        prevCount: entry.window === window - 1 ? entry.count : 0,
      };
    }

    // how far into the current window are we, 0..1
    const elapsed = (now % windowMs) / windowMs;
    const estimate = entry.prevCount * (1 - elapsed) + entry.count;

    if (estimate + 1 > limit) {
      state.set(key, entry);
      return {
        allowed: false,
        remaining: 0,
        estimate,
        windowBoundaryMs: windowMs - (now % windowMs),
      };
    }

    entry.count += 1;
    state.set(key, entry);
    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(limit - estimate - 1)),
      estimate,
      windowBoundaryMs: windowMs - (now % windowMs),
    };
  };
}

// ---------------------------------------------------------------------------
// 4. TOKEN BUCKET
// Refill lazily on read. No timers, no background drip.
// ---------------------------------------------------------------------------
export function createTokenBucket({ capacity = 10, refillPerSec = 2 } = {}) {
  positive("capacity", capacity);
  positive("refillPerSec", refillPerSec);
  const state = new Map(); // key -> { tokens, last }

  return function check(key, now = Date.now(), cost = 1) {
    timestamp(now);
    positive("cost", cost);
    if (cost > capacity) {
      return { allowed: false, reason: "cost_exceeds_capacity", tokens: null, retryAfterMs: null };
    }
    const b = state.get(key) ?? { tokens: capacity, last: now };

    // Never persist an older timestamp. Alternating slow and correct clocks
    // would otherwise mint refill credit without real time advancing.
    const effectiveNow = Math.max(now, b.last);
    const elapsedSec = (effectiveNow - b.last) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
    b.last = effectiveNow;

    const allowed = b.tokens >= cost;
    if (allowed) b.tokens -= cost;
    state.set(key, b);

    return {
      allowed,
      tokens: b.tokens,
      retryAfterMs: allowed ? 0 : Math.ceil(((cost - b.tokens) / refillPerSec) * 1000),
    };
  };
}

// ---------------------------------------------------------------------------
// 5. LEAKY BUCKET (virtual queue admission)
// Nothing is rejected until the virtual queue is full. The returned delay is
// only advice: a caller/scheduler must honor it to flatten downstream traffic.
// ---------------------------------------------------------------------------
export function createLeakyBucket({ queueSize = 10, leakPerSec = 2 } = {}) {
  positive("queueSize", queueSize, { integer: true });
  positive("leakPerSec", leakPerSec);
  const state = new Map(); // key -> { queued, last }

  return function check(key, now = Date.now()) {
    timestamp(now);
    const b = state.get(key) ?? { queued: 0, last: now };
    const effectiveNow = Math.max(now, b.last);

    // This is virtual queue admission: the caller must actually honor delayMs
    // (or use a scheduler) for downstream traffic to become smooth.
    const leaked = ((effectiveNow - b.last) / 1000) * leakPerSec;
    b.queued = Math.max(0, b.queued - leaked);
    b.last = effectiveNow;

    if (b.queued + 1 > queueSize) {
      state.set(key, b);
      return { allowed: false, queued: b.queued, delayMs: 0 };
    }

    // position in the queue decides how long this request waits
    const delayMs = Math.round((b.queued / leakPerSec) * 1000);
    b.queued += 1;
    state.set(key, b);

    return { allowed: true, queued: b.queued, delayMs };
  };
}

// ---------------------------------------------------------------------------
// 6. GCRA (Generic Cell Rate Algorithm)
// Borrowed from ATM network scheduling. Stores ONE number per key: the
// theoretical arrival time of the next permitted request. Smooth like a leaky
// bucket, burst-tolerant like a token bucket, and cheap like a fixed window.
// ---------------------------------------------------------------------------
export function createGCRA({ limit = 10, periodMs = 1000, burst = 5 } = {}) {
  positive("limit", limit);
  positive("periodMs", periodMs);
  positive("burst", burst, { integer: true });
  const state = new Map(); // key -> tat (theoretical arrival time, ms)

  const emissionInterval = periodMs / limit;     // minimum spacing per request
  const delayTolerance = emissionInterval * burst; // how far ahead you may run

  return function check(key, now = Date.now(), cost = 1) {
    timestamp(now);
    positive("cost", cost);
    if (cost > burst) {
      return { allowed: false, reason: "cost_exceeds_burst", retryAfterMs: null, remaining: 0 };
    }
    const tat = Math.max(state.get(key) ?? now, now);
    const newTat = tat + emissionInterval * cost;
    const allowAt = newTat - delayTolerance;

    if (now < allowAt) {
      return {
        allowed: false,
        retryAfterMs: Math.ceil(allowAt - now),
        remaining: 0,
      };
    }

    state.set(key, newTat);
    return {
      allowed: true,
      retryAfterMs: 0,
      // how much burst budget is left, in whole requests
      remaining: Math.max(0, Math.floor((now + delayTolerance - newTat) / emissionInterval)),
    };
  };
}

export const ALGORITHMS = {
  fixedWindow: createFixedWindow,
  slidingWindowLog: createSlidingWindowLog,
  slidingWindowCounter: createSlidingWindowCounter,
  tokenBucket: createTokenBucket,
  leakyBucket: createLeakyBucket,
  gcra: createGCRA,
};
