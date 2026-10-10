import assert from "node:assert/strict";
import {
  createFixedWindow,
  createSlidingWindowLog,
  createSlidingWindowCounter,
  createTokenBucket,
  createLeakyBucket,
  createGCRA,
} from "../code/phase1-bare/limiters.mjs";

const ok = (m) => console.log(`  ok  ${m}`);
const T = 60_000 * 1000; // a clean window boundary

// -------------------------------------------------------------- fixed window
{
  console.log("fixed window");
  const fw = createFixedWindow({ limit: 100, windowMs: 60_000 });

  let n = 0;
  for (let i = 0; i < 120; i++) if (fw("a", T + 59_000).allowed) n++;
  assert.equal(n, 100);
  ok("allows exactly the limit inside one window");

  let after = 0;
  for (let i = 0; i < 120; i++) if (fw("a", T + 60_500).allowed) after++;
  assert.equal(after, 100);
  ok("the boundary burst really is 2x: 200 allowed across ~1.5s");

  assert.equal(fw("b", T + 59_000).allowed, true);
  ok("keys are independent");
}

// --------------------------------------------------------- sliding window log
{
  console.log("sliding window log");
  const sw = createSlidingWindowLog({ limit: 100, windowMs: 60_000 });

  let n = 0;
  for (let i = 0; i < 120; i++) if (sw("a", T + 59_000).allowed) n++;
  assert.equal(n, 100);
  ok("allows exactly the limit");

  // the same boundary attack that beat fixed window
  let after = 0;
  for (let i = 0; i < 120; i++) if (sw("a", T + 60_500).allowed) after++;
  assert.equal(after, 0);
  ok("blocks the boundary burst completely, which is the whole point");

  // once the window has fully passed, budget returns
  let later = 0;
  for (let i = 0; i < 120; i++) if (sw("a", T + 59_000 + 60_001).allowed) later++;
  assert.equal(later, 100);
  ok("budget returns once the old entries age out");
}

// ----------------------------------------------------- sliding window counter
{
  console.log("sliding window counter (Cloudflare-style approximation)");
  const sc = createSlidingWindowCounter({ limit: 100, windowMs: 60_000 });

  // fill window 1 completely
  let n = 0;
  for (let i = 0; i < 120; i++) if (sc("a", T + 59_000).allowed) n++;
  assert.equal(n, 100);
  ok("allows the limit in the first window");

  // 25% into the next window, 75% of the previous count still counts
  const atQuarter = T + 60_000 + 15_000;
  let allowedAtQuarter = 0;
  for (let i = 0; i < 200; i++) if (sc("a", atQuarter).allowed) allowedAtQuarter++;
  assert.equal(allowedAtQuarter, 25);
  ok(`25% into the new window only 25 get through (previous window weighted 75%)`);

  // and a fresh key is unaffected
  assert.equal(sc("fresh", atQuarter).allowed, true);
  ok("unrelated keys keep their own history");
}

// --------------------------------------------------------------- token bucket
{
  console.log("token bucket");
  const tb = createTokenBucket({ capacity: 10, refillPerSec: 2 });

  let burst = 0;
  for (let i = 0; i < 20; i++) if (tb("a", T).allowed) burst++;
  assert.equal(burst, 10);
  ok("a full bucket absorbs a burst equal to capacity");

  const denied = tb("a", T);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 500,
    `retryAfterMs = ${denied.retryAfterMs}`);
  ok(`rejection suggests waiting ${denied.retryAfterMs}ms, which matches 2/sec`);

  assert.equal(tb("a", T + 500).allowed, true);
  ok("one token back after 500ms");

  // idle forever still only buys `capacity`
  let afterIdle = 0;
  for (let i = 0; i < 20; i++) if (tb("a", T + 3_600_000).allowed) afterIdle++;
  assert.equal(afterIdle, 10);
  ok("an hour idle still only buys 10 tokens, so capacity caps the burst");

  // cost-weighted requests
  const tb2 = createTokenBucket({ capacity: 10, refillPerSec: 2 });
  assert.equal(tb2("x", T, 7).allowed, true);
  assert.equal(tb2("x", T, 7).allowed, false);
  assert.equal(tb2("x", T, 3).allowed, true);
  ok("a single request can cost more than one token");
}

