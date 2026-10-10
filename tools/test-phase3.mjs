import assert from "node:assert/strict";
import { FakeRedis } from "./fake-redis.mjs";
import { createQuotaService, ROTATE_PENDING } from "../code/phase3-db-redis/quota-service.mjs";

const ok = (m) => console.log(`  ok  ${m}`);
let clock = Date.parse("2026-10-09T12:00:00Z");
const r = new FakeRedis({ now: () => clock });

// ---------------------------------------------------------------- fake DB
let policyReads = 0;
let usageReads = 0;
let failNextApply = false;
const usage = new Map();
const flushIds = new Set();
const basePlan = {
  plan_id: "pro", suspended: false, burst_capacity: 20, refill_per_sec: 10,
  monthly_quota: 100, overage_allowed: false, limit_override: null,
};
const customers = new Map([
  ["acme", { ...basePlan }],
  ["tiny", { ...basePlan, plan_id: "free", burst_capacity: 5, refill_per_sec: 1, monthly_quota: 10 }],
  ["whale", { ...basePlan, plan_id: "enterprise", burst_capacity: 100, refill_per_sec: 50, monthly_quota: null, overage_allowed: true }],
  ["vip", { ...basePlan, plan_id: "free", limit_override: { burst_capacity: 50, monthly_quota: 9999 } }],
  ["deadbeat", { ...basePlan, suspended: true }],
  ["roll", { ...basePlan }],
  ["crashy", { ...basePlan }],
  ["loss", { ...basePlan, burst_capacity: 5, monthly_quota: 3 }],
]);

const db = {
  async getCustomerWithPlan(id) {
    policyReads++;
    return customers.get(id) ? { ...customers.get(id) } : null;
  },
  async getUsage(customerId, period) {
    usageReads++;
    return usage.get(`${customerId}:${period}`)?.units ?? 0;
  },
  async applyUsageBatch(flushId, customerId, period, { units, requests }) {
    if (failNextApply) { failNextApply = false; throw new Error("database unavailable"); }
    if (flushIds.has(flushId)) return false;
    // In Postgres, inserting flush_id and incrementing this row happen in one transaction.
    flushIds.add(flushId);
    const key = `${customerId}:${period}`;
    const cur = usage.get(key) ?? { units: 0, requests: 0 };
    usage.set(key, { units: cur.units + units, requests: cur.requests + requests });
    return true;
  },
};

let failDeleteProcessingOnce = false;
const redis = {
  async get(k) { return r.command(["GET", k]); },
  async set(k, v, ttlMs) { return r.command(["SET", k, v, "PX", ttlMs]); },
  async del(k) {
    if (failDeleteProcessingOnce && k.includes(":processing:")) {
      failDeleteProcessingOnce = false;
      throw new Error("worker died after database commit");
    }
    return r.command(["DEL", k]);
  },
  async scanKeys(pattern) { return r.command(["KEYS", pattern]); }, // fake only
  async hmget(k, ...fields) { return r.command(["HMGET", k, ...fields]); },
};

const ev = async (script, keys, argv) => r.eval(script, keys, argv.map(String));
let seq = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const svc = createQuotaService({ db, eval: ev, redis, now: () => clock, id: nextId });

// ------------------------------------------------------------- policy cache
{
  console.log("policy cache");
  policyReads = 0;
  const first = await svc.getPolicy("acme");
  assert.equal(first.cached, false);
  for (let i = 0; i < 500; i++) await svc.getPolicy("acme");
  assert.equal(policyReads, 1);
  ok("501 lookups caused one Postgres policy read");

  clock += 61_000;
  assert.equal((await svc.getPolicy("acme")).cached, false);
  assert.equal(policyReads, 2);
  ok("policy refreshes after TTL");

  await svc.invalidatePolicy("acme");
  await svc.getPolicy("acme");
  assert.equal(policyReads, 3);
  ok("explicit invalidation makes a plan change immediate");

  const vip = await svc.getPolicy("vip");
  assert.equal(vip.burstCapacity, 50);
  assert.equal(vip.monthlyQuota, 9999);
  assert.equal(vip.refillPerSec, 10);
  ok("customer overrides merge field-by-field with the plan");
}

