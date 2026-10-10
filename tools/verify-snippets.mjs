/**
 * Runs every code snippet from rate-limiting-article.md and asserts the
 * behaviour the article claims. Not shipped with the post, just proof the
 * examples are real.
 */
import assert from "node:assert/strict";
import express from "express";
import { rateLimit, ipKeyGenerator, MINUTE } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

const ok = (m) => console.log(`  ok  ${m}`);

// ------------------------------------------------------------ fixed window
{
  const hits = new Map();

  function fixedWindow(key, limit = 100, windowMs = 60_000, now = Date.now()) {
    const bucket = Math.floor(now / windowMs);
    const entry = hits.get(key);

    if (!entry || entry.bucket !== bucket) {
      hits.set(key, { bucket, count: 1 });
      return { allowed: true, remaining: limit - 1 };
    }

    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
    };
  }

  console.log("fixedWindow");
  const t = 60_000 * 1000; // sitting at a clean window edge
  let allowed = 0;
  for (let i = 0; i < 100; i++) if (fixedWindow("u1", 100, 60_000, t + 59_000).allowed) allowed++;
  assert.equal(allowed, 100);
  ok("first 100 in the window are allowed");

  assert.equal(fixedWindow("u1", 100, 60_000, t + 59_500).allowed, false);
  ok("the 101st in the same window is rejected");

  // same caller, one second later, new clock bucket
  let after = 0;
  for (let i = 0; i < 100; i++) if (fixedWindow("u1", 100, 60_000, t + 60_100).allowed) after++;
  assert.equal(after, 100);
  ok("100 more allowed immediately after the boundary -> 200 in ~2s, the 2x claim holds");
}

// ------------------------------------------------------------ token bucket
{
  const buckets = new Map();

  function takeToken(key, capacity = 10, refillPerSec = 2, now = Date.now()) {
    const b = buckets.get(key) ?? { tokens: capacity, lastRefill: now };
    const elapsedSec = (now - b.lastRefill) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
    b.lastRefill = now;

    const allowed = b.tokens >= 1;
    if (allowed) b.tokens -= 1;
    buckets.set(key, b);

    return {
      allowed,
      retryAfterSec: allowed ? 0 : Math.ceil((1 - b.tokens) / refillPerSec),
    };
  }

  console.log("takeToken");
  const t0 = 1_000_000;
  let burst = 0;
  for (let i = 0; i < 10; i++) if (takeToken("u2", 10, 2, t0).allowed) burst++;
  assert.equal(burst, 10);
  ok("a full bucket absorbs a burst of 10 at once");

  const over = takeToken("u2", 10, 2, t0);
  assert.equal(over.allowed, false);
  assert.ok(over.retryAfterSec >= 1, `retryAfterSec was ${over.retryAfterSec}`);
  ok(`the 11th is rejected and suggests waiting ${over.retryAfterSec}s`);

  // 2 tokens/sec means 1 request every 500ms sustained
  assert.equal(takeToken("u2", 10, 2, t0 + 500).allowed, true);
  ok("one token is back after 500ms at 2/sec");

  // long quiet period must cap at capacity, not bank forever
  for (let i = 0; i < 10; i++) assert.equal(takeToken("u2", 10, 2, t0 + 600_000).allowed, true);
  assert.equal(takeToken("u2", 10, 2, t0 + 600_000).allowed, false);
  ok("ten minutes idle still only buys 10 tokens, so capacity really caps the burst");
}

