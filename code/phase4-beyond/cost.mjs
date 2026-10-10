/**
 * PHASE 4b — Cost-shaped limiting demonstrations.
 *
 * These are deliberately in-memory teaching primitives. A multi-process or
 * financially significant reservation needs an atomic, durable reservation ID
 * and a RESERVED -> SETTLED | CANCELLED state machine in Redis/database.
 */

const positive = (name, value) => {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and > 0`);
};
const nonNegative = (name, value) => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and >= 0`);
};
const finiteTimestamp = (value) => {
  if (!Number.isFinite(value)) throw new RangeError("time must be a finite timestamp");
};

// GraphQL-style static cost analysis: price the query before running it.
export function createCostEstimator({ fieldCosts = {}, defaultFieldCost = 1, listMultiplierCap = 100 } = {}) {
  positive("defaultFieldCost", defaultFieldCost);
  positive("listMultiplierCap", listMultiplierCap);

  return function estimate(node, inheritedMultiplier = 1) {
    if (!node || typeof node.field !== "string") throw new TypeError("node.field is required");
    const first = node.first ?? 1;
    positive("node.first", first);
    const own = fieldCosts[node.field] ?? defaultFieldCost;
    positive(`field cost for ${node.field}`, own);

    const multiplier = Math.min(inheritedMultiplier * first, listMultiplierCap * inheritedMultiplier);
    let total = own * multiplier;
    for (const child of node.children ?? []) total += estimate(child, multiplier);
    return total;
  };
}

// Reserve-then-settle, the pattern an unknown final cost forces on you.
export function createReservationBucket({
  capacity = 10_000,
  refillPerSec = 10_000 / 60,
  maxSingleCost = capacity,
  now = () => Date.now(),
} = {}) {
  positive("capacity", capacity);
  positive("refillPerSec", refillPerSec);
  positive("maxSingleCost", maxSingleCost);
  const state = new Map();

  function refill(key, t) {
    finiteTimestamp(t);
    const b = state.get(key) ?? { tokens: capacity, last: t };
    const effectiveNow = Math.max(t, b.last); // a slow clock cannot mint credit
    const elapsed = (effectiveNow - b.last) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.last = effectiveNow;
    state.set(key, b);
    return b;
  }

  return {
    peek(key, t = now()) {
      return refill(key, t).tokens;
    },

    reserve(key, estimate, t = now()) {
      positive("estimate", estimate);
      finiteTimestamp(t);
      if (estimate > maxSingleCost) {
        return { ok: false, reason: "single_request_too_expensive", estimate, maxSingleCost };
      }

      const b = refill(key, t);
      if (b.tokens < estimate) {
        return {
          ok: false,
          reason: "insufficient_budget",
          available: b.tokens,
          estimate,
          retryAfterMs: Math.ceil(((estimate - b.tokens) / refillPerSec) * 1000),
        };
      }

      b.tokens -= estimate;
      let finished = false;
      return {
        ok: true,
        reserved: estimate,
        remaining: b.tokens,

        settle(actual, t2 = now()) {
          nonNegative("actual", actual);
          finiteTimestamp(t2);
          if (finished) return { adjusted: 0, alreadyFinished: true };
          finished = true;
          const bb = refill(key, t2);
          const delta = actual - estimate;
          // Do not clamp at zero. If actual cost beat the reservation, preserve
          // debt so future refill repays it instead of silently losing usage.
          bb.tokens = Math.min(capacity, bb.tokens - delta);
          state.set(key, bb);
          return { adjusted: -delta, remaining: bb.tokens, debt: Math.max(0, -bb.tokens) };
        },

        cancel(t2 = now()) {
          finiteTimestamp(t2);
          if (finished) return { refunded: 0, alreadyFinished: true };
          const bb = refill(key, t2);
          bb.tokens = Math.min(capacity, bb.tokens + estimate);
          state.set(key, bb);
          finished = true;
          return { refunded: estimate, remaining: bb.tokens };
        },
      };
    },
  };
}

// Requests and units at once, like RPM + TPM. Whichever empties first wins.
export function createDualLimiter({ rpm, tpm, now = () => Date.now() } = {}) {
  positive("rpm", rpm);
  positive("tpm", tpm);
  const requests = createReservationBucket({ capacity: rpm, refillPerSec: rpm / 60, now });
  const tokens = createReservationBucket({ capacity: tpm, refillPerSec: tpm / 60, now });

  return {
    reserve(key, estimatedTokens, t = now()) {
      // Validate every dimension before the first bucket mutates.
      positive("estimatedTokens", estimatedTokens);
      finiteTimestamp(t);

      const requestHold = requests.reserve(key, 1, t);
      if (!requestHold.ok) return { ok: false, limit: "rpm", ...requestHold };

      let tokenHold;
      try {
        tokenHold = tokens.reserve(key, estimatedTokens, t);
      } catch (error) {
        requestHold.cancel(t);
        throw error;
      }
      if (!tokenHold.ok) {
        requestHold.cancel(t);
        return { ok: false, limit: "tpm", ...tokenHold };
      }

      let finished = false;
      return {
        ok: true,
        rpmRemaining: requestHold.remaining,
        tpmRemaining: tokenHold.remaining,

        settle(actualTokens, t2 = now()) {
          if (finished) return { adjusted: 0, alreadyFinished: true };
          nonNegative("actualTokens", actualTokens);
          finiteTimestamp(t2);
          const result = tokenHold.settle(actualTokens, t2);
          finished = true; // only after successful validation + settlement
          return result;
        },

        cancel(t2 = now()) {
          if (finished) return { refunded: 0, alreadyFinished: true };
          finiteTimestamp(t2);
          // Both operations have already validated t2, so this cannot leave a
          // half-cancelled composite reservation.
          requestHold.cancel(t2);
          const result = tokenHold.cancel(t2);
          finished = true;
          return result;
        },
      };
    },

    peek: (key, t = now()) => ({ rpm: requests.peek(key, t), tpm: tokens.peek(key, t) }),
  };
}
