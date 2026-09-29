"use client";
import { useEffect } from "react";
import type { MatchView } from "@/lib/game";
import { getProblem } from "@/lib/problems";
import { fmtTime, type Stats } from "@/lib/client";

type Props = { view: MatchView; stats: Stats; playerId: string; onAgain: () => void; onHome: () => void };

export default function Result({ view, stats, playerId, onAgain, onHome }: Props) {
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
  const ranked = [...view.players].sort(
    (a, b) => (a.doneAt ?? Infinity) - (b.doneAt ?? Infinity) || b.passed - a.passed,
  );

  return (
    <section className="result">
      <h1 className={`verdict ${outcome}`}>{outcome === "win" ? "you win" : outcome === "loss" ? "beaten" : "draw"}</h1>
      <p className="why">{why} Ticket: {problem.title}.</p>

      <div className="stats">
        <div className="stat"><div className="k">time</div><div className="v">{fmtTime(me.doneAt)}</div></div>
        <div className="stat"><div className="k">tests</div><div className="v">{me.passed}<small>/{view.total}</small></div></div>
        <div className="stat"><div className="k">submits</div><div className="v">{stats.submits}<small> {stats.failed ? `+${stats.failed * 10}s` : "clean"}</small></div></div>
        <div className="stat"><div className="k">runs</div><div className="v">{stats.runs}</div></div>
        <div className="stat"><div className="k">paste share</div><div className="v">{aiShare}<small>%</small></div></div>
      </div>

      <div className="board">
        <div className="r h"><span>#</span><span>driver</span><span>time</span><span>tests</span><span>subs</span></div>
        {ranked.map((p, i) => (
          <div key={p.id} className={`r ${p.id === playerId ? "me" : ""}`}>
            <span style={{ color: p.team === 0 ? "var(--a)" : "var(--b)" }}>{i + 1}</span>
            <span>{p.name}{p.isBot ? " · ghost" : ""}</span>
            <span>{fmtTime(p.doneAt)}</span>
            <span>{p.passed}/{view.total}</span>
            <span>{p.attempts}</span>
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
