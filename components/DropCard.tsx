"use client";
import { useEffect, useState } from "react";
import { api, fmtClock, fmtTime, signIn, type Me, type Session } from "@/lib/client";
import Avatar from "./Avatar";

type Row = { rank: number; login: string; ms: number; avatar: string | null };
type Drops = {
  now: number;
  current: { n: number; startsAt: number; endsAt: number; title: string; tier: string; clockMs: number; entrants: number; board: Row[]; entered: boolean };
  previous: { n: number; title: string; board: Row[] };
};

// The 30-minute drop: countdown, live board, one shot.
export default function DropCard({ user, onEnter, onError }: { user: Me | null; onEnter: (s: Session) => void; onError: (m: string) => void }) {
  const [d, setD] = useState<Drops | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api<Drops>("/api/drops");
        if (!alive) return;
        setD(r);
        setOffset(r.now - Date.now());
      } catch {}
    };
    load();
    const poll = setInterval(load, 15000);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [user?.username]);

  // Roll over to the next drop the moment the window closes.
  useEffect(() => {
    if (d && now + offset >= d.current.endsAt) api<Drops>("/api/drops").then(setD).catch(() => {});
  }, [now, offset, d]);

  if (!d) return <div className="drop skeleton" />;
  const c = d.current;
  const left = c.endsAt - (now + offset);

  const take = async () => {
    if (!user) return signIn();
    setBusy(true);
    try {
      const r = await api<{ matchId: string; playerId: string }>("/api/drops/start", {});
      onEnter({ matchId: r.matchId, playerId: r.playerId });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="drop">
      <div className="drop-head">
        <span className="drop-tag">drop #{c.n}</span>
        <span className="drop-live"><i /> live</span>
        <span className="drop-glitch">glitch paste on</span>
        <span className="drop-left">closes in <b>{fmtClock(left)}</b></span>
      </div>
      <div className="drop-body">
        <div className="drop-main">
          <h3>{c.title}</h3>
          <p>
            A fresh generated ticket every 30 minutes. <b>One attempt</b>, {fmtClock(c.clockMs)} on your clock, fastest clear takes the board.
            {" "}<b>Glitch paste is always on:</b> your one paste lands damaged, then the clipboard locks.
            {" "}{c.entrants} cleared so far.
          </p>
          <button className="btn-go small" onClick={take} disabled={busy || c.entered}>
            <span>{c.entered ? "attempt used" : user ? "take the drop" : "sign in to drop in"}</span>
          </button>
          {c.entered && <span className="drop-note">next drop in {fmtClock(left)}</span>}
        </div>
        <ol className="drop-board">
          {c.board.length === 0 && <li className="empty">nobody on the board yet. First clear takes #1.</li>}
          {c.board.slice(0, 5).map((r) => (
            <li key={r.login} className={user && r.login.toLowerCase() === user.username.toLowerCase() ? "me" : ""}>
              <span className="rk">{r.rank}</span>
              <Avatar src={r.avatar} login={r.login} />
              <span className="lg">{r.login}</span>
              <span className="ms">{fmtTime(r.ms)}</span>
            </li>
          ))}
          {d.previous.board[0] && (
            <li className="prev">
              last drop: <b>{d.previous.board[0].login}</b> took #{d.previous.n} in {fmtTime(d.previous.board[0].ms)}
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}
