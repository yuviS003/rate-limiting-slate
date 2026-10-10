/**
 * PHASE 3 — Redis for speed, Postgres for durable settlement.
 *
 * This demonstrates an operational quota with a durable, idempotent
 * write-behind path. Redis still must be configured deliberately: a total
 * Redis data loss can lose usage accepted since the last durable batch. If a
 * contractual hard cap may never overshoot, reserve each charge through a
 * durable event/transaction before acknowledging the protected operation.
 */
import { randomUUID } from "node:crypto";
import { TOKEN_BUCKET } from "../phase2-redis/scripts.mjs";

/**
 * Reserve quota atomically.
 *
 * First call seed=-1. A cold key returns -1 without mutation. Node reads the
 * durable settled amount and retries. Hot requests perform one EVAL and zero
 * database reads.
 */
export const QUOTA_RESERVE = `
local used_key     = KEYS[1]
local pending_unit = KEYS[2]
local pending_req  = KEYS[3]
local cost          = tonumber(ARGV[1])
local quota         = tonumber(ARGV[2])
local seed          = tonumber(ARGV[3])
local ttl           = tonumber(ARGV[4])
local allow_overage = tonumber(ARGV[5])

-- Validate before the first write: Redis script errors do not roll back writes.
if cost == nil or cost <= 0 or cost ~= math.floor(cost)
   or quota == nil or seed == nil or ttl == nil or ttl <= 0 or ttl ~= math.floor(ttl)
   or allow_overage == nil then
  return { -2, '0', 'invalid_arguments' }
end

if redis.call('EXISTS', used_key) == 0 then
  if seed < 0 then
    return { -1, '0', tostring(quota) }
  end
  redis.call('SET', used_key, seed, 'PX', ttl)
end

local used = tonumber(redis.call('GET', used_key))
if quota >= 0 and used + cost > quota and allow_overage == 0 then
  return { 0, tostring(used), tostring(quota) }
end

used = redis.call('INCRBY', used_key, cost)
redis.call('INCRBY', pending_unit, cost)
redis.call('INCR', pending_req)
redis.call('PEXPIRE', pending_unit, ttl)
redis.call('PEXPIRE', pending_req, ttl)
return { 1, tostring(used), tostring(quota) }
`;

/**
 * Atomically rotate two mutable pending counters into an immutable processing
 * record. New requests immediately start filling fresh pending counters while
 * this batch is written to Postgres.
 */
export const ROTATE_PENDING = `
local ttl = tonumber(ARGV[4])
if ARGV[1] == nil or ARGV[1] == ''
   or ARGV[2] == nil or ARGV[2] == ''
   or ARGV[3] == nil or ARGV[3] == ''
   or ttl == nil or ttl <= 0 or ttl ~= math.floor(ttl) then
  return { -2, 0, 0 }
end
-- A repeated UUID must never overwrite an immutable batch.
if redis.call('EXISTS', KEYS[3]) ~= 0 then
  return { -3, 0, 0 }
end

-- These reads can fail on wrong types, but no mutation has happened yet.
local units = tonumber(redis.call('GET', KEYS[1])) or 0
local requests = tonumber(redis.call('GET', KEYS[2])) or 0
if units == 0 and requests == 0 then
  return { 0, 0, 0 }
end

-- Create and expire the recoverable record before deleting mutable counters.
-- With validated inputs these commands cannot partially strand the batch.
redis.call('HSET', KEYS[3],
  'flush_id', ARGV[1],
  'customer_id', ARGV[2],
  'period', ARGV[3],
  'units', units,
  'requests', requests)
redis.call('PEXPIRE', KEYS[3], ttl)
redis.call('DEL', KEYS[1], KEYS[2])
return { 1, units, requests }
`;

