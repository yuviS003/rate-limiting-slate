/**
 * PHASE 4a — Local concurrency limiting.
 *
 * Scope is explicit: this protects one Node process. A cross-pod concurrency
 * limit needs owner routing or leased slots with TTL/heartbeat/fencing; a bare
 * Redis INCR leaks capacity when a pod dies.
 */

export function createConcurrencyLimiter({
  maxInFlight = 20,
  maxQueue = 0,          // per key
  maxTotalQueued = 1000, // stop many keys from defeating the per-key bound
} = {}) {
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight <= 0) throw new RangeError("maxInFlight must be > 0");
  if (!Number.isSafeInteger(maxQueue) || maxQueue < 0) throw new RangeError("maxQueue must be >= 0");
  if (!Number.isSafeInteger(maxTotalQueued) || maxTotalQueued < 0) throw new RangeError("maxTotalQueued must be >= 0");

  const inFlight = new Map();
  const queues = new Map();
  let totalQueued = 0;
  const current = (key) => inFlight.get(key) ?? 0;

  function makeSlot(key, increment = true) {
    if (increment) inFlight.set(key, current(key) + 1);
    let released = false;
    return {
      acquired: true,
      inFlight: current(key),
      release() {
        if (released) return;
        released = true;
        releaseAndHandoff(key);
      },
    };
  }

  function finishWaiter(entry, outcome) {
    if (!entry.active) return false;
    entry.active = false;
    totalQueued--;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
    if (!outcome.granted) {
      const q = queues.get(entry.key);
      const index = q?.indexOf(entry) ?? -1;
      if (index >= 0) q.splice(index, 1);
      if (q && !q.some((e) => e.active)) queues.delete(entry.key);
    }
    entry.resolve(outcome);
    return true;
  }

  function releaseAndHandoff(key) {
    const n = current(key) - 1;
    if (n <= 0) inFlight.delete(key);
    else inFlight.set(key, n);

    const q = queues.get(key);
    while (q?.length) {
      const entry = q.shift();
      if (!entry.active) continue;
      inFlight.set(key, current(key) + 1); // transfer the released slot
      finishWaiter(entry, { granted: true });
      break;
    }
    if (q && !q.some((e) => e.active)) queues.delete(key);
  }

  const api = {
    peek: (key) => ({
      inFlight: current(key),
      queued: (queues.get(key) ?? []).filter((e) => e.active).length,
      totalQueued,
    }),

    tryAcquire(key) {
      if (current(key) >= maxInFlight) return { acquired: false, reason: "limit", inFlight: current(key) };
      return makeSlot(key);
    },

    /** Wait for a slot with both a deadline and cancellation. */
    async acquire(key, { timeoutMs = Infinity, signal } = {}) {
      if (Number.isFinite(timeoutMs) && timeoutMs < 0) throw new RangeError("timeoutMs must be >= 0");
      const immediate = api.tryAcquire(key);
      if (immediate.acquired) return immediate;
      if (signal?.aborted) return { acquired: false, reason: "aborted", inFlight: current(key) };

      const q = queues.get(key) ?? [];
      const activeForKey = q.filter((e) => e.active).length;
      if (activeForKey >= maxQueue || totalQueued >= maxTotalQueued) {
        return { acquired: false, reason: "queue_full", inFlight: current(key) };
      }

      let entry;
      const outcome = await new Promise((resolve) => {
        entry = { key, active: true, resolve, signal, timer: null, onAbort: null };
        totalQueued++;
        q.push(entry);
        queues.set(key, q);

        if (Number.isFinite(timeoutMs)) {
          entry.timer = setTimeout(() => finishWaiter(entry, { granted: false, reason: "timeout" }), timeoutMs);
        }
        if (signal) {
          entry.onAbort = () => finishWaiter(entry, { granted: false, reason: "aborted" });
          signal.addEventListener("abort", entry.onAbort, { once: true });
        }
      });

      if (!outcome.granted) return { acquired: false, reason: outcome.reason, inFlight: current(key) };
      return makeSlot(key, false); // releaseAndHandoff already transferred it
    },

    /** Non-queueing helper; finally guarantees slot release on errors. */
    async run(key, fn) {
      const slot = api.tryAcquire(key);
      if (!slot.acquired) {
        const err = new Error("concurrency_limit_exceeded");
        err.code = "CONCURRENCY_LIMIT";
        err.inFlight = slot.inFlight;
        throw err;
      }
      try {
        return await fn();
      } finally {
        slot.release();
      }
    },
  };

  return api;
}

/** Express middleware: holds a local slot for the response lifetime. */
export function concurrencyMiddleware(limiter, { keyOf = (req) => req.user?.id ?? req.ip } = {}) {
  return function middleware(req, res, next) {
    const slot = limiter.tryAcquire(keyOf(req));
    if (!slot.acquired) {
      res.setHeader("Retry-After", "1");
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(429).json({ error: "too_many_concurrent_requests", in_flight: slot.inFlight });
    }
    res.once("finish", slot.release);
    res.once("close", slot.release);
    next();
  };
}
