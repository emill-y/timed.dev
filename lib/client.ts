// Small browser-side helpers shared by the screens.
export type Cfg = { format: "classic" | "ai"; mode: "1v1" | "2v2"; clock: "bullet" | "blitz" | "rapid"; name: string; party: string; hard: "glitch"[] };
export type Session = { matchId: string; playerId: string };
export type Stats = {
  runs: number; submits: number; failed: number; keys: number; pasted: number; typed: number;
  prompts: number; tokensIn: number; tokensOut: number; aiChars: number;
};
export const EMPTY_STATS: Stats = { runs: 0, submits: 0, failed: 0, keys: 0, pasted: 0, typed: 0, prompts: 0, tokensIn: 0, tokensOut: 0, aiChars: 0 };

export type Me = {
  username: string; points: number; byFormat: { classic: number; ai: number };
  wins: number; losses: number; draws: number; matches: number;
  best: { classic?: number; ai?: number }; rank: number | null;
};

export type HistoryItem = { r: "W" | "L" | "D"; t: number | null; p: string; m: string; at: number };

export function load<T>(k: string, fallback: T, store: "local" | "session" = "local"): T {
  try {
    const s = store === "local" ? localStorage : sessionStorage;
    const raw = s.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(k: string, v: unknown, store: "local" | "session" = "local") {
  try {
    const s = store === "local" ? localStorage : sessionStorage;
    if (v === null) s.removeItem(k);
    else s.setItem(k, JSON.stringify(v));
  } catch {}
}

export function fmtClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtTime(ms: number | null | undefined) {
  if (ms == null) return "—";
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || String(r.status));
  }
  return r.json();
}
