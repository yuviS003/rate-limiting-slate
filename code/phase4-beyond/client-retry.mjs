/**
 * Bounded, identity-stable, replay-aware HTTP retry helper.
 *
 * makeOptions(attempt) must create a fresh request body/stream. Non-idempotent
 * methods are replayed only with one stable, non-blank Idempotency-Key that the
 * upstream is documented to honor.
 */

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

export function parseRetryAfter(value, wallNow = Date.now()) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) ? seconds * 1000 : null;
  }
  // Numeric-looking values that are not RFC delta-seconds are malformed, not dates.
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null;
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, date - wallNow);
}

export function replayIdentity(options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
  const rawKey = new Headers(options.headers).get("Idempotency-Key");
  const key = rawKey?.trim() || null;
  return {
    method,
    key,
    replayable: IDEMPOTENT.has(method) || key !== null,
    fingerprint: `${method}\u0000${key ?? ""}`,
  };
}

export function mayReplay(options = {}) {
  return replayIdentity(options).replayable;
}

const abortError = () => new DOMException("The operation was aborted", "AbortError");
const throwIfAborted = (signal) => {
  if (signal?.aborted) throw signal.reason ?? abortError();
};
const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  throwIfAborted(signal);
  const timer = setTimeout(done, ms);
  function done() {
    signal?.removeEventListener("abort", aborted);
    resolve();
  }
  function aborted() {
    clearTimeout(timer);
    reject(signal.reason ?? abortError());
  }
  signal?.addEventListener("abort", aborted, { once: true });
});
const defaultMonotonicNow = () => globalThis.performance?.now?.() ?? Date.now();

export async function fetchWithBackoff(url, makeOptions, {
  maxAttempts = 5,
  baseMs = 500,
  capMs = 30_000,
  attemptTimeoutMs = 10_000,
  totalTimeoutMs = 45_000,
  signal,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  monotonicNow = defaultMonotonicNow,
  wallNow = Date.now,
  random = Math.random,
  createTimeoutSignal = (ms) => AbortSignal.timeout(ms),
} = {}) {
  if (typeof makeOptions !== "function") throw new TypeError("makeOptions must be a function");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("maxAttempts must be >= 1");
  for (const [name, value] of Object.entries({ baseMs, capMs, attemptTimeoutMs, totalTimeoutMs })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be > 0`);
  }
  if (typeof random !== "function" || typeof monotonicNow !== "function" || typeof wallNow !== "function") {
    throw new TypeError("clock and random dependencies must be functions");
  }

  const started = monotonicNow();
  if (!Number.isFinite(started)) throw new RangeError("monotonic clock must be finite");
  const deadline = started + totalTimeoutMs;
  let firstIdentity;
  let preparedOptions;
  let lastError;

  const prepare = (attempt) => {
    const options = makeOptions(attempt) ?? {};
    const identity = replayIdentity(options);
    if (!firstIdentity) firstIdentity = identity;
    else if (identity.fingerprint !== firstIdentity.fingerprint) {
      throw new Error("Refusing to replay with a different method or Idempotency-Key");
    }
    return options;
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfAborted(signal);
    const remaining = deadline - monotonicNow();
    if (!Number.isFinite(remaining) || remaining <= 0) throw lastError ?? new Error("retry deadline exceeded");

    const options = preparedOptions ?? prepare(attempt);
    preparedOptions = undefined;
    throwIfAborted(options.signal);

    let response;
    try {
      const timeoutMs = Math.max(1, Math.ceil(Math.min(attemptTimeoutMs, remaining)));
      const timeoutSignal = createTimeoutSignal(timeoutMs);
      const signals = [signal, options.signal, timeoutSignal].filter(Boolean);
      const attemptSignal = signals.length > 1 && typeof AbortSignal.any === "function"
        ? AbortSignal.any(signals)
        : signals[0];
      response = await fetchImpl(url, { ...options, signal: attemptSignal });
    } catch (error) {
      lastError = error;
      // Operation-level cancellation is a user decision, never a transient fault.
      if (signal?.aborted || options.signal?.aborted) throw error;
      if (!firstIdentity.replayable || attempt + 1 >= maxAttempts) throw error;
    }

    if (response && (!TRANSIENT.has(response.status) || attempt + 1 >= maxAttempts)) return response;

    // Do not consume/cancel a transient response if this operation cannot be replayed.
    if (!firstIdentity.replayable) return response;

    // Prepare and verify the next identity before touching the current response.
    preparedOptions = prepare(attempt + 1);

    const retryAfter = response
      ? parseRetryAfter(response.headers.get("retry-after"), wallNow())
      : null;
    const window = Math.min(capMs, baseMs * 2 ** attempt);
    // Retry-After is a floor. Even a floor of zero receives a full-jitter window.
    const delay = (retryAfter ?? 0) + random() * window;
    const remainingBeforeSleep = deadline - monotonicNow();

    if (!Number.isFinite(delay) || delay >= remainingBeforeSleep) {
      preparedOptions = undefined;
      if (response) return response; // untouched and readable
      throw lastError ?? new Error("retry deadline exceeded");
    }

    await response?.body?.cancel().catch(() => {});
    await sleep(delay, signal);
  }

  throw lastError ?? new Error("retry loop exhausted");
}