// --------------------------------------------------------- hot path + gates
{
  console.log("hot request path");
  usageReads = 0;
  let allowed = 0;
  for (let i = 0; i < 12; i++) if ((await svc.check("tiny")).allowed) allowed++;
  assert.equal(allowed, 5);
  assert.equal(usageReads, 1);
  ok("burst 12 allowed 5, and only the cold first request read durable usage");

  const throttled = await svc.check("tiny");
  assert.equal(throttled.reason, "rate_limited");
  const p = svc.period(clock);
  assert.equal(Number(await redis.get(`quota:{tiny:${p}}:used`)), 5);
  ok("rate-rejected requests consumed no monthly quota");

  const quotaKeys = await redis.scanKeys(`quota:{tiny:${p}}:*`);
  assert.equal(new Set(quotaKeys.map((k) => k.match(/\{[^}]+\}/)?.[0])).size, 1);
  ok("all multi-key quota state shares one Redis Cluster hash tag");

  await assert.rejects(() => svc.check("tiny", { cost: -1 }), RangeError);
  const huge = await svc.check("tiny", { cost: 6 });
  assert.equal(huge.reason, "cost_exceeds_burst_capacity");
  ok("invalid and impossible costs fail before mutating Redis");
}

// ------------------------------------------------------------ quota + cost
{
  console.log("quota and weighted cost");
  let passed = 0;
  let hit;
  for (let i = 0; i < 20; i++) {
    clock += 2_000;
    const result = await svc.check("tiny");
    if (result.allowed) passed++;
    else if (result.reason === "quota_exceeded") { hit = result; break; }
  }
  assert.equal(passed, 5);
  assert.equal(hit.used, 10);
  ok("quota stops exactly at 10 settled+pending units");

  const whale = await svc.check("whale");
  assert.equal(whale.allowed, true);
  assert.equal(whale.quota, null);
  ok("uncapped plans remain metered without being quota-rejected");

  clock += 5_000;
  const weighted = await svc.check("acme", { cost: 15 });
  assert.equal(weighted.used, 15);
  ok("one request may consume 15 units");
}

// ------------------------------------------------------ rotation safety edges
{
  console.log("processing rotation safety");
  const unitsKey = "quota:{rotation:2026-10}:pending:units";
  const requestsKey = "quota:{rotation:2026-10}:pending:requests";
  const processKey = "quota:{rotation:2026-10}:processing:reused";
  r.command(["SET", unitsKey, 7]);
  r.command(["SET", requestsKey, 2]);
  r.command(["SET", processKey, "wrong-type-existing-value"]);

  const collision = await ev(ROTATE_PENDING,
    [unitsKey, requestsKey, processKey],
    ["reused", "rotation", "2026-10", 60_000]);
  assert.equal(collision[0], -3);
  assert.equal(Number(r.command(["GET", unitsKey])), 7);
  assert.equal(Number(r.command(["GET", requestsKey])), 2);
  assert.equal(r.command(["GET", processKey]), "wrong-type-existing-value");
  ok("a repeated ID or wrong-type destination cannot overwrite an immutable batch or delete pending usage");

  r.command(["DEL", processKey]);
  const invalidTtl = await ev(ROTATE_PENDING,
    [unitsKey, requestsKey, processKey],
    ["new", "rotation", "2026-10", 10.5]);
  assert.equal(invalidTtl[0], -2);
  assert.equal(Number(r.command(["GET", unitsKey])), 7);
  assert.equal(r.command(["EXISTS", processKey]), 0);
  ok("a fractional processing TTL fails before any mutation");

  r.command(["DEL", unitsKey, requestsKey]);
}

