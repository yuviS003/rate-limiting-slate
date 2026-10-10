/**
 * A tiny Redis stand-in with a real Lua 5.3 interpreter (fengari) wired to a
 * `redis.call` bridge. Enough of the command surface to actually execute the
 * EVAL scripts used in the article and assert what they return.
 *
 * This is a test harness, not a Redis implementation. It exists so the Lua in
 * the post is executed rather than taken on faith.
 */
import { lua, lauxlib, lualib, to_luastring } from "fengari";

export class FakeRedis {
  constructor({ now = () => Date.now() } = {}) {
    this.data = new Map();    // key -> { type, value }
    this.expiry = new Map();  // key -> absolute ms
    this.now = now;
    this.commandLog = [];
  }

  // ---------------------------------------------------------------- plumbing
  #sweep(key) {
    const exp = this.expiry.get(key);
    if (exp !== undefined && this.now() >= exp) {
      this.data.delete(key);
      this.expiry.delete(key);
    }
  }

  #get(key, type) {
    this.#sweep(key);
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.type !== type) throw new Error(`WRONGTYPE ${key} is ${e.type}, wanted ${type}`);
    return e.value;
  }

  #setRaw(key, type, value) {
    this.data.set(key, { type, value });
  }

  // ---------------------------------------------------------------- commands
  command(argv) {
    const cmd = String(argv[0]).toUpperCase();
    const a = argv.slice(1);
    this.commandLog.push([cmd, ...a]);

    switch (cmd) {
      case "GET": {
        const v = this.#get(a[0], "string");
        return v === undefined ? null : v;
      }
      case "SET": {
        // Validate every expiry option before mutating, matching Redis.
        let expiresAt;
        for (let i = 2; i < a.length - 1; i++) {
          const opt = String(a[i]).toUpperCase();
          if (opt === "PX" || opt === "EX") {
            const ttl = Number(a[i + 1]);
            if (!Number.isSafeInteger(ttl)) throw new Error("ERR value is not an integer or out of range");
            expiresAt = this.now() + ttl * (opt === "EX" ? 1000 : 1);
          }
        }
        this.#setRaw(a[0], "string", String(a[1]));
        if (expiresAt !== undefined) this.expiry.set(a[0], expiresAt);
        else this.expiry.delete(a[0]);
        return "OK";
      }
      case "DEL": {
        let n = 0;
        for (const k of a) {
          this.#sweep(k);
          if (this.data.delete(k)) n++;
          this.expiry.delete(k);
        }
        return n;
      }
      case "GETDEL": {
        const v = this.#get(a[0], "string");
        this.data.delete(a[0]);
        this.expiry.delete(a[0]);
        return v === undefined ? null : v;
      }
      case "KEYS": {
        const rx = new RegExp(
          "^" + String(a[0]).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
        );
        return [...this.data.keys()].filter((k) => {
          this.#sweep(k);
          return this.data.has(k) && rx.test(k);
        });
      }
      case "EXISTS": {
        this.#sweep(a[0]);
        return this.data.has(a[0]) ? 1 : 0;
      }
      case "INCR":
      case "INCRBY": {
        const by = cmd === "INCR" ? 1 : Number(a[1]);
        const cur = Number(this.#get(a[0], "string") ?? 0);
        const next = cur + by;
        this.#setRaw(a[0], "string", String(next));
        return next;
      }
      case "EXPIRE": {
        this.#sweep(a[0]);
        const ttl = Number(a[1]);
        if (!Number.isSafeInteger(ttl)) throw new Error("ERR value is not an integer or out of range");
        if (!this.data.has(a[0])) return 0;
        this.expiry.set(a[0], this.now() + ttl * 1000);
        return 1;
      }
      case "PEXPIRE": {
        this.#sweep(a[0]);
        const ttl = Number(a[1]);
        if (!Number.isSafeInteger(ttl)) throw new Error("ERR value is not an integer or out of range");
        if (!this.data.has(a[0])) return 0;
        this.expiry.set(a[0], this.now() + ttl);
        return 1;
      }
      case "PTTL": {
        this.#sweep(a[0]);
        if (!this.data.has(a[0])) return -2;
        const exp = this.expiry.get(a[0]);
        return exp === undefined ? -1 : Math.max(0, exp - this.now());
      }
      case "TTL": {
        const ms = this.command(["PTTL", a[0]]);
        return ms < 0 ? ms : Math.ceil(ms / 1000);
      }
      case "HSET": {
        this.#sweep(a[0]);
        const h = this.#get(a[0], "hash") ?? new Map();
        let added = 0;
        for (let i = 1; i < a.length; i += 2) {
          if (!h.has(String(a[i]))) added++;
          h.set(String(a[i]), String(a[i + 1]));
        }
        this.#setRaw(a[0], "hash", h);
        return added;
      }
      case "HGET": {
        const h = this.#get(a[0], "hash");
        const v = h?.get(String(a[1]));
        return v === undefined ? null : v;
      }
      case "HMGET": {
        const h = this.#get(a[0], "hash");
        return a.slice(1).map((f) => {
          const v = h?.get(String(f));
          return v === undefined ? null : v;
        });
      }
      case "ZADD": {
        this.#sweep(a[0]);
        const z = this.#get(a[0], "zset") ?? new Map();
        let i = 1;
        let nx = false;
        while (i < a.length && ["NX", "XX", "CH"].includes(String(a[i]).toUpperCase())) {
          if (String(a[i]).toUpperCase() === "NX") nx = true;
          i++;
        }
        let added = 0;
        for (; i < a.length; i += 2) {
          const member = String(a[i + 1]);
          if (nx && z.has(member)) continue;
          if (!z.has(member)) added++;
          z.set(member, Number(a[i]));
        }
        this.#setRaw(a[0], "zset", z);
        return added;
      }
      case "ZCARD": {
        const z = this.#get(a[0], "zset");
        return z ? z.size : 0;
      }
      case "ZREMRANGEBYSCORE": {
        const z = this.#get(a[0], "zset");
        if (!z) return 0;
        const min = a[1] === "-inf" ? -Infinity : Number(a[1]);
        const max = a[2] === "+inf" ? Infinity : Number(a[2]);
        let n = 0;
        for (const [m, s] of [...z]) {
          if (s >= min && s <= max) {
            z.delete(m);
            n++;
          }
        }
        return n;
      }
      case "ZRANGE": {
        const z = this.#get(a[0], "zset");
        if (!z) return [];
        const sorted = [...z].sort((x, y) => x[1] - y[1]);
        const start = Number(a[1]);
        const stop = Number(a[2]) < 0 ? sorted.length + Number(a[2]) : Number(a[2]);
        const slice = sorted.slice(start, stop + 1);
        const withScores = a.some((x) => String(x).toUpperCase() === "WITHSCORES");
        return withScores ? slice.flatMap(([m, s]) => [m, String(s)]) : slice.map(([m]) => m);
      }
      case "SCRIPT":
        return "fakesha";
      default:
        throw new Error(`FakeRedis: unsupported command ${cmd}`);
    }
  }

  // ------------------------------------------------------------------- EVAL
  /** Executes a Lua script the way Redis EVAL would. */
  eval(script, keys = [], argv = []) {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);

    // redis.call / redis.pcall
    const callFn = (L) => {
      const n = lua.lua_gettop(L);
      const args = [];
      for (let i = 1; i <= n; i++) {
        args.push(lua.lua_type(L, i) === lua.LUA_TNUMBER
          ? String(lua.lua_tonumber(L, i))
          : lua.lua_tojsstring(L, i));
      }
      pushReply(L, this.command(args));
      return 1;
    };

    lua.lua_createtable(L, 0, 4);
    lua.lua_pushliteral(L, "call");
    lua.lua_pushjsfunction(L, callFn);
    lua.lua_settable(L, -3);
    lua.lua_pushliteral(L, "pcall");
    lua.lua_pushjsfunction(L, callFn);
    lua.lua_settable(L, -3);
    // redis.log is a no-op here
    lua.lua_pushliteral(L, "log");
    lua.lua_pushjsfunction(L, () => 0);
    lua.lua_settable(L, -3);
    lua.lua_setglobal(L, to_luastring("redis"));

    pushArray(L, keys);
    lua.lua_setglobal(L, to_luastring("KEYS"));
    pushArray(L, argv);
    lua.lua_setglobal(L, to_luastring("ARGV"));

    if (lauxlib.luaL_loadstring(L, to_luastring(script)) !== lua.LUA_OK) {
      throw new Error("Lua compile error: " + lua.lua_tojsstring(L, -1));
    }
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
      throw new Error("Lua runtime error: " + lua.lua_tojsstring(L, -1));
    }
    return readValue(L, -1);
  }
}