export function createQuotaService({
  db,                      // getCustomerWithPlan, getUsage, applyUsageBatch
  eval: evalFn,
  // scanKeys must iterate every Redis Cluster primary with SCAN, never KEYS.
  redis,                   // get, set, del, scanKeys, hmget
  now = () => Date.now(),
  planCacheTtlMs = 60_000,
  processingTtlMs = 7 * 24 * 3600 * 1000,
  id = randomUUID,
}) {
  const period = (t = now()) => new Date(t).toISOString().slice(0, 7);
  const safe = (value) => encodeURIComponent(String(value));
  const slot = (c, p) => `{${safe(c)}:${p}}`;
  const K = {
    plan: (c) => `plan:${safe(c)}`,
    used: (c, p) => `quota:${slot(c, p)}:used`,
    pendingUnits: (c, p) => `quota:${slot(c, p)}:pending:units`,
    pendingRequests: (c, p) => `quota:${slot(c, p)}:pending:requests`,
    processing: (c, p, flushId) => `quota:${slot(c, p)}:processing:${flushId}`,
  };

  const positive = (name, value) => {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and > 0`);
  };
  const positiveInt = (name, value) => {
    positive(name, value);
    if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
  };
  positiveInt("planCacheTtlMs", planCacheTtlMs);
  positiveInt("processingTtlMs", processingTtlMs);
  if (typeof id !== "function") throw new TypeError("id must be a function");

  async function getPolicy(customerId) {
    const cached = await redis.get(K.plan(customerId));
    if (cached) return { ...JSON.parse(cached), cached: true };

    const row = await db.getCustomerWithPlan(customerId);
    if (!row) return null;

    const policy = {
      customerId,
      planId: row.plan_id,
      suspended: row.suspended,
      burstCapacity: row.limit_override?.burst_capacity ?? row.burst_capacity,
      refillPerSec: row.limit_override?.refill_per_sec ?? row.refill_per_sec,
      monthlyQuota: row.limit_override?.monthly_quota ?? row.monthly_quota,
      overageAllowed: row.overage_allowed,
    };
    positive("burstCapacity", Number(policy.burstCapacity));
    positive("refillPerSec", Number(policy.refillPerSec));
    if (policy.monthlyQuota != null) positiveInt("monthlyQuota", Number(policy.monthlyQuota));

    await redis.set(K.plan(customerId), JSON.stringify(policy), planCacheTtlMs);
    return { ...policy, cached: false };
  }

  async function invalidatePolicy(customerId) {
    await redis.del(K.plan(customerId));
  }

  async function check(customerId, { cost = 1, t = now() } = {}) {
    positiveInt("cost", cost);
    const policy = await getPolicy(customerId);
    if (!policy) return { allowed: false, reason: "unknown_customer" };
    if (policy.suspended) return { allowed: false, reason: "suspended", policy };

    if (cost > policy.burstCapacity) {
      return { allowed: false, reason: "cost_exceeds_burst_capacity", policy };
    }

    const [rateAllowed, tokens, retryMs] = await evalFn(
      TOKEN_BUCKET,
      [`rl:tb:${safe(customerId)}`],
      [t, policy.burstCapacity, policy.refillPerSec, cost,
        Math.ceil((policy.burstCapacity / policy.refillPerSec) * 2000)].map(String)
    );
    if (rateAllowed === -2) throw new RangeError("token bucket rejected invalid arguments");
    if (rateAllowed !== 1) {
      return { allowed: false, reason: "rate_limited", retryAfterMs: Number(retryMs), tokens: Number(tokens), policy };
    }

    const p = period(t);
    const quota = policy.monthlyQuota ?? -1; // -1 = meter without a hard cap
    const ttl = 40 * 24 * 3600 * 1000;
    const keys = [K.used(customerId, p), K.pendingUnits(customerId, p), K.pendingRequests(customerId, p)];
    const reserve = (seed) => evalFn(
      QUOTA_RESERVE,
      keys,
      [cost, quota, seed, ttl, policy.overageAllowed ? 1 : 0].map(String)
    );

    let result = await reserve(-1);
    if (result[0] === -1) result = await reserve(await db.getUsage(customerId, p));
    if (result[0] === -2) throw new RangeError("quota script rejected invalid arguments");

    const [quotaAllowed, used] = result;
    if (quotaAllowed !== 1) {
      return { allowed: false, reason: "quota_exceeded", used: Number(used), quota: policy.monthlyQuota, policy };
    }
    return { allowed: true, reason: "ok", tokens: Number(tokens), used: Number(used), quota: policy.monthlyQuota, policy };
  }

  const parsePendingKey = (key) => {
    const match = /^quota:\{(.+):(\d{4}-\d{2})\}:pending:units$/.exec(key);
    return match ? { customerId: decodeURIComponent(match[1]), period: match[2] } : null;
  };

  /**
   * Retry every immutable processing record. applyUsageBatch must insert the
   * flush ID and update usage in ONE Postgres transaction; its unique key makes
   * a retry after an ambiguous commit harmless.
   */
  async function applyProcessingRecords() {
    const processingKeys = await redis.scanKeys("quota:{*}:processing:*");
    let flushedUnits = 0;
    let flushedRequests = 0;
    let appliedBatches = 0;

    for (const processingKey of processingKeys) {
      const values = await redis.hmget(processingKey,
        "flush_id", "customer_id", "period", "units", "requests");
      if (!values?.[0]) continue;
      const [flushId, customerId, p, rawUnits, rawRequests] = values;
      const units = Number(rawUnits);
      const requests = Number(rawRequests);

      const applied = await db.applyUsageBatch(flushId, customerId, p, { units, requests });
      // Delete only after a confirmed commit. If deletion fails, the same UUID
      // is retried and Postgres reports applied=false instead of double adding.
      await redis.del(processingKey);
      if (applied) {
        appliedBatches++;
        flushedUnits += units;
        flushedRequests += requests;
      }
    }
    return { flushedUnits, flushedRequests, appliedBatches };
  }

  /**
   * Drains ALL periods, not merely the current month. That matters at midnight:
   * an October delta discovered in November still belongs to October.
   */
  async function flushUsage() {
    const pendingKeys = await redis.scanKeys("quota:{*}:pending:units");
    let rotatedBatches = 0;

    for (const unitsKey of pendingKeys) {
      const parsed = parsePendingKey(unitsKey);
      if (!parsed) continue;

      let collision = true;
      for (let attempt = 0; attempt < 3 && collision; attempt++) {
        const flushId = id();
        const processKey = K.processing(parsed.customerId, parsed.period, flushId);
        const [rotated] = await evalFn(
          ROTATE_PENDING,
          [unitsKey, K.pendingRequests(parsed.customerId, parsed.period), processKey],
          [flushId, parsed.customerId, parsed.period, processingTtlMs].map(String)
        );
        if (rotated === -2) throw new RangeError("rotation script rejected invalid arguments");
        if (rotated === -3) continue; // UUID collision: pending counters remain untouched
        collision = false;
        if (rotated === 1) rotatedBatches++;
      }
      if (collision) throw new Error("could not allocate a unique processing-batch ID");
    }

    const applied = await applyProcessingRecords();
    return { ...applied, rotatedBatches, pendingKeys: pendingKeys.length };
  }

  /**
   * Safe only after pending and processing records for this customer have been
   * durably flushed. Operational code should normally let the key expire and
   * cold-seed naturally rather than calling this on live traffic.
   */
  async function forceColdSeedAfterFlush(customerId, { t = now() } = {}) {
    const p = period(t);
    const outstanding = [
      ...(await redis.scanKeys(`quota:${slot(customerId, p)}:pending:*`)),
      ...(await redis.scanKeys(`quota:${slot(customerId, p)}:processing:*`)),
    ];
    if (outstanding.length) throw new Error("cannot rehydrate while unsettled usage exists");
    await redis.del(K.used(customerId, p));
    return { customerId, period: p, usageFromDb: await db.getUsage(customerId, p) };
  }

  return {
    check,
    getPolicy,
    invalidatePolicy,
    flushUsage,
    applyProcessingRecords,
    forceColdSeedAfterFlush,
    period,
  };
}