// --------------------------------------------------------------- leaky bucket
{
  console.log("leaky bucket (queue)");
  const lb = createLeakyBucket({ queueSize: 5, leakPerSec: 2 });

  const delays = [];
  for (let i = 0; i < 5; i++) {
    const r = lb("a", T);
    assert.equal(r.allowed, true);
    delays.push(r.delayMs);
  }
  assert.deepEqual(delays, [0, 500, 1000, 1500, 2000]);
  ok(`queued requests get spaced 500ms apart: ${delays.join(", ")}ms`);

  assert.equal(lb("a", T).allowed, false);
  ok("only rejects once the queue is actually full");

  // the queue drains at the leak rate
  assert.equal(lb("a", T + 1000).allowed, true);
  ok("after 1s two slots have leaked, so there is room again");
}

// ----------------------------------------------------------------------- GCRA
{
  console.log("GCRA");
  // 10 per second sustained, burst of 5
  const g = createGCRA({ limit: 10, periodMs: 1000, burst: 5 });

  let burst = 0;
  for (let i = 0; i < 20; i++) if (g("a", T).allowed) burst++;
  assert.equal(burst, 5);
  ok("burst parameter caps the instantaneous burst at 5");

  const denied = g("a", T);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 100,
    `retryAfterMs = ${denied.retryAfterMs}`);
  ok(`tells you exactly when to come back: ${denied.retryAfterMs}ms (emission interval is 100ms)`);

  // sustained rate: one request every 100ms should be allowed forever
  let sustained = 0;
  for (let i = 1; i <= 50; i++) if (g("b", T + i * 100).allowed) sustained++;
  assert.equal(sustained, 50);
  ok("one request every 100ms sustains indefinitely, matching 10/sec");

  // state is a single number per key, which is the selling point
  const g2 = createGCRA({ limit: 10, periodMs: 1000, burst: 5 });
  g2("c", T);
  ok("one number of state per key, no list of timestamps");
}

// -------------------------------------------------------- adversarial metadata
{
  console.log("clock regression and input guards");
  const tb = createTokenBucket({ capacity: 1, refillPerSec: 1 });
  assert.equal(tb("clock", T).allowed, true);
  assert.equal(tb("clock", T + 1000).allowed, true);
  for (let i = 0; i < 5; i++) {
    assert.equal(tb("clock", T).allowed, false);       // slow host
    assert.equal(tb("clock", T + 1000).allowed, false); // correct host, no new time
  }
  ok("alternating a slow and correct clock cannot mint tokens");

  const g = createGCRA({ limit: 10, periodMs: 1000, burst: 5 });
  assert.equal(g("meta", T).remaining, 4);
  assert.equal(g("exact", T, 5).allowed, true);
  assert.equal(g("oversized", T, 6).reason, "cost_exceeds_burst");
  let afterOversized = 0;
  for (let i = 0; i < 6; i++) if (g("oversized", T).allowed) afterOversized++;
  assert.equal(afterOversized, 5);
  ok("GCRA allows cost=burst, terminally rejects cost>burst, and leaves state untouched");

  const clocks = [
    createFixedWindow({ limit: 2 }),
    createSlidingWindowLog({ limit: 2 }),
    createSlidingWindowCounter({ limit: 2 }),
    createTokenBucket({ capacity: 2 }),
    createLeakyBucket({ queueSize: 2 }),
    createGCRA({ burst: 2 }),
  ];
  for (const check of clocks) {
    assert.throws(() => check("bad-clock", NaN), RangeError);
    assert.equal(check("bad-clock", T).allowed, true);
  }
  ok("NaN clocks are rejected before state access; the next valid call remains pristine");

  assert.throws(() => createFixedWindow({ limit: 0 }), RangeError);
  assert.throws(() => createTokenBucket({ refillPerSec: 0 }), RangeError);
  assert.throws(() => tb("x", T, -1), RangeError);
  assert.equal(tb("x", T, 2).reason, "cost_exceeds_capacity");
  ok("invalid configuration and impossible costs fail without mutating state");
}

console.log("\nPhase 1: all six algorithms behave as described.");