// ----------------------------------------------------- idempotent write-behind
{
  console.log("idempotent processing batches");
  const p = svc.period(clock);
  assert.equal(usage.get(`tiny:${p}`), undefined);

  const first = await svc.flushUsage();
  assert.equal(first.flushedUnits, 26);   // tiny 10 + whale 1 + acme 15
  assert.equal(first.flushedRequests, 12); // tiny 10 + whale 1 + acme 1
  assert.equal(usage.get(`acme:${p}`).units, 15);
  assert.equal(usage.get(`acme:${p}`).requests, 1);
  ok("one flush kept weighted units separate from raw request count");

  const second = await svc.flushUsage();
  assert.equal(second.flushedUnits, 0);
  ok("re-running with no new work is a no-op");

  // Failure before the DB commit: immutable processing record remains.
  clock += 5_000;
  await svc.check("crashy", { cost: 7 });
  failNextApply = true;
  await assert.rejects(() => svc.flushUsage(), /database unavailable/);
  assert.equal((await redis.scanKeys("quota:{*}:processing:*")).length, 1);
  ok("DB failure leaves a discoverable processing record instead of losing the delta");

  const retry = await svc.flushUsage();
  assert.equal(retry.flushedUnits, 7);
  assert.equal(usage.get(`crashy:${p}`).units, 7);
  ok("the next worker safely applies that same batch");

  // Ambiguous success: DB committed, but worker died before Redis cleanup.
  clock += 5_000;
  await svc.check("crashy", { cost: 4 });
  failDeleteProcessingOnce = true;
  await assert.rejects(() => svc.flushUsage(), /worker died/);
  const before = usage.get(`crashy:${p}`).units;
  assert.equal(before, 11);
  assert.equal((await redis.scanKeys("quota:{*}:processing:*")).length, 1);
  const replay = await svc.flushUsage();
  assert.equal(replay.flushedUnits, 0); // duplicate UUID was ignored by DB
  assert.equal(usage.get(`crashy:${p}`).units, 11);
  ok("ambiguous commit replays by UUID without double counting");
}

// ----------------------------------------------------------- month rollover
{
  console.log("month rollover");
  clock = Date.parse("2026-10-31T23:59:59Z");
  await svc.invalidatePolicy("roll");
  await svc.check("roll", { cost: 3, t: clock });
  clock = Date.parse("2026-11-01T00:00:02Z");
  const result = await svc.flushUsage();
  assert.ok(result.flushedUnits >= 3);
  assert.equal(usage.get("roll:2026-10").units, 3);
  assert.equal(usage.get("roll:2026-11"), undefined);
  ok("an October delta discovered in November is still written to October");
}

// ------------------------------------------------------ Redis loss boundary
{
  console.log("Redis loss boundary");
  const p = svc.period(clock);
  await svc.check("loss", { cost: 1, t: clock });
  await svc.check("loss", { cost: 1, t: clock });
  await svc.check("loss", { cost: 1, t: clock });
  await svc.flushUsage();
  assert.equal(usage.get(`loss:${p}`).units, 3);
  for (const key of await redis.scanKeys("*")) await redis.del(key);
  ok("simulated total Redis loss after durable settlement");

  // loss was already at 3 in this period, so cold seeding keeps it shut.
  const atQuota = await svc.check("loss", { t: clock + 10_000 });
  assert.equal(atQuota.reason, "quota_exceeded");
  assert.equal(atQuota.used, 3);
  ok("settled usage survives and seeds the new hot counter");

  // Be honest: an accepted but unrotated Redis delta cannot survive total loss.
  clock += 20_000;
  await svc.check("acme", { cost: 2 });
  const durableBefore = usage.get(`acme:${p}`)?.units ?? 0;
  for (const key of await redis.scanKeys("*")) await redis.del(key);
  const durableAfter = usage.get(`acme:${p}`)?.units ?? 0;
  assert.equal(durableAfter, durableBefore);
  ok("unflushed usage is lost on total Redis loss: this is a bounded-loss operational quota, not a hard financial reservation");
}

// ---------------------------------------------------------- safe cold seed
{
  console.log("manual cold seed guard");
  clock += 60_000;
  await svc.check("roll", { cost: 1 });
  await assert.rejects(() => svc.forceColdSeedAfterFlush("roll"), /unsettled usage/);
  ok("manual rehydration refuses to run while unsettled usage exists");
  await svc.flushUsage();
  const cold = await svc.forceColdSeedAfterFlush("roll");
  assert.ok(cold.usageFromDb >= 1);
  ok("after settlement, forcing a cold seed is safe");
}

console.log("\nPhase 3: hot checks, idempotent batches, rollover, and loss boundaries verified.");
