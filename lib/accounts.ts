// Accounts, stats and point awards. Points are only ever computed here, from
// match state the server judged itself (see lib/judge.ts).
import { expire, get, set, withLock, zincrby } from "./store";
import { liveMatch, resolve, scoreFor, type Match } from "./game";
import type { Format } from "./problems";

export type User = {
  username: string; // display casing; the key is lowercased
  passHash: string;
  points: number;
  byFormat: Record<Format, number>;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  best: Partial<Record<Format, number>>; // fastest all-green, ms
  cleared: string[]; // ticket ids solved at least once
  createdAt: number;
};

export type PublicUser = Omit<User, "passHash" | "cleared"> & { rank: number | null };

const FOREVER = 60 * 60 * 24 * 365 * 5;
const key = (username: string) => `user:${username.toLowerCase()}`;
export const today = () => new Date().toISOString().slice(0, 10);

export async function getUser(username: string): Promise<User | null> {
  return get<User>(key(username));
}

export async function createUser(username: string, passHash: string): Promise<User | null> {
  return withLock(key(username), async () => {
    if (await get<User>(key(username))) return null;
    const u: User = {
      username, passHash, points: 0, byFormat: { classic: 0, ai: 0 },
      wins: 0, losses: 0, draws: 0, matches: 0, best: {}, cleared: [], createdAt: Date.now(),
    };
    await set(key(username), u, FOREVER);
    return u;
  });
}

export function publicUser(u: User, rank: number | null): PublicUser {
  const { passHash: _p, cleared: _c, ...rest } = u;
  return { ...rest, rank };
}

// Called with the match lock held. Idempotent via m.awards.
export async function awardIfOver(m: Match, now = Date.now()): Promise<boolean> {
  if (m.awards) return false;
  const live = liveMatch(m, now);
  const r = resolve(live, now);
  if (!r.over) return false;
  m.awards = {};
  const vsHumans = (team: 0 | 1) => live.players.some((o) => o.team !== team && !o.bot);

  for (const p of live.players) {
    if (p.bot) continue;
    let a = scoreFor(live, p, r);
    if (!p.userId) {
      m.awards[p.id] = a;
      continue;
    }
    const name = await withLock(key(p.userId), async () => {
      const u = await get<User>(key(p.userId!));
      if (!u) return null;
      // Ghost matches only pay for tickets you haven't cleared before, so a
      // saved solution can't be replayed for points.
      if (!vsHumans(p.team) && u.cleared.includes(m.problemId)) {
        a = { pts: 0, parts: [...a.parts, ["already cleared vs ghosts", 0]] };
      }
      u.points += a.pts;
      u.byFormat[m.format] = (u.byFormat[m.format] ?? 0) + a.pts;
      u.matches++;
      if (r.winner == null) u.draws++;
      else if (r.winner === p.team) u.wins++;
      else u.losses++;
      if (p.doneAt != null) {
        if (u.best[m.format] == null || p.doneAt < u.best[m.format]!) u.best[m.format] = p.doneAt;
        if (!u.cleared.includes(m.problemId)) u.cleared.push(m.problemId);
      }
      await set(key(p.userId!), u, FOREVER);
      return u.username;
    });
    m.awards[p.id] = a;
    if (!name || !a.pts) continue;
    await zincrby("lb:all", a.pts, name);
    await zincrby(`lb:${m.format}`, a.pts, name);
    const day = `lb:day:${today()}`;
    await zincrby(day, a.pts, name);
    await expire(day, 60 * 60 * 24 * 3);
  }
  return true;
}
