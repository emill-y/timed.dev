"use client";
import { useEffect, useRef } from "react";
import { CLOCKS } from "@/lib/game";
import { fmtTime, type Cfg, type HistoryItem } from "@/lib/client";

type Props = {
  cfg: Cfg;
  setCfg: (c: Cfg) => void;
  history: HistoryItem[];
  onFind: () => void;
  onPractice: () => void;
};

export default function Home({ cfg, setCfg, history, onFind, onPractice }: Props) {
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        if (e.altKey) onPractice();
        else onFind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFind, onPractice]);

  const wins = history.filter((h) => h.r === "W").length;

  return (
    <>
      <div className="config">
        <button className={`opt ${cfg.mode === "1v1" ? "on" : ""}`} onClick={() => setCfg({ ...cfg, mode: "1v1" })}>1v1 duel</button>
        <button className={`opt ${cfg.mode === "2v2" ? "on" : ""}`} onClick={() => setCfg({ ...cfg, mode: "2v2" })}>2v2 co-hack</button>
        <span className="sep" />
        {CLOCKS.map((c) => (
          <button key={c.id} className={`opt ${cfg.clock === c.id ? "on" : ""}`} onClick={() => setCfg({ ...cfg, clock: c.id })}>
            {c.label}<small>{c.sub}</small>
          </button>
        ))}
        {cfg.mode === "2v2" && (
          <>
            <span className="sep" />
            <span className="opt">party</span>
            <input
              value={cfg.party}
              onChange={(e) => setCfg({ ...cfg, party: e.target.value.replace(/[^\w-]/g, "").slice(0, 12) })}
              placeholder="code (optional)"
              aria-label="Party code: share it with your teammate"
            />
          </>
        )}
      </div>

      <section className="hero">
        <h1 className="slam">
          <span className="r">Prompt.</span> <span className="y">Ship.</span>
          <br />
          <span className="o">Beat</span> the clock.
        </h1>
        <p className="lede">
          You and your opponent get <b>the same ticket</b> and <b>the same clock</b>. Use anything you like: AI, docs, pure muscle memory.
          First to turn <b>every test green</b> wins. The test isn&apos;t whether you can write a for-loop.
          It&apos;s how fast you <b>scope, steer and ship</b>.
        </p>

        <div className="go-row">
          <label className="name">
            <span>handle</span>
            <input
              ref={nameRef}
              value={cfg.name}
              onChange={(e) => setCfg({ ...cfg, name: e.target.value.replace(/[^\w.-]/g, "").slice(0, 18) })}
              placeholder="your_handle"
              spellCheck={false}
              autoFocus
            />
          </label>
          <button className="btn-go" onClick={onFind}>
            <span>{cfg.mode === "2v2" ? "find squad" : "find opponent"}</span>
          </button>
          <button className="btn-ghost" onClick={onPractice}>practice vs ghost</button>
        </div>
        <p className="mobile-note">Heads up: matches are built for a keyboard and a big screen.</p>

        <div className="rules">
          <div><b>01 / the ticket</b>A realistic, loosely specified task. Some edge cases are hidden. Read it like a PR you have to ship.</div>
          <div><b>02 / any tools</b>Paste from your favourite model if you want. Speed and judgement are the skills being tested.</div>
          <div><b>03 / run vs submit</b><i>RUN</i> checks the visible tests for free. <i>SUBMIT</i> runs the hidden ones too, and each failed submit costs <i>+10s</i>.</div>
          <div><b>04 / co-hack</b>In 2v2 your team wins the moment either of you goes all-green. You can see and pull your teammate&apos;s code.</div>
        </div>

        {history.length > 0 && (
          <div className="history">
            <span>last {history.length}: {wins}W</span>
            {history.map((h) => (
              <span key={h.at} className={h.r === "W" ? "w" : h.r === "L" ? "l" : ""}>
                {h.r} {h.p} {fmtTime(h.t)}
              </span>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
