import { FakeRedis } from "./fake-redis.mjs";

let clock = 1_000_000;
const r = new FakeRedis({ now: () => clock });

// does the bridge work at all?
console.log("arith     ", r.eval("return 1 + 1"));
console.log("keys/argv ", r.eval("return {KEYS[1], ARGV[1], ARGV[2]}", ["k"], ["a", "b"]));
console.log("incr      ", r.eval("redis.call('SET', KEYS[1], '5'); return redis.call('INCR', KEYS[1])", ["c"]));
console.log("nil->false", r.eval("local v = redis.call('GET', 'missing'); if v == false then return 'is-false' end return 'other'"));
console.log("hmget     ", r.eval("redis.call('HSET', KEYS[1], 'a', '1', 'b', '2'); return redis.call('HMGET', KEYS[1], 'a', 'b')", ["h"]));
console.log("pttl      ", r.eval("redis.call('SET', KEYS[1], 'x'); redis.call('PEXPIRE', KEYS[1], 5000); return redis.call('PTTL', KEYS[1])", ["t"]));
console.log("zset      ", r.eval("redis.call('ZADD', KEYS[1], 1, 'a', 2, 'b', 3, 'c'); redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', 1); return redis.call('ZCARD', KEYS[1])", ["z"]));
console.log("float     ", r.eval("return tostring(1.5 + 2.25)"));
