/**
 * PHASE 2 — Atomic Redis Lua implementations used by the teaching wrapper.
 *
 * Validate before the first write. Redis isolates scripts from interleaving,
 * but a runtime error does not roll back writes already performed.
 */

// KEYS[1] already contains the epoch-window number. ARGV[2] is therefore the
// milliseconds remaining to the real clock boundary, not a fresh full window.
export const FIXED_WINDOW = `
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])
if limit == nil or limit <= 0 or limit ~= math.floor(limit)
   or ttl == nil or ttl <= 0 or ttl ~= math.floor(ttl) then
  return { -2, 0, 0 }
end

local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ttl) end
local remaining_ttl = redis.call('PTTL', KEYS[1])
if count > limit then return { 0, 0, remaining_ttl } end
return { 1, limit - count, remaining_ttl }
`;

export const SLIDING_WINDOW_LOG = `
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]
if now == nil or window == nil or window <= 0 or window ~= math.floor(window)
   or limit == nil or limit <= 0 or limit ~= math.floor(limit)
   or member == nil or member == '' then
  return { -2, 0, 0 }
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = oldest[2] and math.ceil(tonumber(oldest[2]) + window - now) or 0
  return { 0, 0, retry }
end

-- NX means even an astronomically unlikely ID collision cannot undercount.
local inserted = redis.call('ZADD', KEYS[1], 'NX', now, member)
if inserted ~= 1 then return { -3, 0, 0 } end
redis.call('PEXPIRE', KEYS[1], window)
return { 1, limit - count - 1, 0 }
`;

export const TOKEN_BUCKET = `
local now      = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill   = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])
local ttl      = tonumber(ARGV[5])
if now == nil or capacity == nil or capacity <= 0
   or refill == nil or refill <= 0
   or cost == nil or cost <= 0
   or ttl == nil or ttl <= 0 or ttl ~= math.floor(ttl) then
  return { -2, '0', 0 }
end
if cost > capacity then return { -4, '0', 0 } end

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])
if tokens == nil then tokens = capacity; ts = now end

-- Never persist an older clock. Otherwise alternating slow and correct hosts
-- can repeatedly mint refill credit without real time advancing.
local effective_now = math.max(now, ts)
local elapsed = (effective_now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
local retry_after = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after = math.ceil(((cost - tokens) / refill) * 1000)
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', effective_now)
redis.call('PEXPIRE', KEYS[1], ttl)
return { allowed, tostring(tokens), retry_after }
`;

export const GCRA = `
local now       = tonumber(ARGV[1])
local interval  = tonumber(ARGV[2])
local tolerance = tonumber(ARGV[3])
local cost      = tonumber(ARGV[4])
local ttl       = tonumber(ARGV[5])
if now == nil or interval == nil or interval <= 0
   or tolerance == nil or tolerance <= 0
   or cost == nil or cost <= 0
   or ttl == nil or ttl <= 0 or ttl ~= math.floor(ttl) then
  return { -2, 0 }
end
if cost > tolerance / interval then return { -4, 0 } end

local tat = tonumber(redis.call('GET', KEYS[1])) or now
if tat < now then tat = now end
local new_tat  = tat + interval * cost
local allow_at = new_tat - tolerance
if now < allow_at then return { 0, math.ceil(allow_at - now) } end
redis.call('SET', KEYS[1], new_tat, 'PX', ttl)
return { 1, 0 }
`;

// Deliberately broken teaching example: atomic commands do not make this
// multi-round-trip workflow atomic.
export const NAIVE_CHECK_THEN_SET = {
  async run(redis, key, { limit, windowMs }) {
    const current = Number((await redis.get(key)) ?? 0);
    if (current >= limit) return { allowed: false };
    await redis.set(key, current + 1, windowMs);
    return { allowed: true };
  },
};
