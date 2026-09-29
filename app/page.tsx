"use client";
import { useCallback, useEffect, useState } from "react";
import Home from "@/components/Home";
import Queue from "@/components/Queue";
import Arena from "@/components/Arena";
import Result from "@/components/Result";
import { getProblem } from "@/lib/problems";
import type { MatchView } from "@/lib/game";
import { api, deviceToken, load, save, type Cfg, type HistoryItem, type Profile, type Session, type Stats } from "@/lib/client";

type Phase =
  | { k: "home" }
  | { k: "queue" }
  | { k: "match"; s: Session }
  | { k: "result"; s: Session; view: MatchView; stats: Stats };

const DEFAULT: Cfg = { format: "classic", mode: "1v1", clock: "blitz", name: "", party: "" };

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ k: "home" });
  const [cfg, setCfgState] = useState<Cfg>(DEFAULT);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Claim / refresh the handle's profile (debounced while typing).
  const refreshProfile = useCallback(async (name: string) => {
    if (name.length < 2) return setProfile(null);
    try {
      const p = await api<Profile & { status: string }>("/api/profile", { handle: name, token: deviceToken() });
      setProfile(p);
      setError(null);
    } catch (e) {
      setProfile(null);
      setError(String((e as Error).message) === "409" ? `"${name}" is claimed on another device. Pick another handle.` : null);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => refreshProfile(cfg.name), 500);
    return () => clearTimeout(t);
  }, [cfg.name, refreshProfile]);

  // Hydrate prefs, and rejoin a live match after a refresh.
  useEffect(() => {
    setCfgState({ ...DEFAULT, ...load<Partial<Cfg>>("cfg", {}) });
    setHistory(load<HistoryItem[]>("history", []));
    const live = load<Session | null>("live", null, "session");
    if (live) setPhase({ k: "match", s: live });
  }, []);

  const setCfg = (c: Cfg) => {
    setCfgState(c);
    save("cfg", c);
  };

  const enter = (s: Session) => {
    save("live", s, "session");
    setPhase({ k: "match", s });
  };

  const find = useCallback(() => setPhase({ k: "queue" }), []);
  const practice = useCallback(async () => {
    try {
      const r = await api<{ matchId: string; playerId: string }>("/api/queue", { ...cfg, token: deviceToken(), practice: true });
      enter({ matchId: r.matchId, playerId: r.playerId });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [cfg]);

  const over = useCallback(
    (view: MatchView, stats: Stats) => {
      if (phase.k !== "match") return;
      save("live", null, "session");
      const me = view.players.find((p) => p.id === phase.s.playerId);
      if (me) {
        const r = view.result.winner == null ? "D" : view.result.winner === me.team ? "W" : "L";
        const item: HistoryItem = { r, t: me.doneAt ?? null, p: getProblem(view.problemId).id, m: view.mode, at: Date.now() };
        const next = [item, ...load<HistoryItem[]>("history", [])].slice(0, 8);
        save("history", next);
        setHistory(next);
      }
      setPhase({ k: "result", s: phase.s, view, stats });
    },
    [phase],
  );

  const home = useCallback(() => {
    save("live", null, "session");
    setPhase({ k: "home" });
    refreshProfile(load<Partial<Cfg>>("cfg", {}).name ?? "");
  }, [refreshProfile]);

  const queueFailed = useCallback((msg: string) => {
    setError(msg);
    setPhase({ k: "home" });
  }, []);

  return (
    <main className="shell">
      <header className="top">
        <div className="logo" onClick={phase.k === "match" ? undefined : home} role="link" aria-label="timed.dev home">
          <span>timed</span><span className="dot">.</span><span className="tld">dev</span>
        </div>
        <span className="spacer" />
        <span className="pill"><span className="live-dot" />{cfg.format === "ai" ? "ai mode" : "classic"} · {cfg.mode} · {cfg.clock}</span>
        {profile && <span className="pill">{profile.handle} <b>{profile.points.toLocaleString()}</b> pts{profile.rank ? ` · #${profile.rank}` : ""}</span>}
        {phase.k !== "match" && <a className="nav" href="/leaderboard">leaderboard</a>}
      </header>

      {phase.k === "home" && <Home cfg={cfg} setCfg={setCfg} history={history} profile={profile} error={error} onFind={find} onPractice={practice} />}
      {phase.k === "queue" && <Queue cfg={cfg} onMatched={enter} onCancel={home} onError={queueFailed} />}
      {phase.k === "match" && <Arena key={phase.s.matchId} session={phase.s} onOver={over} onAbort={home} />}
      {phase.k === "result" && (
        <Result view={phase.view} stats={phase.stats} playerId={phase.s.playerId} ranked={Boolean(profile)} onAward={() => refreshProfile(cfg.name)} onAgain={find} onHome={home} />
      )}

      <footer className="foot">
        {phase.k === "home" && <><span><kbd>enter</kbd> find match</span><span><kbd>alt</kbd>+<kbd>enter</kbd> practice</span></>}
        {phase.k === "queue" && <span><kbd>esc</kbd> leave queue</span>}
        {phase.k === "match" && <><span><kbd>ctrl</kbd>+<kbd>enter</kbd> run</span><span><kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>enter</kbd> submit</span><span><kbd>tab</kbd> indent</span></>}
        {phase.k === "result" && <><span><kbd>enter</kbd> run it back</span><span><kbd>esc</kbd> pits</span></>}
      </footer>
      {phase.k === "home" && <div className="stripe" />}
    </main>
  );
}
