"use client";
import { useEffect, useState } from "react";
import { CLOCKS } from "@/lib/game";
import { fmtTime, type Cfg, type HistoryItem, type Me } from "@/lib/client";
import { loadAi, maskKey, type AiSettings } from "@/lib/ai";
import KeySettings from "./KeySettings";
import { HARD_MODES, type HardMode } from "@/lib/glitch";

type Props = {
  cfg: Cfg;
  setCfg: (c: Cfg) => void;
  history: HistoryItem[];
  user: Me | null;
  error: string | null;
  modalOpen: boolean;
  onAuth: (tab: "login" | "signup") => void;
  onFind: () => void;
  onPractice: () => void;
};

export default function Home({ cfg, setCfg, history, user, error, modalOpen, onAuth, onFind, onPractice }: Props) {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const isAi = cfg.format === "ai";
  const needsKey = isAi && ai != null && !ai.key;

  useEffect(() => setAi(loadAi()), []);

  const go = (practice: boolean) => {
    if (needsKey) return setKeysOpen(true);
    if (practice) onPractice();
    else onFind();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen) return;
      if (keysOpen) {
        if (e.key === "Escape") setKeysOpen(false);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        go(e.altKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const wins = history.filter((h) => h.r === "W").length;

  return (
    <>
      <div className="config">
        <button className={`opt ${!isAi ? "on" : ""}`} onClick={() => setCfg({ ...cfg, format: "classic" })}>classic</button>
        <button className={`opt ${isAi ? "on red" : ""}`} onClick={() => setCfg({ ...cfg, format: "ai" })}>ai mode</button>
        <span className="sep" />
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
        {isAi && ai && (
          <>
            <span className="sep" />
            <button className="opt" onClick={() => setKeysOpen(true)}>
              copilot <small>{ai.key ? `${ai.model} · ${maskKey(ai.key)}` : "add key"}</small>
            </button>
          </>
        )}
      </div>

      <div className="hardbar">
        <span className="k">hard modes</span>
        {(Object.keys(HARD_MODES) as HardMode[]).map((h) => {
          const on = cfg.hard.includes(h);
          return (
            <button
              key={h}
              className={`hard-chip ${on ? "on" : ""}`}
              onClick={() => setCfg({ ...cfg, hard: on ? cfg.hard.filter((x) => x !== h) : [...cfg.hard, h] })}
              title={HARD_MODES[h].blurb}
            >
              <span className="box">{on ? "■" : "□"}</span> {HARD_MODES[h].label} <small>x{HARD_MODES[h].mult}</small>
            </button>
          );
        })}
        {cfg.hard.includes("glitch") && <span className="blurb">{HARD_MODES.glitch.blurb}</span>}
      </div>

      <section className="hero">
        {isAi ? (
          <h1 className="slam">
            <span className="r">Out-prompt</span>
            <br />
            <span className="o">the</span> <span className="y">other</span> driver.
          </h1>
        ) : (
          <h1 className="slam">
            <span className="r">Prompt.</span> <span className="y">Ship.</span>
            <br />
            <span className="o">Beat</span> the clock.
          </h1>
        )}
        <p className="lede">
          {isAi ? (
            <>
              <b>AI mode</b> hands you boss tickets: bigger specs with nastier hidden cases. You get a <b>built-in copilot</b> that uses
              your own Claude or OpenAI key. The question is simple: <b>how good a Claude coder are you</b>? Can you scope the ask, steer
              the model and catch its mistakes faster than the other side?
            </>
          ) : (
            <>
              You and your opponent get <b>the same ticket</b> and <b>the same clock</b>. Use anything you like: AI, docs, pure muscle memory.
              First to turn <b>every test green</b> wins. The test isn&apos;t whether you can write a for-loop.
              It&apos;s how fast you <b>scope, steer and ship</b>.
            </>
          )}
        </p>

        <div className="go-row">
          {user ? (
            <div className="name">
              <span>driver</span>
              <b className="driver">{user.username}</b>
            </div>
          ) : (
            <label className="name">
              <span>guest</span>
              <input
                value={cfg.name}
                onChange={(e) => setCfg({ ...cfg, name: e.target.value.replace(/[^\w.-]/g, "").slice(0, 18) })}
                placeholder="guest_name"
                spellCheck={false}
                autoFocus
              />
            </label>
          )}
          <button className="btn-go" onClick={() => go(false)}>
            <span>{needsKey ? "add api key" : cfg.mode === "2v2" ? "find squad" : "find opponent"}</span>
          </button>
          <button className="btn-ghost" onClick={() => go(true)}>practice vs ghost</button>
        </div>

        <div className="status-row">
          {error ? (
            <span className="bad">{error}</span>
          ) : user ? (
            <>
              <span><b>{user.points.toLocaleString()}</b> pts</span>
              <span>rank <b>{user.rank ? `#${user.rank}` : "unranked"}</b></span>
              <span><b>{user.wins}</b>W / <b>{user.losses}</b>L / <b>{user.draws}</b>D</span>
              {user.best.classic != null && <span>best classic <b>{fmtTime(user.best.classic)}</b></span>}
              {user.best.ai != null && <span>best ai <b>{fmtTime(user.best.ai)}</b></span>}
            </>
          ) : (
            <span>
              Playing as a guest (no points).{" "}
              <button className="link" onClick={() => onAuth("signup")}>Sign up</button> or{" "}
              <button className="link" onClick={() => onAuth("login")}>log in</button> to earn points and get on the{" "}
              <a href="/leaderboard">leaderboard</a>.
            </span>
          )}
        </div>
        <p className="mobile-note">Heads up: matches are built for a keyboard and a big screen.</p>

        <div className="rules">
          {isAi ? (
            <>
              <div><b>01 / boss tickets</b>Parsers, caches, graph work. Specs a model half-solves on the first try. The hidden tests find the other half.</div>
              <div><b>02 / your key</b>Anthropic or OpenAI. It stays in your browser and goes <i>straight to the provider</i>. timed.dev never sees it.</div>
              <div><b>03 / the loop</b>Prompt, auto-apply, <i>RUN</i>, feed the failures back, <i>SUBMIT</i>. Every failed submit still costs <i>+10s</i>.</div>
              <div><b>04 / scoring</b>Boss wins pay <i>x1.25</i>. Your prompt count shows on the results screen. Fewer prompts means you scoped it better.</div>
            </>
          ) : (
            <>
              <div><b>01 / the ticket</b>A realistic, loosely specified task. Some edge cases are hidden. Read it like a PR you have to ship.</div>
              <div><b>02 / any tools</b>Paste from your favourite model if you want. Speed and judgement are the skills being tested.</div>
              <div><b>03 / run vs submit</b><i>RUN</i> checks the visible tests for free. <i>SUBMIT</i> runs the hidden ones too, and each failed submit costs <i>+10s</i>.</div>
              <div><b>04 / points</b>Every submit is judged <i>on the server</i>, so points are real. Wins, tests and speed score; shorter clocks pay more. Climb the <a href="/leaderboard">board</a>.</div>
            </>
          )}
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

      {keysOpen && ai && (
        <div className="overlay modal" onClick={(e) => e.target === e.currentTarget && setKeysOpen(false)}>
          <div className="sheet">
            <h3>copilot key</h3>
            <KeySettings value={ai} onChange={setAi} onClose={() => setKeysOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
