"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProblem } from "@/lib/problems";
import type { RunOutput } from "@/lib/judge";
import { FAIL_PENALTY_MS, type MatchView } from "@/lib/game";
import { api, EMPTY_STATS, fmtClock, load, save, type Session, type Stats } from "@/lib/client";
import Copilot from "./Copilot";
import { corrupt, describe, scramble } from "@/lib/glitch";

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
  const statsRef = useRef<Stats>({ ...EMPTY_STATS, ...load<Partial<Stats>>(`stats:${matchId}`, {}, "session") });
  const [stats, setStats] = useState<Stats>(statsRef.current);
  const doneRef = useRef(false);
  const overRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lastSynced = useRef("");
  // Hard mode "glitch paste".
  const [pasteUsed, setPasteUsed] = useState<boolean>(() => load(`glitch:${matchId}`, false, "session"));
  const [glitchFrame, setGlitchFrame] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  const problem = useMemo(() => (view ? getProblem(view.problemId) : null), [view?.problemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = view?.players.find((p) => p.you);
  const started = view ? now + offset >= view.startAt : false;
  const elapsed = view ? now + offset - view.startAt : 0;
  const remaining = view ? view.clockMs - elapsed : 0;

  // After a refresh, a seat that already finished stays locked.
  if (me?.doneAt != null) doneRef.current = true;

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
          prompts: statsRef.current.prompts,
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
      // Judged on the server: that's the result that counts.
      type Judged = RunOutput & { allGreen: boolean; failed: number; attempts: number; done: boolean };
      try {
        const res = await api<Judged>(`/api/match/${matchId}/judge`, {
          playerId,
          kind: submit ? "submit" : "run",
          code: taRef.current?.value ?? "",
        });
        setOut(res);
        setOutKind(submit ? "submit" : "run");
        if (submit) {
          bump({ submits: res.attempts, failed: res.failed });
          if (res.allGreen) {
            doneRef.current = true;
            setToast({ t: "all green" });
          } else {
            setToast({ t: `+${FAIL_PENALTY_MS / 1000}s penalty`, red: true });
          }
        } else {
          bump({ runs: statsRef.current.runs + 1 });
        }
        report();
      } catch (e) {
        setOut({ results: [], logs: [], fatal: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [problem, busy, started, report, matchId, playerId],
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

  const hardGlitch = Boolean(view?.hard?.includes("glitch"));

  // Plays the scramble animation over the editor, then lands the damaged code.
  const glitchTo = (finalCode: string, preview: string, note: string) => {
    const frames = 14;
    let f = 0;
    const tick = () => {
      f++;
      if (f < frames) {
        const amount = f < frames / 2 ? 0.15 + f * 0.06 : Math.max(0.04, 0.6 - (f - frames / 2) * 0.09);
        setGlitchFrame(scramble(f % 3 === 0 ? finalCode : preview, amount));
        setTimeout(tick, 70);
      } else {
        setGlitchFrame(null);
        setCode(finalCode);
        setToast({ t: `glitched: ${note}`, red: true });
      }
    };
    setGlitchFrame(scramble(preview, 0.1));
    setTimeout(tick, 70);
  };

  const denyClipboard = (msg: string) => {
    setShake(true);
    setTimeout(() => setShake(false), 450);
    setToast({ t: msg, red: true });
  };

  // A paste (or a pull / drop) under glitch mode: the first one lands
  // corrupted, then the clipboard locks for the rest of the match.
  const glitchPaste = (pasted: string, start: number, end: number) => {
    if (pasteUsed || glitchFrame != null) return denyClipboard("clipboard locked");
    const { text: bad, report } = corrupt(pasted, Date.now());
    const current = taRef.current?.value ?? code;
    const clean = current.slice(0, start) + pasted + current.slice(end);
    const damaged = current.slice(0, start) + bad + current.slice(end);
    setPasteUsed(true);
    save(`glitch:${matchId}`, true, "session");
    bump({ pasted: statsRef.current.pasted + pasted.length });
    glitchTo(damaged, clean, describe(report));
  };

  // Copilot output under glitch mode is always damaged on arrival.
  const glitchApply = (next: string) => {
    const { text: bad, report } = corrupt(next, Date.now());
    glitchTo(bad, next, describe(report));
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
  const mate = view.mode === "2v2" ? view.players.find((p) => p.team === myTeam && !p.you) : undefined;
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
                <span className={`who ${p.you ? "me" : ""}`}>
                  {p.name}
                  {p.you && <span className="tag">you</span>}
                  {!p.you && !p.isBot && !p.ranked && <span className="tag">guest</span>}
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

      <div className={`arena ${view.format === "ai" ? "with-ai" : ""}`}>
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
            <kbd>ctrl</kbd>+<kbd>enter</kbd> run · <kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>enter</kbd> submit
            {view.format === "ai" ? <> · <kbd>ctrl</kbd>+<kbd>k</kbd> copilot. Boss ticket: the copilot is your co-driver.</> : hardGlitch ? null : <>. Paste is fine.</>} Plain JavaScript, judged on the server.
            {hardGlitch && (
              <span className="hard-note">
                <b>glitch paste is on.</b> Your first paste lands damaged (lines deleted, names scrambled) and then the clipboard locks.
                {view.format === "ai" ? " Copilot code arrives damaged every time." : ""}
              </span>
            )}
          </div>
        </aside>

        <div className="work">
          <div className={`editor ${started && !doneRef.current ? "" : "locked"} ${shake ? "shake" : ""} ${glitchFrame != null ? "glitching" : ""}`}>
            {glitchFrame != null && (
              <pre className="glitch-layer" aria-hidden style={{ left: gutterRef.current?.offsetWidth ?? 52 }}>{glitchFrame}</pre>
            )}
            {hardGlitch && (
              <span className={`clip-badge ${pasteUsed ? "locked" : ""}`}>
                {pasteUsed ? "clipboard locked" : "1 glitched paste left"}
              </span>
            )}
            <div className="gutter" ref={gutterRef}>
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </div>
            <textarea
              ref={taRef}
              value={code}
              readOnly={!started || doneRef.current || overRef.current || glitchFrame != null}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onEditorKey}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (!hardGlitch) return bump({ pasted: statsRef.current.pasted + text.length });
                e.preventDefault();
                if (e.currentTarget.readOnly) return;
                glitchPaste(text, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
              }}
              onCopy={(e) => {
                if (hardGlitch && pasteUsed) {
                  e.preventDefault();
                  denyClipboard("copy locked");
                }
              }}
              onCut={(e) => {
                if (hardGlitch && pasteUsed) {
                  e.preventDefault();
                  denyClipboard("cut locked");
                }
              }}
              onDrop={(e) => {
                if (!hardGlitch) return;
                e.preventDefault();
                denyClipboard("no drag & drop in glitch mode");
              }}
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
              {view.format === "ai" ? <span>prompts <b>{stats.prompts}</b></span> : <span>paste <b>{aiShare}%</b></span>}
            </div>
          </div>

          <div className="console">
            {busy && <div className="muted">judging on the server…</div>}
            {!busy && !out && <div className="muted">{started ? "run your code to see results. Tests are judged server-side." : "waiting for green light…"}</div>}
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
                  <button
                    className="btn-ghost"
                    onClick={() => (hardGlitch ? glitchPaste(mate.code!, 0, (taRef.current?.value ?? code).length) : setCode(mate.code!))}
                  >
                    pull their code
                  </button>
                )}
              </header>
              {mate.code && <pre>{mate.code}</pre>}
            </div>
          )}
        </div>

        {view.format === "ai" && (
          <Copilot
            problem={problem}
            locked={!started || doneRef.current || Boolean(view.result.over)}
            getCode={() => taRef.current?.value ?? code}
            applyCode={hardGlitch ? glitchApply : setCode}
            lastRun={out}
            onUsage={(u) =>
              bump({
                prompts: statsRef.current.prompts + 1,
                tokensIn: statsRef.current.tokensIn + u.input,
                tokensOut: statsRef.current.tokensOut + u.output,
                aiChars: statsRef.current.aiChars + u.aiChars,
              })
            }
          />
        )}
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
