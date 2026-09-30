// Tiny KV used by matchmaking. Uses Upstash Redis (REST) when configured —
// required for real cross-player matchmaking on Vercel, since serverless
// instances don't share memory. Falls back to process memory for local dev.

type Entry = { v: string; exp: number };
const g = globalThis as unknown as { __timedMem?: Map<string, Entry> };
const mem = (g.__timedMem ??= new Map());

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const hasRedis = Boolean(URL_ && TOKEN);

async function redis(cmd: (string | number)[]): Promise<any> {
  const r = await fetch(URL_!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function memGet(k: string): string | null {
  const e = mem.get(k);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) {
    mem.delete(k);
    return null;
  }
  return e.v;
}

export async function get<T>(k: string): Promise<T | null> {
  const raw = hasRedis ? await redis(["GET", k]) : memGet(k);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function set(k: string, v: unknown, ttlSec: number): Promise<void> {
  const raw = JSON.stringify(v);
  if (hasRedis) await redis(["SET", k, raw, "EX", ttlSec]);
  else mem.set(k, { v: raw, exp: Date.now() + ttlSec * 1000 });
}

async function setNX(k: string, ttlMs: number): Promise<boolean> {
  if (hasRedis) return (await redis(["SET", k, "1", "NX", "PX", ttlMs])) === "OK";
  if (memGet(k)) return false;
  mem.set(k, { v: "1", exp: Date.now() + ttlMs });
  return true;
}

export async function del(k: string): Promise<void> {
  if (hasRedis) await redis(["DEL", k]);
  else mem.delete(k);
}

// Short spin lock so read-modify-write on queue/match JSON doesn't race.
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const key = `lock:${name}`;
  for (let i = 0; i < 40; i++) {
    if (await setNX(key, 3000)) {
      try {
        return await fn();
      } finally {
        await del(key);
      }
    }
    await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
  }
  throw new Error("busy");
}

// ---- sorted sets (leaderboards) ----
const g2 = globalThis as unknown as { __timedZ?: Map<string, Map<string, number>> };
const zmem = (g2.__timedZ ??= new Map());
const zset = (k: string) => {
  let z = zmem.get(k);
  if (!z) zmem.set(k, (z = new Map()));
  return z;
};

export async function zincrby(k: string, by: number, member: string): Promise<number> {
  if (hasRedis) return Number(await redis(["ZINCRBY", k, by, member]));
  const z = zset(k);
  const v = (z.get(member) ?? 0) + by;
  z.set(member, v);
  return v;
}

export async function ztop(k: string, n: number): Promise<{ member: string; score: number }[]> {
  if (hasRedis) {
    const flat: string[] = await redis(["ZRANGE", k, 0, n - 1, "REV", "WITHSCORES"]);
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
    return out;
  }
  return [...zset(k)].map(([member, score]) => ({ member, score })).sort((a, b) => b.score - a.score).slice(0, n);
}

// 0-based rank, highest score first; null when absent.
export async function zrank(k: string, member: string): Promise<number | null> {
  if (hasRedis) {
    const r = await redis(["ZREVRANK", k, member]);
    return r == null ? null : Number(r);
  }
  const z = zset(k);
  const me = z.get(member);
  if (me == null) return null;
  return [...z.values()].filter((v) => v > me).length;
}

export async function expire(k: string, sec: number): Promise<void> {
  if (hasRedis) await redis(["EXPIRE", k, sec]);
  // In-memory boards are process-lifetime anyway.
}

// Fixed-window counter; returns the count after incrementing.
export async function incr(k: string, ttlSec: number): Promise<number> {
  if (hasRedis) {
    const n = Number(await redis(["INCR", k]));
    if (n === 1) await redis(["EXPIRE", k, ttlSec]);
    return n;
  }
  const cur = Number(memGet(k) ?? 0) + 1;
  const e = mem.get(k);
  mem.set(k, { v: String(cur), exp: e && cur > 1 ? e.exp : Date.now() + ttlSec * 1000 });
  return cur;
}

// SET NX with a TTL, for one-shot claims (usernames, per-player judge slots).
export async function claimKey(k: string, v: unknown, ttlSec: number): Promise<boolean> {
  const raw = JSON.stringify(v);
  if (hasRedis) return (await redis(["SET", k, raw, "NX", "EX", ttlSec])) === "OK";
  if (memGet(k) != null) return false;
  mem.set(k, { v: raw, exp: Date.now() + ttlSec * 1000 });
  return true;
}

// ---- lists (feed) ----
const g3 = globalThis as unknown as { __timedL?: Map<string, string[]>; __timedS?: Map<string, Set<string>> };
const lmem = (g3.__timedL ??= new Map());
const smem = (g3.__timedS ??= new Map());

// Push to the head and keep at most `max` items.
export async function lpushCapped(k: string, v: unknown, max: number): Promise<void> {
  const raw = JSON.stringify(v);
  if (hasRedis) {
    await redis(["LPUSH", k, raw]);
    await redis(["LTRIM", k, 0, max - 1]);
    return;
  }
  const l = lmem.get(k) ?? [];
  l.unshift(raw);
  lmem.set(k, l.slice(0, max));
}

export async function lrange<T>(k: string, start: number, stop: number): Promise<T[]> {
  const raw: string[] = hasRedis ? await redis(["LRANGE", k, start, stop]) : (lmem.get(k) ?? []).slice(start, stop + 1);
  return raw.map((x) => JSON.parse(x) as T);
}

// ---- sets (likes) ----
export async function sadd(k: string, m: string): Promise<void> {
  if (hasRedis) return void (await redis(["SADD", k, m]));
  const s = smem.get(k) ?? new Set();
  s.add(m);
  smem.set(k, s);
}
export async function srem(k: string, m: string): Promise<void> {
  if (hasRedis) return void (await redis(["SREM", k, m]));
  smem.get(k)?.delete(m);
}
export async function smembers(k: string): Promise<string[]> {
  if (hasRedis) return (await redis(["SMEMBERS", k])) ?? [];
  return [...(smem.get(k) ?? [])];
}

// ---- ascending boards (drop times: lower is better) ----
export async function zadd(k: string, score: number, member: string): Promise<void> {
  if (hasRedis) return void (await redis(["ZADD", k, score, member]));
  zset(k).set(member, score);
}
export async function zlow(k: string, n: number): Promise<{ member: string; score: number }[]> {
  if (hasRedis) {
    const flat: string[] = await redis(["ZRANGE", k, 0, n - 1, "WITHSCORES"]);
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
    return out;
  }
  return [...zset(k)].map(([member, score]) => ({ member, score })).sort((a, b) => a.score - b.score).slice(0, n);
}
export async function zrankLow(k: string, member: string): Promise<number | null> {
  if (hasRedis) {
    const r = await redis(["ZRANK", k, member]);
    return r == null ? null : Number(r);
  }
  const me = zset(k).get(member);
  if (me == null) return null;
  return [...zset(k).values()].filter((v) => v < me).length;
}
export async function zcard(k: string): Promise<number> {
  if (hasRedis) return Number(await redis(["ZCARD", k]));
  return zset(k).size;
}
