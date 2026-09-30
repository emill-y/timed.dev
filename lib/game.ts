import { getProblem, randomProblemId, type Format } from "./problems";
import { HARD_MODES, type HardMode } from "./glitch";
export type { Format };

export type Mode = "1v1" | "2v2";
export const MODES: Record<Mode, { size: number; label: string }> = {
  "1v1": { size: 2, label: "1v1 duel" },
  "2v2": { size: 4, label: "2v2 co-hack" },
};

export const FORMATS: Record<Format, { label: string; blurb: string }> = {
  classic: { label: "classic", blurb: "everyday tickets · bring any tools you like" },
  ai: { label: "ai mode", blurb: "boss tickets · built-in copilot with your own key" },
};

export const CLOCKS = [
  { id: "bullet", sec: 180, label: "bullet", sub: "3:00" },
  { id: "blitz", sec: 300, label: "blitz", sub: "5:00" },
  { id: "rapid", sec: 600, label: "rapid", sub: "10:00" },
] as const;
export type ClockId = (typeof CLOCKS)[number]["id"];

export const COUNTDOWN_MS = 5000;
export const BOT_FILL_MS = 12000;
export const STALE_MS = 7000;
export const FAIL_PENALTY_MS = 10000;

export type Bot = { finishFrac: number; finishes: boolean; seed: number };

export type Player = {
  id: string; // secret: only this player's browser knows it
  name: string;
  userId?: string; // logged-in account; only these earn points
  team: 0 | 1;
  bot?: Bot;
  prompts?: number; // AI-mode copilot calls (self-reported, display only)
  passed: number; // best judged score
  attempts: number; // judged submits
  failed?: number; // judged submits that weren't all-green
  doneAt?: number; // ms after start, penalties included
  code?: string;
  lastSeen: number;
};

export type Award = { pts: number; parts: [string, number][] };

export type Match = {
  id: string;
  problemId: string;
  format: Format;
  hard: HardMode[];
  drop?: number; // solo time trial on drop #n
  mode: Mode;
  clock: ClockId;
  clockMs: number;
  total: number;
  startAt: number;
  players: Player[];
  awards?: Record<string, Award>;
};

export type Result = {
  over: boolean;
  winner: 0 | 1 | null; // null = draw
  teamTime: [number | null, number | null];
  teamBest: [number, number];
};

export const uid = () => Math.random().toString(36).slice(2, 10);

const BOT_NAMES = [
  "ghost_nitro", "rev_limiter", "p0lepos1t10n", "turbo.tsx", "segfault_sam", "redline",
  "npm_i_speed", "hot_lap", "zero_to_prod", "pitwall", "overclock", "drift_king",
];

export function makeBot(team: 0 | 1, taken: Set<string>): Player {
  const pool = BOT_NAMES.filter((n) => !taken.has(n));
  const name = pool[Math.floor(Math.random() * pool.length)] ?? "ghost_" + uid().slice(0, 3);
  return {
    id: "bot_" + uid(),
    name,
    team,
    bot: { finishFrac: 0.3 + Math.random() * 0.6, finishes: Math.random() < 0.8, seed: Math.random() },
    passed: 0,
    attempts: 0,
    lastSeen: Date.now(),
  };
}

export function createMatch(
  format: Format,
  mode: Mode,
  clock: ClockId,
  players: Player[],
  hard: HardMode[] = [],
  opts: { problemId?: string; clockMs?: number; drop?: number } = {},
): Match {
  const problemId = opts.problemId ?? randomProblemId(format);
  const c = CLOCKS.find((x) => x.id === clock) ?? CLOCKS[1];
  return {
    id: uid() + uid(),
    problemId,
    format,
    hard,
    ...(opts.drop != null ? { drop: opts.drop } : {}),
    mode,
    clock: c.id,
    clockMs: opts.clockMs ?? c.sec * 1000,
    total: getProblem(problemId).tests.length,
    startAt: Date.now() + COUNTDOWN_MS,
    players,
  };
}

// Bots progress on a deterministic curve: a few failed attempts, tests going
// green in bursts, finishing at finishFrac of the clock (or stalling one short).
export function botState(p: Player, m: Match, now: number): Player {
  const b = p.bot!;
  const t = Math.max(0, now - m.startAt);
  const finishAt = b.finishFrac * m.clockMs;
  const frac = Math.min(1, t / finishAt);
  const cap = b.finishes ? m.total : m.total - 1 - Math.floor(b.seed * 2);
  // Stepwise: nothing for the first ~35% (reading + prompting), then ramps.
  const ramp = frac < 0.35 ? 0 : Math.pow((frac - 0.35) / 0.65, 0.8);
  const passed = frac >= 1 ? cap : Math.min(cap, Math.floor(ramp * m.total));
  const attempts = frac < 0.35 ? 0 : 1 + Math.floor(ramp * (2 + b.seed * 4));
  const done = b.finishes && frac >= 1;
  return { ...p, passed: Math.max(0, passed), attempts, doneAt: done ? Math.round(finishAt) : undefined };
}

