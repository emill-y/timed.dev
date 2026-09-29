"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProblem } from "@/lib/problems";
import { runTests, type RunOutput } from "@/lib/runner";
import { FAIL_PENALTY_MS, type MatchView } from "@/lib/game";
import { api, fmtClock, load, save, type Session, type Stats } from "@/lib/client";

type Props = { session: Session; onOver: (v: MatchView, stats: Stats) => void; onAbort: () => void };

const show = (v: unknown) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

export default function Arena({ session, onOver, onAbort }: Props) {
  const { matchId, playerId } = session;
  const [view, setView] = useState<MatchView | null>(null);
  const [offset, setOffset] = useState(0); // server clock - local clock
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState<string>("");
  const [out, setOut] = useState<RunOutput | null>(null);
  const [outKind, setOutKind] = useState<"run" | "submit">("run");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ t: string; red?: boolean } | null>(null);
  const [lost, setLost] = useState(false);
  const statsRef = useRef<Stats>(load(`stats:${matchId}`, { runs: 0, submits: 0, failed: 0, keys: 0, pasted: 0, typed: 0 }, "session"));
  const [stats, setStats] = useState<Stats>(statsRef.current);
  const bestRef = useRef(0);
  const doneRef = useRef(false);
  const overRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lastSynced = useRef("");

  const problem = useMemo(() => (view ? getProblem(view.problemId) : null), [view?.problemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = view?.players.find((p) => p.id === playerId);
  const started = view ? now + offset >= view.startAt : false;
  const elapsed = view ? now + offset - view.startAt : 0;
  const remaining = view ? view.clockMs - elapsed : 0;

  const bump = (patch: Partial<Stats>) => {
    statsRef.current = { ...statsRef.current, ...patch };
    setStats(statsRef.current);
    save(`stats:${matchId}`, statsRef.current, "session");
  };

  // Restore code after a refresh, otherwise start from the problem's stub.
  useEffect(() => {
    if (problem && !code) setCode(load(`code:${matchId}`, problem.starter, "session"));
  }, [problem]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (code) save(`code:${matchId}`, code, "session");
  }, [code, matchId]);

  const report = useCallback(
    async (extra: Record<string, unknown> = {}) => {
      try {
        const v = await api<MatchView>(`/api/match/${matchId}`, {
          playerId,
          passed: bestRef.current,
          attempts: statsRef.current.submits,
          failedSubmits: statsRef.current.failed,
          code: taRef.current?.value,
          ...extra,
        });
        lastSynced.current = taRef.current?.value ?? "";
        setView(v);
      } catch {}
    },
    [matchId, playerId],
  );

  // Poll match state.
  useEffect(() => {
    let alive = true;
    let misses = 0;
    const poll = async () => {
      try {
        const t = Date.now();
        const r = await fetch(`/api/match/${matchId}?p=${playerId}`, { cache: "no-store" });
        if (r.status === 404) {
          if (++misses > 3) setLost(true);
        } else if (r.ok) {
          misses = 0;
          const v: MatchView = await r.json();
          if (!alive) return;
          setOffset(v.now - (t + Date.now()) / 2);
          setView(v);
        }
      } catch {}
      if (alive) setTimeout(poll, 1000);
    };
    poll();
    const iv = setInterval(() => setNow(Date.now()), 100);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [matchId, playerId]);

  // Co-hack: push code to teammates every few seconds when it changed.
  useEffect(() => {
    if (view?.mode !== "2v2") return;
    const iv = setInterval(() => {
      if (started && !overRef.current && taRef.current && taRef.current.value !== lastSynced.current) report();
    }, 3000);
    return () => clearInterval(iv);
  }, [view?.mode, started, report]);

  // Match over -> hand off to results.
  useEffect(() => {
    if (view?.result.over && !overRef.current) {
      overRef.current = true;
      const won = me && view.result.winner === me.team;
      setToast({ t: view.result.winner == null ? "draw" : won ? "checkered flag" : "beaten", red: !won });
      setTimeout(() => onOver(view, statsRef.current), 1600);
    }
  }, [view, me, onOver]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  const exec = useCallback(
    async (submit: boolean) => {
      if (!problem || busy || !started || overRef.current || doneRef.current) return;
      setBusy(true);
      const res = await runTests(taRef.current?.value ?? "", problem, submit);
      setOut(res);
      setOutKind(submit ? "submit" : "run");
      const passed = res.results.filter((r) => r.pass).length;
      bestRef.current = Math.max(bestRef.current, passed);
      if (submit) {
        const allGreen = !res.fatal && passed === problem.tests.length;
        bump({ submits: statsRef.current.submits + 1, failed: statsRef.current.failed + (allGreen ? 0 : 1) });
        if (allGreen) {
          doneRef.current = true;
          setToast({ t: "all green" });
          await report({ done: true });
        } else {
          setToast({ t: `+${FAIL_PENALTY_MS / 1000}s penalty`, red: true });
          await report();
        }
      } else {
        bump({ runs: statsRef.current.runs + 1 });
        await report();
      }
      setBusy(false);
    },
    [problem, busy, started, report],
  );

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        exec(e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exec]);

  useEffect(() => {
    if (started) taRef.current?.focus();
  }, [started]);

  const onEditorKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value } = ta;
    if (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter") bump({ keys: statsRef.current.keys + 1, typed: statsRef.current.typed + (e.key.length === 1 ? 1 : 0) });
    const insert = (text: string, caret: number) => {
      const next = value.slice(0, s) + text + value.slice(en);
      setCode(next);
      requestAnimationFrame(() => ta.setSelectionRange(caret, caret));
    };
    if (e.key === "Tab") {
      e.preventDefault();
      insert("  ", s + 2);
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const indent = value.slice(lineStart, s).match(/^\s*/)?.[0] ?? "";
      const extra = /[{[(]\s*$/.test(value.slice(lineStart, s)) ? "  " : "";
      insert("\n" + indent + extra, s + 1 + indent.length + extra.length);
    }
  };

  if (lost) {
    return (
      <section className="queue">
        <div className="big-num" style={{ color: "var(--red)" }}>DNF</div>
        <div className="label">match not found on the server (it may have expired)</div>
        <button className="btn-go" onClick={onAbort} style={{ marginTop: 24 }}><span>back to pits</span></button>
      </section>
    );
  }

  if (!view || !problem) {
    return (
      <section className="queue">
        <div className="label">loading grid</div>
        <div className="scan" />
      </section>
    );
  }

  const countdown = Math.ceil((view.startAt - (now + offset)) / 1000);
  const teams = [0, 1].map((t) => view.players.filter((p) => p.team === t));
  const myTeam = me?.team ?? 0;
  const mate = view.mode === "2v2" ? view.players.find((p) => p.team === myTeam && p.id !== playerId) : undefined;
  const visible = problem.tests.filter((t) => !t.hidden);
  const hiddenCount = problem.tests.length - visible.length;
  const penalty = stats.failed * FAIL_PENALTY_MS;
  const aiShare = stats.pasted + stats.typed ? Math.round((stats.pasted / (stats.pasted + stats.typed)) * 100) : 0;
  const lines = code.split("\n").length;

  return (
    <>
      <div className="hud">
        {[0, 1].map((t) => (
          <div key={t} className={`team ${t === 1 ? "right" : ""}`} style={{ "--c": t === 0 ? "var(--a)" : "var(--b)", order: t === 0 ? 0 : 2 } as React.CSSProperties}>
            <div className="team-label">{t === myTeam ? "your team" : "rivals"}</div>
            {teams[t].map((p) => (
              <div className="lane" key={p.id}>
                <span className={`who ${p.id === playerId ? "me" : ""}`}>
                  {p.name}
                  {p.id === playerId && <span className="tag">you</span>}
                  {p.isBot && <span className="tag">ghost</span>}
                </span>
                <span className={`bar ${p.doneAt != null ? "done" : ""}`}>
                  <i style={{ width: `${(p.passed / view.total) * 100}%` }} />
                </span>
                <span className="n">{p.passed}/{view.total}</span>
              </div>
            ))}
          </div>
        ))}
        <div className={`clock ${started && remaining < 30000 ? "low" : ""}`} style={{ order: 1 }}>
          {started ? fmtClock(remaining) : fmtClock(view.clockMs)}
          <small>{view.clock} · {view.mode}</small>
        </div>
      </div>

      <div className="arena">
        <aside className="brief">
          <div className="tier">{problem.tier} · ticket #{problem.id}</div>
          <h2>{started ? problem.title : "████████"}</h2>
          <p>{started ? problem.prompt : "Ticket unlocks at green light."}</p>
          {started && (
            <>
              <div className="sig">{`function ${problem.fn}(…)`}</div>
              <div className="examples">
                {visible.map((t, i) => (
                  <div key={i}>
                    <code>{problem.fn}({t.args.map(show).join(", ")})</code>
                    <br />→ <code>{show(t.expect)}</code>
                  </div>
                ))}
                <div>+ {hiddenCount} hidden edge case{hiddenCount === 1 ? "" : "s"}</div>
              </div>
            </>
          )}
          <div className="hint">
            <kbd>ctrl</kbd>+<kbd>enter</kbd> run · <kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>enter</kbd> submit. Paste is fine. Plain JavaScript, runs in your browser.
          </div>
        </aside>

        <div className="work">
          <div className={`editor ${started && !doneRef.current ? "" : "locked"}`}>
            <div className="gutter" ref={gutterRef}>
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </div>
            <textarea
              ref={taRef}
              value={code}
              readOnly={!started || doneRef.current || overRef.current}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onEditorKey}
              onPaste={(e) => bump({ pasted: statsRef.current.pasted + e.clipboardData.getData("text").length })}
              onScroll={(e) => {
                if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              aria-label="Code editor"
            />
          </div>

          <div className="bar-actions">
            <button className="act" disabled={!started || busy || doneRef.current} onClick={() => exec(false)}><span>run</span></button>
            <button className="act submit" disabled={!started || busy || doneRef.current} onClick={() => exec(true)}><span>submit</span></button>
            <div className="meta">
              <span>runs <b>{stats.runs}</b></span>
              <span>submits <b>{stats.submits}</b></span>
              {penalty > 0 && <span className="pen">penalty +{penalty / 1000}s</span>}
              <span>paste <b>{aiShare}%</b></span>
            </div>
          </div>

          <div className="console">
            {!out && <div className="muted">{started ? "run your code to see results." : "waiting for green light…"}</div>}
            {out && (
              <>
                <div className="sum" style={{ color: out.results.length && out.results.every((r) => r.pass) && !out.fatal ? "var(--green)" : "var(--red)" }}>
                  {out.fatal ? "crashed" : `${out.results.filter((r) => r.pass).length}/${out.results.length} ${outKind === "submit" ? "· submit" : "· visible"}`}
                </div>
                {out.fatal && <div className="fatal">{out.fatal}</div>}
                <div className="dots">
                  {out.results.map((r) => <i key={r.i} className={r.pass ? "ok" : "bad"} />)}
                </div>
                {out.results.map((r) => (
                  <div className="row" key={r.i}>
                    <span className={r.pass ? "ok" : "bad"}>{r.pass ? "✓" : "✗"}</span>
                    <span className={r.pass ? "muted" : ""}>
                      {r.hidden ? (
                        <>hidden #{r.i + 1} {r.error && "· threw"}</>
                      ) : (
                        <>
                          {problem.fn}({r.args?.map(show).join(", ")})
                          {!r.pass && (
                            <>
                              {" "}→ {r.error ? <span className="bad">threw: {r.error}</span> : <>got <span className="bad">{show(r.got)}</span>, want <span className="ok">{show(r.expect)}</span></>}
                            </>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                ))}
                {out.logs.map((l, i) => <div className="log" key={"l" + i}>› {l}</div>)}
              </>
            )}
          </div>

          {mate && (
            <div className="mate">
              <header>
                co-hack · <b>{mate.name}</b>{mate.isBot ? " (ghost, no code)" : ""}
                {mate.code && (
                  <button className="btn-ghost" onClick={() => setCode(mate.code!)}>pull their code</button>
                )}
              </header>
              {mate.code && <pre>{mate.code}</pre>}
            </div>
          )}
        </div>
      </div>

      {!started && (
        <div className="overlay">
          <div key={countdown} className={`big-num flash`}>{Math.max(1, countdown)}</div>
          <div className="sub">{teams.map((t) => t.map((p) => p.name).join(" + ")).join("  vs  ")}</div>
        </div>
      )}
      {toast && <div className={`toast ${toast.red ? "red" : ""}`}>{toast.t}</div>}
    </>
  );
}
