"use client";
import { useEffect, useState } from "react";
import { fmtTime, load, type Cfg } from "@/lib/client";

type Row = { rank: number; handle: string; points: number; wins: number; matches: number; bestClassic: number | null; bestAi: number | null };
type Data = { board: string; rows: Row[]; me: { rank: number } | null };

const BOARDS = [
  { id: "all", label: "all-time" },
  { id: "today", label: "today" },
  { id: "classic", label: "classic" },
  { id: "ai", label: "ai mode" },
];

export default function Leaderboard() {
  const [board, setBoard] = useState("all");
  const [data, setData] = useState<Data | null>(null);
  const [me, setMe] = useState("");

  useEffect(() => setMe(load<Partial<Cfg>>("cfg", {}).name ?? ""), []);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetch(`/api/leaderboard?board=${board}${me ? `&me=${encodeURIComponent(me)}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Data) => alive && setData(d))
      .catch(() => alive && setData({ board, rows: [], me: null }));
    return () => {
      alive = false;
    };
  }, [board, me]);

  const mine = data?.rows.find((r) => r.handle.toLowerCase() === me.toLowerCase());

  return (
    <main className="shell">
      <header className="top">
        <a className="logo" href="/" aria-label="timed.dev home" style={{ textDecoration: "none" }}>
          <span>timed</span><span className="dot">.</span><span className="tld">dev</span>
        </a>
        <span className="spacer" />
        <a className="nav" href="/">race</a>
      </header>

      <div className="config">
        {BOARDS.map((b) => (
          <button key={b.id} className={`opt ${board === b.id ? "on" : ""}`} onClick={() => setBoard(b.id)}>{b.label}</button>
        ))}
      </div>

      <section className="lb">
        <h1 className="slam small">
          <span className="r">Leader</span>board
        </h1>
        {data?.me && !mine && (
          <p className="why">You ({me}) are <b>#{data.me.rank}</b> on this board.</p>
        )}

        <div className="lb-table">
          <div className="lb-row h">
            <span>#</span><span>driver</span><span className="num">pts</span><span className="num">wins</span><span className="num">races</span>
            <span className="num">best classic</span><span className="num">best ai</span>
          </div>
          {!data && <div className="lb-row muted"><span /><span>loading…</span></div>}
          {data && data.rows.length === 0 && (
            <div className="lb-empty">
              Empty grid. Finish a match with a handle set and you&apos;re on it.
            </div>
          )}
          {data?.rows.map((r) => (
            <div key={r.handle} className={`lb-row ${r.handle.toLowerCase() === me.toLowerCase() ? "me" : ""} ${r.rank <= 3 ? "podium" : ""}`}>
              <span className="rk">{r.rank}</span>
              <span className="hd">{r.handle}</span>
              <span className="num pts">{r.points.toLocaleString()}</span>
              <span className="num">{r.wins}</span>
              <span className="num">{r.matches}</span>
              <span className="num">{fmtTime(r.bestClassic)}</span>
              <span className="num">{fmtTime(r.bestAi)}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="foot">
        <span>points: win 100 · draw 40 · loss 10 · +5 per test · speed bonus on wins</span>
        <span>bullet x1.5 · blitz x1.2 · ai mode x1.25 · vs ghosts x0.3</span>
      </footer>
    </main>
  );
}
