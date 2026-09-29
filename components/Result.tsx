"use client";
import { useEffect, useState } from "react";
import type { Award, MatchView } from "@/lib/game";
import { getProblem } from "@/lib/problems";
import { fmtTime, type Stats } from "@/lib/client";

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

type Props = { view: MatchView; stats: Stats; playerId: string; ranked: boolean; onAward: () => void; onAgain: () => void; onHome: () => void };

export default function Result({ view, stats, playerId, ranked, onAward, onAgain, onHome }: Props) {
  const [award, setAward] = useState<Award | null>(view.awards?.[playerId] ?? null);

  // Points settle on the server a beat after the flag; poll briefly for them.
  useEffect(() => {
    if (award) return;
    let n = 0;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/match/${view.id}?p=${playerId}`, { cache: "no-store" });
        const v: MatchView = await r.json();
        if (alive && v.awards?.[playerId]) return setAward(v.awards[playerId]);
      } catch {}
      if (alive && ++n < 8) setTimeout(tick, 700);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [award, view.id, playerId]);

  useEffect(() => {
    if (award) onAward();
  }, [award]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = view.players.find((p) => p.id === playerId)!;
  const { winner, teamTime, teamBest } = view.result;
  const outcome = winner == null ? "draw" : winner === me.team ? "win" : "loss";
  const problem = getProblem(view.problemId);
  const opp = (me.team ^ 1) as 0 | 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onAgain();
      } else if (e.key === "Escape") onHome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAgain, onHome]);

  let why: string;
  const mine = teamTime[me.team];
  const theirs = teamTime[opp];
  if (mine != null && (theirs == null || mine < theirs)) why = `All green in ${fmtTime(mine)}${theirs != null ? `, ${fmtTime(theirs - mine)} ahead of the rivals` : " while the rivals were still red"}.`;
  else if (theirs != null && (mine == null || theirs < mine)) why = `Rivals went all-green in ${fmtTime(theirs)}${mine != null ? `, ${fmtTime(mine - theirs)} ahead of you` : ""}.`;
  else if (mine != null && mine === theirs) why = "Dead heat. Same finish time, down to the millisecond.";
  else why = `Clock ran out. Decided on tests passed: ${teamBest[me.team]} vs ${teamBest[opp]}.`;

  const aiShare = stats.pasted + stats.typed ? Math.round((stats.pasted / (stats.pasted + stats.typed)) * 100) : 0;
  const order = [...view.players].sort(
    (a, b) => (a.doneAt ?? Infinity) - (b.doneAt ?? Infinity) || b.passed - a.passed,
  );

  return (
    <section className="result">
      <h1 className={`verdict ${outcome}`}>{outcome === "win" ? "you win" : outcome === "loss" ? "beaten" : "draw"}</h1>
      <p className="why">{why} Ticket: {problem.title}.</p>

      <div className="points">
        <span className="plus">{award ? `+${award.pts}` : "+…"}</span>
        <span className="unit">pts{ranked ? "" : " (unranked: pick a handle to bank them)"}</span>
        {award && (
          <span className="parts">
            {award.parts.map(([k, v]) => (
              <span key={k}>{v ? `${k} +${v}` : k}</span>
            ))}
          </span>
        )}
      </div>

      <div className="stats">
        <div className="stat"><div className="k">time</div><div className="v">{fmtTime(me.doneAt)}</div></div>
        <div className="stat"><div className="k">tests</div><div className="v">{me.passed}<small>/{view.total}</small></div></div>
        <div className="stat"><div className="k">submits</div><div className="v">{stats.submits}<small> {stats.failed ? `+${stats.failed * 10}s` : "clean"}</small></div></div>
        {view.format === "ai" ? (
          <>
            <div className="stat"><div className="k">prompts</div><div className="v">{stats.prompts}</div></div>
            <div className="stat"><div className="k">tokens</div><div className="v">{fmtK(stats.tokensIn + stats.tokensOut)}</div></div>
          </>
        ) : (
          <>
            <div className="stat"><div className="k">runs</div><div className="v">{stats.runs}</div></div>
            <div className="stat"><div className="k">paste share</div><div className="v">{aiShare}<small>%</small></div></div>
          </>
        )}
      </div>

      <div className="board">
        <div className="r h"><span>#</span><span>driver</span><span>time</span><span>tests</span><span>{view.format === "ai" ? "prompts" : "subs"}</span></div>
        {order.map((p, i) => (
          <div key={p.id} className={`r ${p.id === playerId ? "me" : ""}`}>
            <span style={{ color: p.team === 0 ? "var(--a)" : "var(--b)" }}>{i + 1}</span>
            <span>{p.name}{p.isBot ? " · ghost" : ""}</span>
            <span>{fmtTime(p.doneAt)}</span>
            <span>{p.passed}/{view.total}</span>
            <span>{view.format === "ai" ? (p.isBot ? "—" : p.prompts ?? 0) : p.attempts}</span>
          </div>
        ))}
      </div>

      <div className="next-row">
        <button className="btn-go" onClick={onAgain}><span>run it back</span></button>
        <button className="btn-ghost" onClick={onHome}>back to pits <kbd>esc</kbd></button>
      </div>
    </section>
  );
}
