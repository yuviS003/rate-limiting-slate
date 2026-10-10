/**
 * PHASE 4c — Feedback-controller demonstrations.
 *
 * These illustrate AIMD- and Vegas-shaped control. They are not drop-in
 * replicas of TCP or Netflix's production library. Real controllers aggregate
 * samples into windows, smooth noisy latency, filter app-limited periods, and
 * are integrated with an admission semaphore.
 */

export function createAIMDLimit({
  initial = 20,
  min = 1,
  max = 1000,
  backoffRatio = 0.9,
  timeoutMs = 1000,
} = {}) {
  let limit = initial;

  return {
    get limit() { return Math.floor(limit); },

    /** Call once per feedback epoch/window, not once per completed request. */
    onSample({ rttMs, inFlight, didDrop = false }) {
      if (didDrop || rttMs > timeoutMs) {
        limit = Math.max(min, limit * backoffRatio);
        return { limit: Math.floor(limit), action: "decrease" };
      }
      // Do not grow while app-limited: no evidence says extra capacity exists.
      if (inFlight * 2 >= limit) {
        limit = Math.min(max, limit + 1);
        return { limit: Math.floor(limit), action: "increase" };
      }
      return { limit: Math.floor(limit), action: "hold" };
    },
  };
}

/**
 * Simplified Vegas-style controller.
 *
 * queue ≈ limit × (1 - minimumRTT / observedRTT)
 *
 * The baseline never resets itself under load: a congested sample must not
 * become the new "healthy" floor. Call resetBaseline() only during a deliberate
 * low-load probe or after a known topology/deployment change.
 */
export function createVegasLimit({
  initial = 20,
  min = 1,
  max = 1000,
  alpha = (l) => Math.max(3, 3 * Math.log10(Math.max(10, l))),
  beta = (l) => Math.max(6, 6 * Math.log10(Math.max(10, l))),
} = {}) {
  let limit = initial;
  let minRtt = Infinity;

  return {
    get limit() { return Math.floor(limit); },
    get estimatedMinRtt() { return minRtt; },

    resetBaseline() {
      minRtt = Infinity;
    },

    /** Call with a representative sample from one control window. */
    onSample({ rttMs, inFlight, didDrop = false }) {
      if (!Number.isFinite(rttMs) || rttMs <= 0) throw new RangeError("rttMs must be > 0");
      if (!Number.isFinite(inFlight) || inFlight < 0) throw new RangeError("inFlight must be >= 0");

      // Failed/timeout samples are congestion signals, not valid observations
      // of the healthy latency floor.
      if (didDrop) {
        limit = Math.max(min, limit * 0.7);
        return { limit: Math.floor(limit), action: "drop", queue: null };
      }
      minRtt = Math.min(minRtt, rttMs);

      const queue = limit * (1 - minRtt / rttMs);
      const a = alpha(limit);
      const b = beta(limit);
      let action = "hold";

      if (queue < a && inFlight * 2 >= limit) {
        limit = Math.min(max, limit + Math.log10(Math.max(10, limit)));
        action = "increase";
      } else if (queue > b) {
        limit = Math.max(min, limit - Math.log10(Math.max(10, limit)));
        action = "decrease";
      }

      return { limit: Math.floor(limit), action, queue, alpha: a, beta: b };
    },
  };
}

export const PRIORITY = {
  CRITICAL: 0,
  WRITE: 1,
  READ: 2,
  BACKGROUND: 3,
};

/**
 * Ramped priority shedding demonstration.
 *
 * update() converts utilization into a per-priority rejection probability and
 * moves toward it slowly. shouldShed() uses that ramped state—it never reacts
 * directly to an instantaneous sample. CRITICAL is omitted, but protecting it
 * still requires a separate hard total cap / reserved concurrency pool.
 */
export function createLoadShedder({
  thresholds = {
    [PRIORITY.BACKGROUND]: 0.70,
    [PRIORITY.READ]: 0.85,
    [PRIORITY.WRITE]: 0.95,
  },
  rampUpSeconds = 30,
  rampDownSeconds = 60,
} = {}) {
  const levels = new Map(Object.keys(thresholds).map((p) => [Number(p), 0]));
  let lastUpdate = null;

  const targetFor = (priority, utilisation) => {
    const threshold = thresholds[priority];
    if (threshold === undefined || utilisation <= threshold) return 0;
    return Math.min(1, (utilisation - threshold) / (1 - threshold));
  };

  return {
    update(utilisation, t = Date.now()) {
      if (!Number.isFinite(t)) throw new RangeError("time must be a finite timestamp");
      if (!Number.isFinite(utilisation) || utilisation < 0 || utilisation > 1) {
        throw new RangeError("utilisation must be between 0 and 1");
      }
      const dt = lastUpdate === null ? 0 : Math.max(0, t - lastUpdate) / 1000;
      lastUpdate = t;

      for (const priority of levels.keys()) {
        const current = levels.get(priority);
        const target = targetFor(priority, utilisation);
        const seconds = target > current ? rampUpSeconds : rampDownSeconds;
        const step = seconds > 0 ? dt / seconds : 1;
        levels.set(priority, current + Math.sign(target - current) * Math.min(step, Math.abs(target - current)));
      }
      return { utilisation, probabilities: Object.fromEntries(levels) };
    },

    shouldShed(priority, rnd = Math.random()) {
      if (priority === PRIORITY.CRITICAL) return false;
      return rnd < (levels.get(priority) ?? 0);
    },

    probability(priority) {
      return priority === PRIORITY.CRITICAL ? 0 : (levels.get(priority) ?? 0);
    },

    get currentShedFraction() {
      return Math.max(0, ...levels.values());
    },
  };
}
