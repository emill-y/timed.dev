"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Cfg, type Session } from "@/lib/client";

type Waiting = { status: "waiting"; ticket: string; inQueue: number; size: number; waited: number; botFillMs: number; shared: boolean };
type Matched = { status: "matched"; matchId: string; playerId: string };

export default function Queue({ cfg, onMatched, onCancel }: { cfg: Cfg; onMatched: (s: Session) => void; onCancel: () => void }) {
  const [state, setState] = useState<Waiting | null>(null);
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const ticket = useRef<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api<Waiting | Matched>("/api/queue", { ...cfg, ticket: ticket.current });
        if (!alive) return;
        if (r.status === "matched") return onMatched({ matchId: r.matchId, playerId: r.playerId });
        ticket.current = r.ticket;
        setState(r);
      } catch {}
      if (alive) setTimeout(tick, 1000);
    };
    tick();
    const iv = setInterval(() => setNow(Date.now()), 100);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      clearInterval(iv);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const secs = Math.floor((now - t0) / 1000);
  const size = state?.size ?? (cfg.mode === "2v2" ? 4 : 2);
  const found = Math.min(size, state?.inQueue ?? 1);
  const ghostIn = state ? Math.max(0, Math.ceil((state.botFillMs - state.waited) / 1000)) : null;

  return (
    <section className="queue">
      <div className="label">searching · {cfg.mode} · {cfg.clock}{cfg.party ? ` · party ${cfg.party}` : ""}</div>
      <div className="big-num">{String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}</div>
      <div className="seats">
        {Array.from({ length: size }, (_, i) => (
          <span key={i} className={`seat ${i >= size / 2 ? "b" : ""} ${i < found ? "on" : ""}`} />
        ))}
      </div>
      <div className="scan" />
      <div className="label" style={{ marginTop: 12 }}>
        {found}/{size} on the grid
        {ghostIn != null && ghostIn > 0 && ` · ghosts fill empty seats in ${ghostIn}s`}
        {ghostIn === 0 && " · dropping ghosts in"}
      </div>
      {state && !state.shared && (
        <div className="pill" style={{ maxWidth: 520 }}>
          No shared queue configured on this deployment (Upstash Redis), so humans only meet if they land on the same server instance. Otherwise ghosts take the empty seats.
        </div>
      )}
      <button className="btn-ghost" onClick={onCancel} style={{ marginTop: 24 }}>cancel <kbd>esc</kbd></button>
    </section>
  );
}