// ------------------------------------------- express-rate-limit, as configured
{
  console.log("express-rate-limit (basic config from the article)");
  assert.equal(MINUTE, 60_000);
  ok("MINUTE is 60000, so `15 * MINUTE` is 15 minutes");

  const app = express();
  app.set("trust proxy", false);
  app.use("/api", rateLimit({
    windowMs: 15 * MINUTE,
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }));
  app.get("/api/ping", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const first = await fetch(`${base}/api/ping`);
  assert.equal(first.status, 200);
  assert.ok(first.headers.get("ratelimit"), "expected a RateLimit header");
  assert.equal(first.headers.get("x-ratelimit-limit"), null);
  ok(`draft-7 header present: RateLimit: ${first.headers.get("ratelimit")}`);
  ok("legacy X-RateLimit-* headers are absent, as configured");
  server.close();
}

// -------------------------------------- keyGenerator + per-plan limit variant
{
  console.log("express-rate-limit (keyGenerator + function limit)");
  const app = express();

  // stand in for real auth
  app.use((req, _res, next) => {
    const plan = req.headers["x-plan"];
    if (plan) req.user = { id: req.headers["x-user"] ?? "u", plan };
    next();
  });

  app.use("/api", rateLimit({
    windowMs: 60_000,
    limit: (req) => (req.user?.plan === "pro" ? 1000 : 3),
    keyGenerator: (req) =>
      req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }));
  app.get("/api/ping", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const hit = (plan, user) =>
    fetch(`${base}/api/ping`, { headers: { "x-plan": plan, "x-user": user } });

  const free = [];
  for (let i = 0; i < 5; i++) free.push((await hit("free", "alice")).status);
  assert.deepEqual(free, [200, 200, 200, 429, 429]);
  ok("free plan capped at 3, then 429 (limit-as-a-function works)");

  const pro = (await hit("pro", "bob")).status;
  assert.equal(pro, 200);
  ok("pro user on the same server gets the higher limit (keyGenerator isolates users)");

  const blocked = await hit("free", "alice");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  ok(`429 carries Retry-After: ${blocked.headers.get("retry-after")}`);

  // IPv6 normalisation the article claims
  const a = ipKeyGenerator("2001:db8:1234:5678::1");
  const b = ipKeyGenerator("2001:db8:1234:5678::ffff");
  assert.equal(a, b);
  assert.equal(ipKeyGenerator("203.0.113.9"), "203.0.113.9");
  ok(`two addresses in one subnet collapse to the same key (${a}); IPv4 passes through`);
  server.close();
}

// ------------------------------------------------ RedisStore wiring (stubbed)
{
  console.log("RedisStore option names");
  const seen = [];
  const store = new RedisStore({
    // Minimal fake Redis: the store loads a Lua script, then EVALSHAs it.
    sendCommand: async (...args) => {
      seen.push(args);
      const cmd = String(args[0]).toUpperCase();
      if (cmd === "SCRIPT") return "deadbeef";          // SCRIPT LOAD -> sha
      if (cmd === "EVALSHA" || cmd === "EVAL") return [1, 60_000]; // [hits, resetMs]
      return "OK";
    },
    prefix: "rl:api:",
  });
  store.init({ windowMs: 60_000 });
  const res = await store.increment("user:alice");
  assert.equal(res.totalHits, 1);
  assert.ok(res.resetTime instanceof Date);
  assert.ok(seen.length > 0, "sendCommand was never called");
  assert.ok(seen.flat().some((a) => String(a).includes("rl:api:user:alice")),
    `prefix missing from ${JSON.stringify(seen.flat().filter((a) => String(a).includes("alice")))}`);
  ok("sendCommand + prefix are the right option names and the prefix is applied");
}

// ---------------------------------------------------- fetchWithBackoff logic
{
  console.log("fetchWithBackoff");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waits = [];
  const realFetch = globalThis.fetch;

  async function fetchWithBackoff(url, options = {}, {
    retries = 5, base = 1000, cap = 30_000,
  } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(url, options);

      if (res.status !== 429 && res.status < 500) return res;
      if (attempt === retries) return res;

      const retryAfter = Number(res.headers.get("retry-after"));
      const window = Math.min(cap, base * 2 ** attempt);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.random() * window;

      waits.push(wait);
      await sleep(0); // don't actually wait in the test
    }
  }

  const reply = (status, headers = {}) => new Response("", { status, headers });

  // 200 returns immediately
  globalThis.fetch = async () => reply(200);
  assert.equal((await fetchWithBackoff("/x")).status, 200);
  assert.equal(waits.length, 0);
  ok("a 200 returns on the first attempt with no sleeping");

  // 404 is not retried
  globalThis.fetch = async () => reply(404);
  assert.equal((await fetchWithBackoff("/x")).status, 404);
  assert.equal(waits.length, 0);
  ok("a 404 returns immediately instead of being retried");

  // 429 with Retry-After is obeyed exactly
  waits.length = 0;
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? reply(429, { "retry-after": "7" }) : reply(200));
  assert.equal((await fetchWithBackoff("/x")).status, 200);
  assert.deepEqual(waits, [7000]);
  ok("429 + Retry-After: 7 waits exactly 7000ms, then succeeds");

  // 429 without Retry-After falls back to jittered exponential windows
  waits.length = 0;
  globalThis.fetch = async () => reply(429);
  const exhausted = await fetchWithBackoff("/x", {}, { retries: 4, base: 1000, cap: 30_000 });
  assert.equal(exhausted.status, 429);
  assert.equal(waits.length, 4, "should sleep between each of the 4 retries, not after the last");
  const windows = [1000, 2000, 4000, 8000];
  waits.forEach((w, i) => {
    assert.ok(w >= 0 && w < windows[i], `wait ${i} = ${w} outside [0, ${windows[i]})`);
  });
  ok(`jittered waits stay inside doubling windows: ${waits.map((w) => Math.round(w)).join(", ")}ms`);

  // 5xx is retried too
  waits.length = 0;
  calls = 0;
  globalThis.fetch = async () => (++calls < 3 ? reply(503) : reply(200));
  assert.equal((await fetchWithBackoff("/x")).status, 200);
  assert.equal(waits.length, 2);
  ok("503 is retried and recovers once the upstream comes back");

  // cap is respected
  waits.length = 0;
  globalThis.fetch = async () => reply(429);
  await fetchWithBackoff("/x", {}, { retries: 8, base: 1000, cap: 5000 });
  assert.ok(Math.max(...waits) < 5000, `a wait exceeded the cap: ${Math.max(...waits)}`);
  ok("no wait ever exceeds the cap");

  globalThis.fetch = realFetch;
}

console.log("\nAll snippets behave as the article describes.");
