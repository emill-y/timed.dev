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

async function del(k: string): Promise<void> {
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
