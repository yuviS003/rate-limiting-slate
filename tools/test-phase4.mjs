import assert from "node:assert/strict";
import { createConcurrencyLimiter } from "../code/phase4-beyond/concurrency.mjs";
import { createCostEstimator, createReservationBucket, createDualLimiter } from "../code/phase4-beyond/cost.mjs";
import { createAIMDLimit, createVegasLimit, createLoadShedder, PRIORITY } from "../code/phase4-beyond/adaptive.mjs";
import { parseRetryAfter, fetchWithBackoff } from "../code/phase4-beyond/client-retry.mjs";

const ok = (m) => console.log(`  ok  ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- concurrency
{
  console.log("concurrency limiter");
  const cl = createConcurrencyLimiter({ maxInFlight: 3 });

  const slots = [cl.tryAcquire("a"), cl.tryAcquire("a"), cl.tryAcquire("a")];
  assert.ok(slots.every((s) => s.acquired));
  assert.equal(cl.tryAcquire("a").acquired, false);
  ok("three slots granted, the fourth refused");

  slots[0].release();
  assert.equal(cl.tryAcquire("a").acquired, true);
  ok("releasing frees a slot");

  // the bug this guards against
  const s = cl.tryAcquire("b");
  s.release();
  s.release();
  s.release();
  assert.equal(cl.peek("b").inFlight, 0);
  ok("double release is idempotent, so a retry cannot corrupt the count");

  // rate limiting cannot express this: slow requests hold their slot
  const cl2 = createConcurrencyLimiter({ maxInFlight: 2 });
  let peak = 0;
  const work = async (ms) => {
    await cl2.run("c", async () => {
      peak = Math.max(peak, cl2.peek("c").inFlight);
      await sleep(ms);
    });
  };
  const started = [work(40), work(40)];
  await sleep(5);
  await assert.rejects(() => work(10), (e) => e.code === "CONCURRENCY_LIMIT");
  ok("a third slow request is rejected while two are still running");
  await Promise.all(started);
  assert.equal(peak, 2);
  assert.equal(cl2.peek("c").inFlight, 0);
  ok("run() released every slot, peak concurrency never exceeded 2");

  // a throwing handler must not leak its slot
  const cl3 = createConcurrencyLimiter({ maxInFlight: 1 });
  await assert.rejects(() => cl3.run("d", async () => { throw new Error("boom"); }));
  assert.equal(cl3.peek("d").inFlight, 0);
  ok("a handler that throws still releases its slot");

  // queueing variant
  const cl4 = createConcurrencyLimiter({ maxInFlight: 1, maxQueue: 2 });
  const held = cl4.tryAcquire("e");
  const waiter = cl4.acquire("e");
  assert.equal(cl4.peek("e").queued, 1);
  held.release();
  const got = await waiter;
  assert.equal(got.acquired, true);
  ok("a bounded queue lets callers wait instead of failing");
  got.release();

  const cl5 = createConcurrencyLimiter({ maxInFlight: 1, maxQueue: 2, maxTotalQueued: 2 });
  const blocker = cl5.tryAcquire("timeout");
  const timed = await cl5.acquire("timeout", { timeoutMs: 5 });
  assert.equal(timed.reason, "timeout");
  assert.equal(cl5.peek("timeout").queued, 0);
  ok("a queued request has a deadline and removes itself on timeout");
  blocker.release();

  const cl6 = createConcurrencyLimiter({ maxInFlight: 1, maxQueue: 2 });
  const blocker2 = cl6.tryAcquire("abort");
  const controller = new AbortController();
  const abortedPromise = cl6.acquire("abort", { signal: controller.signal });
  controller.abort();
  const aborted = await abortedPromise;
  assert.equal(aborted.reason, "aborted");
  assert.equal(cl6.peek("abort").queued, 0);
  ok("client cancellation removes its queued waiter");
  blocker2.release();

  const cl7 = createConcurrencyLimiter({ maxInFlight: 1, maxQueue: 5, maxTotalQueued: 1 });
  const holdX = cl7.tryAcquire("x");
  const holdY = cl7.tryAcquire("y");
  const queuedX = cl7.acquire("x", { timeoutMs: 50 });
  const refusedY = await cl7.acquire("y");
  assert.equal(refusedY.reason, "queue_full");
  ok("an aggregate queue bound prevents many keys from bypassing per-key limits");
  holdX.release();
  (await queuedX).release();
  holdY.release();
}

// ------------------------------------------------------------ cost analysis
{
  console.log("cost estimation (GraphQL-style)");
  const estimate = createCostEstimator({
    fieldCosts: { users: 1, posts: 1, comments: 1 },
    defaultFieldCost: 1,
  });

  const cheap = estimate({ field: "users", first: 1, children: [] });
  const nested = estimate({
    field: "users",
    first: 100,
    children: [{ field: "posts", first: 100, children: [{ field: "comments", first: 100 }] }],
  });

  assert.equal(cheap, 1);
  assert.ok(nested > 100_000, `nested cost was ${nested}`);
  ok(`one request, cost ${cheap}. Another request, cost ${nested.toLocaleString()}`);
  ok("this is why counting requests is the wrong unit for a graph API");
}

// -------------------------------------------------- reserve-then-settle
{
  console.log("reserve-then-settle (the LLM token problem)");
  let t = 0;
  const b = createReservationBucket({
    capacity: 10_000,
    refillPerSec: 10_000 / 60,
    maxSingleCost: 8_000,
    now: () => t,
  });

  // the naive approach fails: charge only after the call, and concurrent
  // requests all see a full budget
  const r1 = b.reserve("org", 3_000);
  const r2 = b.reserve("org", 3_000);
  const r3 = b.reserve("org", 3_000);
  assert.ok(r1.ok && r2.ok && r3.ok);
  assert.equal(b.peek("org"), 1_000);
  ok("three concurrent reservations of 3,000 leave 1,000, because the hold is up front");

  const r4 = b.reserve("org", 3_000);
  assert.equal(r4.ok, false);
  assert.equal(r4.reason, "insufficient_budget");
  ok("the fourth is refused before the model is ever called");

  // settle: the call used less than we guessed, so refund the difference
  const settled = r1.settle(1_200);
  assert.equal(settled.adjusted, 1_800);
  assert.equal(b.peek("org"), 2_800);
  ok("a call that used 1,200 of a reserved 3,000 refunded 1,800");

  // settle: the call used more, so charge the difference
  r2.settle(4_000);
  assert.equal(b.peek("org"), 1_800);
  ok("a call that overshot its estimate was charged the extra 1,000");

  // double settle is a no-op
  const again = r2.settle(9_999);
  assert.equal(again.alreadyFinished, true);
  assert.equal(b.peek("org"), 1_800);
  ok("settling twice does nothing, so a retried callback cannot double charge");

  // cancel returns the whole hold
  const r5 = b.reserve("org2", 500);
  const cancelled = r5.cancel();
  assert.equal(cancelled.refunded, 500);
  ok("cancel() refunds the full reservation when the call never happened");

  // a request too big for any bucket is refused immediately
  const huge = b.reserve("org", 9_000);
  assert.equal(huge.ok, false);
  assert.equal(huge.reason, "single_request_too_expensive");
  ok("a request larger than maxSingleCost is rejected outright, not queued forever");

  // a real overshoot is debt, not silently clamped away
  const debtBucket = createReservationBucket({ capacity: 100, refillPerSec: 1, maxSingleCost: 100, now: () => t });
  const debtHold = debtBucket.reserve("debt", 10);
  const debt = debtHold.settle(200);
  assert.equal(debt.remaining, -100);
  assert.equal(debt.debt, 100);
  ok("actual cost above the estimate remains as debt for future refill to repay");

  // refills over time
  t += 60_000;
  assert.equal(Math.round(b.peek("org")), 10_000);
  ok("a minute later the budget is full again");

  const clockBucket = createReservationBucket({ capacity: 1, refillPerSec: 1 });
  clockBucket.reserve("clock", 1, 1000);
  clockBucket.reserve("clock", 1, 2000);
  for (let i = 0; i < 5; i++) {
    assert.equal(clockBucket.reserve("clock", 1, 1000).ok, false);
    assert.equal(clockBucket.reserve("clock", 1, 2000).ok, false);
  }
  ok("alternating a regressed clock cannot mint reservation budget");

  assert.throws(() => b.reserve("nan-clock", 1, NaN), RangeError);
  assert.equal(b.peek("nan-clock", 0), 10_000);
  ok("a non-finite reservation clock fails before state is created");
}

// ------------------------------------------------------------ dual limiter
{
  console.log("two dimensions at once (RPM and TPM)");
  let t = 0;
  const dual = createDualLimiter({ rpm: 3, tpm: 10_000, now: () => t });

  assert.equal(dual.reserve("org", 100).ok, true);
  assert.equal(dual.reserve("org", 100).ok, true);
  assert.equal(dual.reserve("org", 100).ok, true);
  const rpmHit = dual.reserve("org", 100);
  assert.equal(rpmHit.ok, false);
  assert.equal(rpmHit.limit, "rpm");
  ok("plenty of tokens left, but the request count ran out first");

  t += 60_000;
  const heavy1 = dual.reserve("heavy", 6_000);
  const tpmHit = dual.reserve("heavy", 6_000);
  assert.equal(heavy1.ok, true);
  assert.equal(tpmHit.ok, false);
  assert.equal(tpmHit.limit, "tpm");
  assert.equal(tpmHit.reason, "insufficient_budget");
  ok("plenty of requests left, but two individually valid calls exhausted the token budget");

  // a TPM rejection must not silently consume an RPM slot
  const after = dual.peek("heavy");
  assert.equal(Math.round(after.rpm), 2); // one successful request, second refunded
  ok("the refused request did not burn a request slot either");

  // settle then cancel must not refund the already-consumed RPM slot
  const done = dual.reserve("settled", 1_000);
  done.settle(900);
  const beforeCancel = dual.peek("settled");
  const lateCancel = done.cancel();
  const afterCancel = dual.peek("settled");
  assert.equal(lateCancel.alreadyFinished, true);
  assert.equal(afterCancel.rpm, beforeCancel.rpm);
  assert.equal(afterCancel.tpm, beforeCancel.tpm);
  ok("settle followed by a stray cancel is idempotent across both dimensions");

  const beforeInvalid = dual.peek("invalid");
  assert.throws(() => dual.reserve("invalid", NaN), RangeError);
  assert.deepEqual(dual.peek("invalid"), beforeInvalid);
  ok("an invalid token estimate cannot consume an RPM slot first");

  const recoverable = dual.reserve("recoverable", 1000);
  assert.throws(() => recoverable.settle(NaN), RangeError);
  const validSettlement = recoverable.settle(900);
  assert.equal(validSettlement.alreadyFinished, undefined);
  ok("an invalid settlement does not terminalize the reservation; a valid retry can settle it");
}

// --------------------------------------------------------------- HTTP retry
{
  console.log("bounded, identity-stable HTTP retry");
  const dateNow = Date.parse("2026-10-09T12:00:00Z");
  assert.equal(parseRetryAfter("7", dateNow), 7000);
  assert.equal(parseRetryAfter("Fri, 09 Oct 2026 12:00:09 GMT", dateNow), 9000);
  assert.equal(parseRetryAfter("1.5", dateNow), null);
  assert.equal(parseRetryAfter("nonsense", dateNow), null);
  ok("Retry-After accepts integer delta-seconds and HTTP dates, not loose numerics");

  let t = 0;
  let calls = 0;
  let cancelled = 0;
  const waits = [];
  const response = (status, retryAfter) => ({
    status,
    headers: new Headers(retryAfter == null ? {} : { "retry-after": retryAfter }),
    body: { cancel: async () => { cancelled++; } },
  });
  const result = await fetchWithBackoff("https://example.test", () => ({ method: "GET" }), {
    fetchImpl: async () => (++calls === 1 ? response(429, "2") : response(200)),
    monotonicNow: () => t,
    wallNow: () => 0,
    sleep: async (ms) => { waits.push(ms); t += ms; },
    random: () => 0.5,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(waits, [2250]); // 2s floor + 0.5 × 500ms full-jitter window
  assert.equal(cancelled, 1);
  ok("429 treats Retry-After as a floor, adds later full jitter, drains, then succeeds");

  calls = 0;
  await assert.rejects(() => fetchWithBackoff("https://example.test", () => ({ method: "POST" }), {
    fetchImpl: async () => { calls++; throw new Error("socket reset"); },
  }), /socket reset/);
  assert.equal(calls, 1);
  ok("a POST without an idempotency key is never replayed after an unknown outcome");

  calls = 0; cancelled = 0;
  const untouched = await fetchWithBackoff("https://example.test", () => ({ method: "POST" }), {
    fetchImpl: async () => { calls++; return response(503); },
  });
  assert.equal(untouched.status, 503);
  assert.equal(calls, 1);
  assert.equal(cancelled, 0);
  ok("a transient response for a non-replayable POST is returned immediately and untouched");

  calls = 0; cancelled = 0;
  await assert.rejects(() => fetchWithBackoff("https://example.test", (attempt) => ({
    method: "POST",
    headers: { "Idempotency-Key": `key-${attempt}` },
    body: `fresh-${attempt}`,
  }), {
    fetchImpl: async () => { calls++; return response(503); },
  }), /different method or Idempotency-Key/);
  assert.equal(calls, 1);
  assert.equal(cancelled, 0);
  ok("a changed idempotency key is rejected before replaying or consuming the first response");

  calls = 0;
  let bodies = 0;
  const post = await fetchWithBackoff("https://example.test", () => ({
    method: "POST",
    headers: { "Idempotency-Key": "op-123" },
    body: `fresh-${++bodies}`,
  }), {
    fetchImpl: async () => (++calls === 1 ? response(503) : response(201)),
    sleep: async () => {},
    monotonicNow: () => 0,
    random: () => 0,
  });
  assert.equal(post.status, 201);
  assert.equal(bodies, 2);
  ok("a stable idempotent POST retries with a freshly created body");

  cancelled = 0;
  const last = await fetchWithBackoff("https://example.test", () => ({ method: "GET" }), {
    fetchImpl: async () => response(429, "2"),
    totalTimeoutMs: 1000,
    monotonicNow: () => 0,
    wallNow: () => 0,
    random: () => 0,
  });
  assert.equal(last.status, 429);
  assert.equal(cancelled, 0);
  ok("a retry that cannot fit the total deadline returns the readable last response");

  let timeoutBudget;
  const bounded = await fetchWithBackoff("https://example.test", () => ({ method: "GET" }), {
    fetchImpl: async () => response(200),
    attemptTimeoutMs: 1000,
    totalTimeoutMs: 20,
    monotonicNow: () => 0,
    createTimeoutSignal: (ms) => { timeoutBudget = ms; return new AbortController().signal; },
  });
  assert.equal(bounded.status, 200);
  assert.equal(timeoutBudget, 20);
  ok("each attempt timeout is bounded by the remaining total deadline");

  const operation = new AbortController();
  calls = 0;
  await assert.rejects(() => fetchWithBackoff("https://example.test", () => ({ method: "GET" }), {
    signal: operation.signal,
    fetchImpl: async () => { calls++; operation.abort(); return response(429); },
    monotonicNow: () => 0,
  }), (error) => error.name === "AbortError");
  assert.equal(calls, 1);
  ok("operation-level cancellation is never retried and aborts the sleep path");
}

// ----------------------------------------------------------------- AIMD
{
  console.log("AIMD adaptive limit");
  const aimd = createAIMDLimit({ initial: 20, min: 1, max: 100, backoffRatio: 0.5 });

  for (let i = 0; i < 30; i++) aimd.onSample({ rttMs: 50, inFlight: 20 });
  assert.ok(aimd.limit > 20, `limit was ${aimd.limit}`);
  ok(`healthy traffic grew the limit from 20 to ${aimd.limit}`);

  const before = aimd.limit;
  aimd.onSample({ rttMs: 50, inFlight: 20, didDrop: true });
  assert.ok(aimd.limit < before);
  ok(`a single drop cut the limit from ${before} to ${aimd.limit}`);

  // idle traffic must not inflate the limit
  const quiet = createAIMDLimit({ initial: 20 });
  for (let i = 0; i < 50; i++) quiet.onSample({ rttMs: 10, inFlight: 1 });
  assert.equal(quiet.limit, 20);
  ok("a quiet system holds its limit instead of growing on no evidence");
}

// ----------------------------------------------------------------- Vegas
{
  console.log("Vegas adaptive limit (latency as the signal)");
  const v = createVegasLimit({ initial: 20, min: 1, max: 200 });

  // establish the latency floor under healthy load
  for (let i = 0; i < 40; i++) v.onSample({ rttMs: 100, inFlight: 20 });
  assert.equal(v.estimatedMinRtt, 100);
  const grown = v.limit;
  assert.ok(grown > 20, `limit was ${grown}`);
  ok(`at baseline latency the limit grew to ${grown} and minRtt settled at ${v.estimatedMinRtt}ms`);

  // now latency triples: queueing is happening, so pull back
  let r;
  for (let i = 0; i < 20; i++) r = v.onSample({ rttMs: 300, inFlight: grown });
  assert.ok(v.limit < grown, `limit was ${v.limit}, expected below ${grown}`);
  ok(`latency 100ms -> 300ms implied a queue of ~${r.queue.toFixed(1)} and cut the limit to ${v.limit}`);
  ok("note it reacted to latency alone, before a single request failed");

  const floorDuringCongestion = v.estimatedMinRtt;
  for (let i = 0; i < 120; i++) v.onSample({ rttMs: 300, inFlight: v.limit });
  assert.equal(v.estimatedMinRtt, floorDuringCongestion);
  ok("sustained congestion cannot silently become the new healthy latency baseline");

  // recovery
  const bottom = v.limit;
  for (let i = 0; i < 30; i++) v.onSample({ rttMs: 100, inFlight: v.limit });
  assert.ok(v.limit > bottom);
  ok(`once latency recovered the limit climbed back from ${bottom} to ${v.limit}`);

  // a hard drop is treated more harshly than slow latency
  const vd = createVegasLimit({ initial: 50 });
  vd.onSample({ rttMs: 100, inFlight: 50 });
  const pre = vd.limit;
  vd.onSample({ rttMs: 100, inFlight: 50, didDrop: true });
  assert.ok(vd.limit <= pre * 0.75);
  ok(`an actual failure cut the limit hard: ${pre} -> ${vd.limit}`);

  const poisoned = createVegasLimit({ initial: 30 });
  poisoned.onSample({ rttMs: 100, inFlight: 30 });
  poisoned.onSample({ rttMs: 1, inFlight: 30, didDrop: true });
  assert.equal(poisoned.estimatedMinRtt, 100);
  const afterDrop = poisoned.onSample({ rttMs: 100, inFlight: poisoned.limit });
  assert.notEqual(afterDrop.action, "decrease");
  ok("an implausibly fast failed sample cannot poison the healthy latency floor");
}

// ------------------------------------------------------------ load shedding
{
  console.log("priority load shedding");
  const shedder = createLoadShedder({ rampUpSeconds: 30, rampDownSeconds: 60 });
  let t = 0;

  assert.throws(() => shedder.update(0.5, NaN), RangeError);
  shedder.update(0.5, t);
  for (const p of Object.values(PRIORITY)) assert.equal(shedder.shouldShed(p, 0.01), false);
  ok("at 50% utilisation every class is served");

  // Hold 90% for one ramp interval: background reaches a higher probability
  // than reads because its threshold is lower.
  for (let i = 0; i < 30; i++) { t += 1000; shedder.update(0.9, t); }
  assert.ok(shedder.probability(PRIORITY.BACKGROUND) > shedder.probability(PRIORITY.READ));
  assert.equal(shedder.shouldShed(PRIORITY.BACKGROUND, 0.5), true);
  assert.equal(shedder.shouldShed(PRIORITY.READ, 0.5), false);
  assert.equal(shedder.shouldShed(PRIORITY.CRITICAL, 0), false);
  ok("at 90% background is shed before reads; critical remains outside this probability shedder");

  for (let i = 0; i < 30; i++) { t += 1000; shedder.update(0.99, t); }
  assert.equal(shedder.shouldShed(PRIORITY.READ, 0.5), true);
  assert.equal(shedder.shouldShed(PRIORITY.CRITICAL, 0), false);
  ok("sustained 99% utilisation ramps read shedding up too");

  // Prove shouldShed uses ramped state rather than reacting instantly.
  const ramped = createLoadShedder({ rampUpSeconds: 30, rampDownSeconds: 60 });
  t = 0;
  ramped.update(1.0, t);
  assert.equal(ramped.shouldShed(PRIORITY.BACKGROUND, 0.01), false);
  for (let i = 0; i < 5; i++) { t += 1000; ramped.update(1.0, t); }
  assert.ok(ramped.currentShedFraction > 0 && ramped.currentShedFraction < 0.5);
  assert.equal(ramped.shouldShed(PRIORITY.BACKGROUND, 0.9), false);
  ok(`after 5s, admission uses the ramped ${ramped.currentShedFraction.toFixed(2)} probability instead of instant 100% shedding`);

  for (let i = 0; i < 70; i++) { t += 1000; ramped.update(0.5, t); }
  assert.ok(ramped.currentShedFraction < 0.01);
  ok("recovery also ramps down, preventing an overload/restore flap");
}

console.log("\nPhase 4: concurrency, cost, adaptive limits and load shedding all verified.");