function pushArray(L, arr) {
  lua.lua_createtable(L, arr.length, 0);
  arr.forEach((v, i) => {
    if (typeof v === "number") lua.lua_pushnumber(L, v);
    else lua.lua_pushliteral(L, String(v));
    lua.lua_rawseti(L, -2, i + 1);
  });
}

function pushReply(L, reply) {
  if (reply === null || reply === undefined) {
    lua.lua_pushboolean(L, false); // Redis nil -> Lua false
  } else if (typeof reply === "number") {
    lua.lua_pushinteger(L, Math.trunc(reply));
  } else if (Array.isArray(reply)) {
    lua.lua_createtable(L, reply.length, 0);
    reply.forEach((v, i) => {
      pushReply(L, v);
      lua.lua_rawseti(L, -2, i + 1);
    });
  } else {
    lua.lua_pushliteral(L, String(reply));
  }
}

function readValue(L, idx) {
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TNIL) return null;
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx) ? 1 : null;
  if (t === lua.LUA_TNUMBER) return Math.trunc(lua.lua_tonumber(L, idx)); // Redis truncates
  if (t === lua.LUA_TSTRING) return lua.lua_tojsstring(L, idx);
  if (t === lua.LUA_TTABLE) {
    const out = [];
    const n = lua.lua_rawlen(L, idx);
    for (let i = 1; i <= n; i++) {
      lua.lua_rawgeti(L, idx, i);
      out.push(readValue(L, -1));
      lua.lua_pop(L, 1);
    }
    return out;
  }
  return null;
}
