// Accounts, stats and point awards. Points are only ever computed here, from
// match state the server judged itself (see lib/judge.ts).
import { expire, get, set, withLock, zadd, zincrby, zrankLow } from "./store";
import { liveMatch, resolve, scoreFor, type Match } from "./game";
import { getProblem, type Format } from "./problems";
import { post } from "./feed";

export type User = {
  username: string; // GitHub login (display casing); the key is lowercased
  githubId: number;
  avatar: string;
  name?: string;
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

export type PublicUser = Omit<User, "cleared" | "githubId"> & { rank: number | null };

const FOREVER = 60 * 60 * 24 * 365 * 5;
const key = (username: string) => `user:${username.toLowerCase()}`;
export const today = () => new Date().toISOString().slice(0, 10);

export async function getUser(username: string): Promise<User | null> {
  return get<User>(key(username));
}

// GitHub is the only way in. Accounts are keyed by GitHub's numeric id (so a
// renamed GitHub login keeps its history) and displayed by login.
export async function upsertGithubUser(gh: { id: number; login: string; avatar_url: string; name?: string | null }): Promise<User> {
  const idKey = `gh:${gh.id}`;
  return withLock(idKey, async () => {
    const prevLogin = await get<string>(idKey);
    let u = prevLogin ? await get<User>(key(prevLogin)) : null;
    if (u && prevLogin!.toLowerCase() !== gh.login.toLowerCase()) {
      // Login renamed on GitHub: move the record. (Boards keep the old name
      // until the next award; that's acceptable for an MVP.)
      await set(key(prevLogin!), null, 1);
    }
    u ??= {
      username: gh.login, githubId: gh.id, avatar: gh.avatar_url, points: 0, byFormat: { classic: 0, ai: 0 },
      wins: 0, losses: 0, draws: 0, matches: 0, best: {}, cleared: [], createdAt: Date.now(),
    };
    u.username = gh.login;
    u.avatar = gh.avatar_url;
    u.name = gh.name ?? undefined;
    await set(key(gh.login), u, FOREVER);
    await set(idKey, gh.login, FOREVER);
    return u;
  });
}

export function publicUser(u: User, rank: number | null): PublicUser {
  const { githubId: _g, cleared: _c, ...rest } = u;
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
    const who = await withLock(key(p.userId), async () => {
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
      if (m.drop == null) {
        if (r.winner == null) u.draws++;
        else if (r.winner === p.team) u.wins++;
        else u.losses++;
      }
      if (p.doneAt != null) {
        if (m.drop == null && (u.best[m.format] == null || p.doneAt < u.best[m.format]!)) u.best[m.format] = p.doneAt;
        if (!u.cleared.includes(m.problemId)) u.cleared.push(m.problemId);
      }
      await set(key(p.userId!), u, FOREVER);
      return { name: u.username, avatar: u.avatar };
    });
    m.awards[p.id] = a;
    if (!who) continue;
    const name = who.name;
    await announce(live, p, r.winner, who, a.pts);
    if (!a.pts) continue;
    await zincrby("lb:all", a.pts, name);
    await zincrby(`lb:${m.format}`, a.pts, name);
    const day = `lb:day:${today()}`;
    await zincrby(day, a.pts, name);
    await expire(day, 60 * 60 * 24 * 3);
  }
  return true;
}

const fmt = (ms: number) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, "0")}`);

// One feed post per finished player: "eisha beat ghost_nitro".
async function announce(m: Match, p: Match["players"][number], winner: 0 | 1 | null, who: { name: string; avatar: string }, pts: number) {
  const problem = getProblem(m.problemId);
  const actor = { login: who.name, avatar: who.avatar };
  if (m.drop != null) {
    let rank: number | null = null;
    if (p.doneAt != null) {
      await zadd(`drop:${m.drop}:board`, p.doneAt, who.name);
      const r = await zrankLow(`drop:${m.drop}:board`, who.name);
      rank = r == null ? null : r + 1;
    }
    await post({
      kind: "drop",
      actor,
      drop: m.drop,
      line: p.doneAt != null
        ? [{ t: who.name, b: true }, { t: " cleared " }, { t: `drop #${m.drop}`, b: true }]
        : [{ t: who.name, b: true }, { t: " ran out of clock on " }, { t: `drop #${m.drop}`, b: true }],
      detail: `${problem.title}${p.doneAt != null ? ` · ${fmt(p.doneAt)}${rank ? ` · #${rank} so far` : ""}` : ` · ${p.passed}/${m.total} tests`}`,
      pts,
      won: p.doneAt != null,
    });
    return;
  }
  const rivals = m.players.filter((o) => o.team !== p.team).map((o) => o.name + (o.bot ? " (ghost)" : ""));
  const mates = m.players.filter((o) => o.team === p.team && o.id !== p.id).map((o) => o.name);
  const verb = winner == null ? " drew with " : winner === p.team ? " beat " : " lost to ";
  await post({
    kind: "match",
    actor,
    line: [
      { t: who.name, b: true },
      ...(mates.length ? [{ t: ` + ${mates.join(" + ")}` }] : []),
      { t: verb },
      { t: rivals.join(" + "), b: true },
    ],
    detail: [problem.title, m.format === "ai" ? "ai mode" : null, m.clock, m.hard?.length ? "glitch" : null, p.doneAt != null ? fmt(p.doneAt) : `${p.passed}/${m.total} tests`]
      .filter(Boolean)
      .join(" · "),
    pts,
    won: winner === p.team,
  });
}
