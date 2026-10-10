import assert from "node:assert/strict";
import { FakeRedis } from "./fake-redis.mjs";
import {
  FIXED_WINDOW,
  SLIDING_WINDOW_LOG,
  TOKEN_BUCKET,
  GCRA,
} from "../code/phase2-redis/scripts.mjs";
import { createRedisLimiter } from "../code/phase2-redis/limiter.mjs";

const ok = (m) => console.log(`  ok  ${m}`);

let clock = 1_700_000_000_000;
const redis = new FakeRedis({ now: () => clock });
const ev = async (script, keys, argv) => redis.eval(script, keys, argv.map(String));

// ------------------------------------------- the race the Lua script prevents
{
  console.log("the race condition (why Lua, not three round trips)");

  // Naive: GET -> decide in Node -> SET. Two pods interleave in the gap.
  const store = new Map();
  const naive = {
    async get(k) { return store.get(k); },
    async set(k, v) { store.set(k, v); },
  };

  async function naiveCheck(key, limit) {
    const current = Number((await naive.get(key)) ?? 0); // round trip 1
    if (current >= limit) return false;
    await naive.set(key, current + 1);                   // round trip 2
    return true;
  }

  // Ten pods hit the same key concurrently with a limit of 1.
  store.set("k", 0);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => naiveCheck("k", 1))
  );
  const allowedNaive = results.filter(Boolean).length;
  assert.ok(allowedNaive > 1, `expected the race to overshoot, got ${allowedNaive}`);
  ok(`naive check-then-set let ${allowedNaive} through when the limit was 1`);
  assert.equal(Number(store.get("k")), 1);
  ok("and the stored counter says 1, so the overshoot is invisible afterwards");

  // Atomic: the same ten, through the script.
  const atomic = await Promise.all(
    Array.from({ length: 10 }, () => ev(FIXED_WINDOW, ["race:atomic"], [1, 60_000]))
  );
  const allowedAtomic = atomic.filter(([a]) => a === 1).length;
  assert.equal(allowedAtomic, 1);
  ok("the atomic script let exactly 1 through, which is the entire argument for Lua");
}

// ------------------------------------------------------------- fixed window
{
  console.log("FIXED_WINDOW script");
  let allowed = 0;
  for (let i = 0; i < 120; i++) {
    const [a] = await ev(FIXED_WINDOW, ["fw:u1"], [100, 60_000]);
    if (a === 1) allowed++;
  }
  assert.equal(allowed, 100);
  ok("allows exactly the limit");

  const [, , ttl] = await ev(FIXED_WINDOW, ["fw:u1"], [100, 60_000]);
  assert.ok(ttl > 0 && ttl <= 60_000, `ttl was ${ttl}`);
  ok(`the key carries a TTL (${ttl}ms), so it cannot leak`);

  // the INCR/EXPIRE pair is set together, so a fresh key is never immortal
  const before = redis.command(["PTTL", "fw:fresh"]);
  assert.equal(before, -2);
  await ev(FIXED_WINDOW, ["fw:fresh"], [5, 30_000]);
  assert.ok(redis.command(["PTTL", "fw:fresh"]) > 0);
  ok("a brand new counter gets its expiry in the same atomic step as its first INCR");
}

// --------------------------------------------------------- sliding window log
{
  console.log("SLIDING_WINDOW_LOG script");
  const t0 = clock;
  let allowed = 0;
  for (let i = 0; i < 12; i++) {
    const [a] = await ev(SLIDING_WINDOW_LOG, ["swl:u1"], [t0, 60_000, 10, `r${i}`]);
    if (a === 1) allowed++;
  }
  assert.equal(allowed, 10);
  ok("allows exactly the limit");

  const [blocked, , retry] = await ev(SLIDING_WINDOW_LOG, ["swl:u1"], [t0 + 1000, 60_000, 10, "x"]);
  assert.equal(blocked, 0);
  assert.ok(retry > 58_000 && retry <= 60_000, `retry was ${retry}`);
  ok(`rejection reports when the oldest entry ages out (${retry}ms)`);

  // no boundary burst: 59.9s later still blocked
  const [stillBlocked] = await ev(SLIDING_WINDOW_LOG, ["swl:u1"], [t0 + 59_900, 60_000, 10, "y"]);
  assert.equal(stillBlocked, 0);
  ok("still blocked at 59.9s, so there is no boundary hole");

  const [free] = await ev(SLIDING_WINDOW_LOG, ["swl:u1"], [t0 + 60_100, 60_000, 10, "z"]);
  assert.equal(free, 1);
  ok("allowed again once the window has genuinely passed");
}

