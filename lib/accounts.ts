// Handles are claimed by the first browser that uses them: the browser keeps
// a random secret, the server stores only its hash.
import { createHash } from "node:crypto";
import { expire, get, set, withLock, zincrby } from "./store";
import { liveMatch, resolve, scoreFor, type Match } from "./game";
import type { Format } from "./problems";

export type User = {
  handle: string;
  tokenHash: string;
  points: number;
  byFormat: Record<Format, number>;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  best: Partial<Record<Format, number>>; // fastest all-green, ms
  createdAt: number;
};

const YEAR = 60 * 60 * 24 * 365;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
export const today = () => new Date().toISOString().slice(0, 10);
export const cleanHandle = (s: unknown) => String(s ?? "").replace(/[^\w.\-]/g, "").slice(0, 18);

export async function claim(handle: string, token: string): Promise<"ok" | "taken" | "invalid"> {
  if (handle.length < 2 || token.length < 16) return "invalid";
  const key = `user:${handle.toLowerCase()}`;
  return withLock(key, async () => {
    const u = await get<User>(key);
    if (u) return u.tokenHash === hash(token) ? "ok" : "taken";
    const fresh: User = {
      handle, tokenHash: hash(token), points: 0, byFormat: { classic: 0, ai: 0 },
      wins: 0, losses: 0, draws: 0, matches: 0, best: {}, createdAt: Date.now(),
    };
    await set(key, fresh, YEAR);
    return "ok";
  });
}

export async function getUser(handle: string): Promise<User | null> {
  return get<User>(`user:${handle.toLowerCase()}`);
}

// Called with the match lock held. Idempotent via m.awards.
export async function awardIfOver(m: Match, now = Date.now()): Promise<boolean> {
  if (m.awards) return false;
  const live = liveMatch(m, now);
  const r = resolve(live, now);
  if (!r.over) return false;
  m.awards = {};
  for (const p of live.players) {
    if (p.bot) continue;
    const a = scoreFor(live, p, r);
    m.awards[p.id] = a;
    if (!p.handle) continue;
    const key = `user:${p.handle.toLowerCase()}`;
    const name = await withLock(key, async () => {
      const u = await get<User>(key);
      if (!u) return null;
      u.points += a.pts;
      u.byFormat[m.format] = (u.byFormat[m.format] ?? 0) + a.pts;
      u.matches++;
      if (r.winner == null) u.draws++;
      else if (r.winner === p.team) u.wins++;
      else u.losses++;
      if (p.doneAt != null && (u.best[m.format] == null || p.doneAt < u.best[m.format]!)) u.best[m.format] = p.doneAt;
      await set(key, u, YEAR);
      return u.handle;
    });
    if (!name) continue;
    await zincrby("lb:all", a.pts, name);
    await zincrby(`lb:${m.format}`, a.pts, name);
    const day = `lb:day:${today()}`;
    await zincrby(day, a.pts, name);
    await expire(day, 60 * 60 * 24 * 3);
  }
  return true;
}
