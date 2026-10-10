/**
 * PHASE 2 — A Redis-backed teaching wrapper with production guardrails.
 *
 * The algorithm scripts are real. A production integration still needs
 * connection pooling, timeouts, Redis HA/eviction decisions, preloaded scripts
 * (EVALSHA or Redis Functions), metrics, and real Redis/Cluster integration
 * tests. This wrapper deliberately accepts an eval function so it works with
 * node-redis, ioredis, or the test harness.
 */
import { randomUUID } from "node:crypto";
import { FIXED_WINDOW, SLIDING_WINDOW_LOG, TOKEN_BUCKET, GCRA } from "./scripts.mjs";

export class LimiterConfigurationError extends RangeError {}

const positive = (name, value, { integer = false } = {}) => {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
    throw new LimiterConfigurationError(`${name} must be ${integer ? "a positive safe integer" : "finite and > 0"}`);
  }
};
const finiteTimestamp = (value) => {
  if (!Number.isFinite(value)) throw new LimiterConfigurationError("now must be a finite timestamp");
};
const safeKey = (key) => {
  const value = String(key ?? "");
  if (!value || value.length > 256) throw new LimiterConfigurationError("key must contain 1..256 characters");
  return encodeURIComponent(value);
};

export function createRedisLimiter({
  eval: evalFn,
  prefix = "rl:",
  failOpen = true,
  onError = () => {},
  id = randomUUID,
}) {
  if (typeof evalFn !== "function") throw new LimiterConfigurationError("eval must be a function");

  const guardStore = async (fn, fallback) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof LimiterConfigurationError) throw err;
      onError(err);
      return { ...fallback, allowed: failOpen, degraded: true };
    }
  };
  const scriptStatus = (status, name) => {
    if (status < 0) throw new LimiterConfigurationError(`${name} script rejected its arguments (status ${status})`);
  };

  return {
    fixedWindow(key, { limit, windowMs, now = Date.now() }) {
      positive("limit", limit, { integer: true });
      positive("windowMs", windowMs, { integer: true });
      finiteTimestamp(now);
      const k = safeKey(key);
      const window = Math.floor(now / windowMs);
      const boundaryMs = Math.max(1, Math.ceil((window + 1) * windowMs - now));

      return guardStore(async () => {
        const [allowed, remaining, ttl] = await evalFn(
          FIXED_WINDOW,
          [`${prefix}fw:${k}:${window}`],
          [limit, boundaryMs]
        );
        scriptStatus(allowed, "fixed-window");
        return { allowed: allowed === 1, remaining: Number(remaining), resetMs: Number(ttl) };
      }, { remaining: 0, resetMs: boundaryMs });
    },

    slidingWindowLog(key, { limit, windowMs, now = Date.now() }) {
      positive("limit", limit, { integer: true });
      positive("windowMs", windowMs, { integer: true });
      finiteTimestamp(now);
      const k = safeKey(key);

      return guardStore(async () => {
        // Internally generated: callers cannot accidentally reuse a ZSET member
        // and make multiple requests collapse into one timestamp.
        for (let collisionRetry = 0; collisionRetry < 2; collisionRetry++) {
          const [allowed, remaining, retry] = await evalFn(
            SLIDING_WINDOW_LOG,
            [`${prefix}swl:${k}`],
            [now, windowMs, limit, id()]
          );
          if (allowed === -3) continue; // astronomically unlikely UUID collision
          scriptStatus(allowed, "sliding-window");
          return { allowed: allowed === 1, remaining: Number(remaining), retryAfterMs: Number(retry) };
        }
        throw new Error("could not allocate a unique sliding-window member");
      }, { remaining: 0, retryAfterMs: windowMs });
    },

    tokenBucket(key, { capacity, refillPerSec, cost = 1, now = Date.now(), ttlMs }) {
      positive("capacity", capacity);
      positive("refillPerSec", refillPerSec);
      positive("cost", cost);
      finiteTimestamp(now);
      if (cost > capacity) {
        return Promise.resolve({ allowed: false, reason: "cost_exceeds_capacity", tokens: null, retryAfterMs: null });
      }
      const ttl = ttlMs ?? Math.ceil((capacity / refillPerSec) * 1000) * 2;
      positive("ttlMs", ttl, { integer: true });
      const k = safeKey(key);

      return guardStore(async () => {
        const [allowed, tokens, retry] = await evalFn(
          TOKEN_BUCKET,
          [`${prefix}tb:${k}`],
          [now, capacity, refillPerSec, cost, ttl]
        );
        scriptStatus(allowed, "token-bucket");
        return { allowed: allowed === 1, tokens: Number(tokens), retryAfterMs: Number(retry) };
      }, { tokens: 0, retryAfterMs: 1000 });
    },

    gcra(key, { limit, periodMs, burst, cost = 1, now = Date.now() }) {
      positive("limit", limit);
      positive("periodMs", periodMs, { integer: true });
      positive("burst", burst, { integer: true });
      positive("cost", cost);
      finiteTimestamp(now);
      if (cost > burst) {
        return Promise.resolve({ allowed: false, reason: "cost_exceeds_burst", retryAfterMs: null });
      }
      const interval = periodMs / limit;
      const tolerance = interval * burst;
      const ttl = Math.ceil(interval * (burst + cost) * 2);
      const k = safeKey(key);

      return guardStore(async () => {
        const [allowed, retry] = await evalFn(
          GCRA,
          [`${prefix}gcra:${k}`],
          [now, interval, tolerance, cost, ttl]
        );
        scriptStatus(allowed, "GCRA");
        return { allowed: allowed === 1, retryAfterMs: Number(retry) };
      }, { retryAfterMs: periodMs });
    },
  };
}

/** Express middleware. Retry-After is standardized; draft RateLimit fields are opt-in. */
export function rateLimitMiddleware(limiter, {
  keyOf = (req) => req.user?.id ?? req.ip,
  capacity = 20,
  refillPerSec = 5,
  costOf = () => 1,
} = {}) {
  return async function middleware(req, res, next) {
    try {
      const result = await limiter.tokenBucket(keyOf(req), {
        capacity,
        refillPerSec,
        cost: costOf(req),
      });
      if (result.allowed) return next();

      if (Number.isFinite(result.retryAfterMs)) {
        res.setHeader("Retry-After", Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
      }
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(429).json({
        error: result.reason ?? "rate_limited",
        message: "Request rejected by the rate policy.",
        retry_after_ms: result.retryAfterMs,
      });
    } catch (err) {
      return next(err); // configuration mistakes are not silently treated as Redis outages
    }
  };
}