export function liveMatch(m: Match, now = Date.now()): Match {
  return { ...m, players: m.players.map((p) => (p.bot ? botState(p, m, now) : p)) };
}

export function resolve(m: Match, now = Date.now()): Result {
  const teamTime: [number | null, number | null] = [null, null];
  const teamBest: [number, number] = [0, 0];
  for (const p of m.players) {
    teamBest[p.team] = Math.max(teamBest[p.team], p.passed);
    if (p.doneAt != null) {
      const cur = teamTime[p.team];
      teamTime[p.team] = cur == null ? p.doneAt : Math.min(cur, p.doneAt);
    }
  }
  const elapsed = now - m.startAt;
  const [a, b] = teamTime;
  // A finished team wins once the clock has passed its time (both finishing
  // in the same poll window is decided by the actual timestamps).
  if (a != null || b != null) {
    const first = a != null && (b == null || a <= b) ? 0 : 1;
    const t = teamTime[first]!;
    if (elapsed >= t) {
      const tie = a != null && b != null && a === b;
      return { over: true, winner: tie ? null : first, teamTime, teamBest };
    }
  }
  if (elapsed >= m.clockMs) {
    // Solo runs (drops) have no rival: running out of time is a DNF, not a win.
    if (!m.players.some((p) => p.team === 1)) return { over: true, winner: null, teamTime, teamBest };
    const winner = teamBest[0] === teamBest[1] ? null : teamBest[0] > teamBest[1] ? 0 : 1;
    return { over: true, winner, teamTime, teamBest };
  }
  return { over: false, winner: null, teamTime, teamBest };
}

// What a given viewer is allowed to see. Player ids are secrets (they
// authorize submits), so everyone else gets a positional id; teammates'
// code is shared, opponents' never is.
export function viewFor(m: Match, playerId: string) {
  const me = m.players.find((p) => p.id === playerId);
  const now = Date.now();
  const live = liveMatch(m, now);
  const { awards, ...rest } = live;
  return {
    ...rest,
    now,
    result: resolve(live, now),
    myAward: awards?.[playerId] ?? null,
    settled: Boolean(awards),
    players: live.players.map((p, i) => ({
      id: `p${i}`,
      you: p.id === playerId,
      name: p.name,
      team: p.team,
      passed: p.passed,
      attempts: p.attempts,
      prompts: p.prompts,
      doneAt: p.doneAt,
      ranked: Boolean(p.userId),
      isBot: Boolean(p.bot),
      code: me && p.team === me.team && p.id !== me.id ? p.code : undefined,
    })),
  };
}
export type MatchView = ReturnType<typeof viewFor>;
export type PlayerView = MatchView["players"][number];

const CLOCK_MULT: Record<ClockId, number> = { bullet: 1.5, blitz: 1.2, rapid: 1 };

// Monkeytype-style XP. Winning fast on a short clock pays most; ghosts-only
// matches pay a fraction so the ladder can't be farmed offline.
export function scoreFor(m: Match, p: Player, r: Result): Award {
  const parts: [string, number][] = [];
  if (m.drop != null) {
    // Drops: one shot, scored on your own clock.
    if (p.doneAt != null) {
      parts.push(["cleared", 60]);
      parts.push([`${p.passed} tests`, p.passed * 5]);
      const speed = Math.max(0, Math.round(100 * (1 - p.doneAt / m.clockMs)));
      if (speed) parts.push(["speed", speed]);
    } else if (p.passed) parts.push([`${p.passed} tests`, p.passed * 5]);
    return { pts: parts.reduce((n, [, v]) => n + v, 0), parts: [...parts, [`drop #${m.drop}`, 0]] };
  }
  const res = r.winner == null ? "draw" : r.winner === p.team ? "win" : "loss";
  parts.push([res, res === "win" ? 100 : res === "draw" ? 40 : 10]);
  if (p.passed) parts.push([`${p.passed} tests`, p.passed * 5]);
  if (res === "win" && p.doneAt != null) {
    const speed = Math.max(0, Math.round(100 * (1 - p.doneAt / m.clockMs)));
    if (speed) parts.push(["speed", speed]);
  }
  let pts = parts.reduce((n, [, v]) => n + v, 0) * CLOCK_MULT[m.clock];
  const mult: [string, number][] = [[`${m.clock} x${CLOCK_MULT[m.clock]}`, 0]];
  for (const h of m.hard ?? []) {
    pts *= HARD_MODES[h].mult;
    mult.push([`${HARD_MODES[h].label} x${HARD_MODES[h].mult}`, 0]);
  }
  if (m.format === "ai") {
    pts *= 1.25;
    mult.push(["boss x1.25", 0]);
  }
  const humansAgainst = m.players.some((o) => o.team !== p.team && !o.bot);
  if (!humansAgainst) {
    pts *= 0.3;
    mult.push(["vs ghosts x0.3", 0]);
  }
  return { pts: Math.round(pts), parts: [...parts, ...mult] };
}