// --------------------------------------------------------------- token bucket
{
  console.log("TOKEN_BUCKET script");
  const t0 = clock;
  let burst = 0;
  for (let i = 0; i < 20; i++) {
    const [a] = await ev(TOKEN_BUCKET, ["tb:u1"], [t0, 10, 2, 1, 30_000]);
    if (a === 1) burst++;
  }
  assert.equal(burst, 10);
  ok("absorbs a burst of capacity");

  const [a0, tokens0, retry0] = await ev(TOKEN_BUCKET, ["tb:u1"], [t0, 10, 2, 1, 30_000]);
  assert.equal(a0, 0);
  assert.equal(Number(tokens0), 0);
  assert.equal(retry0, 500);
  ok(`empty bucket rejects and asks for ${retry0}ms, exactly one token at 2/sec`);

  // the tostring() detail: fractional tokens survive the round trip
  const [a1, tokens1] = await ev(TOKEN_BUCKET, ["tb:u1"], [t0 + 750, 10, 2, 1, 30_000]);
  assert.equal(a1, 1);
  assert.ok(!Number.isInteger(Number(tokens1)), `expected a fraction, got ${tokens1}`);
  ok(`fractional token count survived as a string: ${tokens1} (without tostring() Redis would return 0)`);

  // cost-weighted
  const [expensive] = await ev(TOKEN_BUCKET, ["tb:u2"], [t0, 10, 2, 8, 30_000]);
  assert.equal(expensive, 1);
  const [tooExpensive] = await ev(TOKEN_BUCKET, ["tb:u2"], [t0, 10, 2, 8, 30_000]);
  assert.equal(tooExpensive, 0);
  ok("a request can spend many tokens at once, which is how cost-based limiting works");
}

// ----------------------------------------------------------------------- GCRA
{
  console.log("GCRA script");
  const t0 = clock;
  const interval = 100;   // 10/sec
  const tolerance = 500;  // burst of 5

  let burst = 0;
  for (let i = 0; i < 20; i++) {
    const [a] = await ev(GCRA, ["g:u1"], [t0, interval, tolerance, 1, 5000]);
    if (a === 1) burst++;
  }
  assert.equal(burst, 5);
  ok("burst tolerance caps the instantaneous burst at 5");

  const [, retry] = await ev(GCRA, ["g:u1"], [t0, interval, tolerance, 1, 5000]);
  assert.equal(retry, 100);
  ok(`exact retry-after of ${retry}ms falls out of the algorithm for free`);

  let sustained = 0;
  for (let i = 1; i <= 40; i++) {
    const [a] = await ev(GCRA, ["g:u2"], [t0 + i * 100, interval, tolerance, 1, 5000]);
    if (a === 1) sustained++;
  }
  assert.equal(sustained, 40);
  ok("one request every 100ms sustains forever");

  const raw = redis.command(["GET", "g:u2"]);
  assert.ok(raw && !raw.includes(","), "GCRA state should be a single value");
  ok(`state is one number per key: ${raw}`);
}

// ------------------------------------------------- the limiter wrapper itself
{
  console.log("createRedisLimiter wrapper");
  const limiter = createRedisLimiter({ eval: ev, prefix: "app:" });
  const now = clock;

  let allowed = 0;
  for (let i = 0; i < 25; i++) {
    const r = await limiter.tokenBucket("alice", { capacity: 20, refillPerSec: 5, now });
    if (r.allowed) allowed++;
  }
  assert.equal(allowed, 20);
  ok("tokenBucket() through the wrapper honours capacity");

  const denied = await limiter.tokenBucket("alice", { capacity: 20, refillPerSec: 5, now });
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 200);
  ok(`wrapper surfaces retryAfterMs = ${denied.retryAfterMs}`);

  const fw = await limiter.fixedWindow("bob", { limit: 3, windowMs: 60_000, now });
  assert.equal(fw.allowed, true);
  assert.equal(fw.remaining, 2);
  ok("fixedWindow() reports remaining correctly");

  const g = await limiter.gcra("carol", { limit: 10, periodMs: 1000, burst: 3, now });
  assert.equal(g.allowed, true);
  ok("gcra() works through the wrapper");
}

// --------------------------------------------------------- fail open / closed
{
  console.log("behaviour when Redis is down");
  const exploding = async () => { throw new Error("ECONNREFUSED"); };

  const open = createRedisLimiter({ eval: exploding, failOpen: true });
  const openResult = await open.tokenBucket("x", { capacity: 5, refillPerSec: 1 });
  assert.equal(openResult.allowed, true);
  assert.equal(openResult.degraded, true);
  ok("failOpen: Redis outage lets traffic through and flags itself degraded");

  const closed = createRedisLimiter({ eval: exploding, failOpen: false });
  const closedResult = await closed.tokenBucket("x", { capacity: 5, refillPerSec: 1 });
  assert.equal(closedResult.allowed, false);
  assert.equal(closedResult.degraded, true);
  ok("failClosed: Redis outage rejects instead, for endpoints where that is safer");

  let captured = null;
  const reporting = createRedisLimiter({ eval: exploding, onError: (e) => { captured = e.message; } });
  await reporting.gcra("x", { limit: 1, periodMs: 1000, burst: 1 });
  assert.equal(captured, "ECONNREFUSED");
  ok("the error still reaches your telemetry rather than being swallowed");
}

// ---------------------------------------------------------- adversarial edges
{
  console.log("clock regression, ID collision, and configuration guards");
  const t0 = clock;
  await ev(TOKEN_BUCKET, ["tb:clock"], [t0, 1, 1, 1, 10_000]);
  await ev(TOKEN_BUCKET, ["tb:clock"], [t0 + 1000, 1, 1, 1, 10_000]);
  for (let i = 0; i < 5; i++) {
    assert.equal((await ev(TOKEN_BUCKET, ["tb:clock"], [t0, 1, 1, 1, 10_000]))[0], 0);
    assert.equal((await ev(TOKEN_BUCKET, ["tb:clock"], [t0 + 1000, 1, 1, 1, 10_000]))[0], 0);
  }
  ok("alternating slow/correct app clocks cannot mint Redis tokens");

  const first = await ev(SLIDING_WINDOW_LOG, ["swl:collision"], [t0, 60_000, 10, "same-id"]);
  const duplicate = await ev(SLIDING_WINDOW_LOG, ["swl:collision"], [t0 + 1, 60_000, 10, "same-id"]);
  assert.equal(first[0], 1);
  assert.equal(duplicate[0], -3);
  ok("ZADD NX detects a duplicate member instead of silently undercounting");

  const guarded = createRedisLimiter({ eval: ev });
  const nearBoundary = await guarded.fixedWindow("edge", { limit: 10, windowMs: 60_000, now: 60_000 * 1000 + 59_500 });
  assert.ok(nearBoundary.resetMs <= 500, `resetMs was ${nearBoundary.resetMs}`);
  ok(`fixed-window reset metadata points to the real boundary (${nearBoundary.resetMs}ms)`);

  const gcraExact = await guarded.gcra("weighted", { limit: 10, periodMs: 1000, burst: 5, cost: 5, now: t0 });
  const gcraTooLarge = await guarded.gcra("weighted-too-large", { limit: 10, periodMs: 1000, burst: 5, cost: 6, now: t0 });
  assert.equal(gcraExact.allowed, true);
  assert.equal(gcraTooLarge.reason, "cost_exceeds_burst");
  assert.equal(gcraTooLarge.retryAfterMs, null);
  const luaTooLarge = await ev(GCRA, ["g:too-large"], [t0, 100, 500, 6, 5000]);
  assert.equal(luaTooLarge[0], -4);
  assert.equal(redis.command(["EXISTS", "g:too-large"]), 0);
  ok("weighted GCRA terminally rejects work larger than its burst allowance");

  const fractional = await ev(FIXED_WINDOW, ["fw:fractional"], [10, 10.5]);
  assert.equal(fractional[0], -2);
  assert.equal(redis.command(["EXISTS", "fw:fractional"]), 0);
  assert.throws(() => guarded.fixedWindow("x", { limit: 1, windowMs: 1000.5, now: t0 }), RangeError);
  assert.throws(() => guarded.tokenBucket("x", { capacity: 1, refillPerSec: 1, ttlMs: 10.5, now: t0 }), RangeError);
  ok("fractional Redis TTLs fail before any state mutation");

  assert.throws(() => guarded.tokenBucket("x", { capacity: 1, refillPerSec: 0 }), RangeError);
  assert.throws(() => guarded.gcra("x", { limit: 0, periodMs: 1000, burst: 1 }), RangeError);
  ok("configuration errors throw before Redis and are never converted into fail-open decisions");
}

console.log("\nPhase 2: every Lua script executed in a real Lua VM and behaved as described.");
