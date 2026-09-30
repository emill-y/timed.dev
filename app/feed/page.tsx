"use client";
import { useCallback, useEffect, useState } from "react";
import { ago, api, signIn } from "@/lib/client";
import Avatar from "@/components/Avatar";

type Span = { t: string; b?: boolean };
type Comment = { id: string; at: number; by: { login: string; avatar?: string }; text: string };
type Post = {
  id: string; at: number; kind: "match" | "drop" | "drop_open";
  actor?: { login: string; avatar?: string }; line: Span[]; detail: string;
  pts?: number; won?: boolean; drop?: number; likes: number; liked: boolean; comments: Comment[];
};
type Page = { posts: Post[]; me: { login: string; avatar?: string } | null; next: number | null };

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [me, setMe] = useState<Page["me"]>(null);
  const [next, setNext] = useState<number | null>(0);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (offset: number, replace: boolean) => {
    const r = await api<Page>(`/api/feed?offset=${offset}`);
    setMe(r.me);
    setNext(r.next);
    setPosts((cur) => (replace ? r.posts : [...cur, ...r.posts]));
    setLoaded(true);
  }, []);

  useEffect(() => {
    load(0, true).catch(() => setLoaded(true));
    // Nudge the drop endpoint so a fresh window's "drop is live" post exists.
    fetch("/api/drops", { cache: "no-store" }).catch(() => {});
    const refresh = setInterval(() => load(0, true).catch(() => {}), 20000);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [load]);

  const like = async (p: Post) => {
    if (!me) return signIn();
    setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) } : x)));
    await api(`/api/feed/${p.id}/like`, {}).catch(() => load(0, true));
  };

  const comment = async (p: Post) => {
    if (!me) return signIn();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      const r = await api<{ comment: Comment }>(`/api/feed/${p.id}/comment`, { text });
      setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, comments: [...x.comments, r.comment] } : x)));
    } catch {}
  };

  return (
    <main className="shell">
      <header className="top">
        <a className="logo" href="/" aria-label="timed.dev home" style={{ textDecoration: "none" }}>
          <span>timed</span><span className="dot">.</span><span className="tld">dev</span>
        </a>
        <span className="spacer" />
        <a className="nav" href="/">race</a>
        <a className="nav" href="/leaderboard">leaderboard</a>
        {me ? (
          <span className="pill who"><Avatar src={me.avatar} login={me.login} />{me.login}</span>
        ) : (
          <button className="nav hot gh" onClick={signIn}>sign in with GitHub</button>
        )}
      </header>

      <section className="feed">
        <h1 className="slam small"><span className="r">The</span> feed</h1>
        <p className="why">Every clear, every beatdown, every drop. Live.</p>

        {loaded && posts.length === 0 && <div className="lb-empty">Quiet grid. Finish a match signed in and you&apos;re the first post.</div>}

        <ul className="posts">
          {posts.map((p) => (
            <li key={p.id} className={`post k-${p.kind}`}>
              {p.kind === "drop_open" ? (
                <div className="post-drop">
                  <span className="drop-tag">drop #{p.drop}</span>
                  <div>
                    <div className="line">{p.line.map((s, i) => (s.b ? <b key={i}>{s.t}</b> : <span key={i}>{s.t}</span>))}</div>
                    <div className="detail">{p.detail} · {ago(p.at, now)}</div>
                  </div>
                  <a className="btn-ghost" href="/">take it</a>
                </div>
              ) : (
                <>
                  <Avatar src={p.actor?.avatar} login={p.actor?.login} big />
                  <div className="post-body">
                    <div className="line">{p.line.map((s, i) => (s.b ? <b key={i}>{s.t}</b> : <span key={i}>{s.t}</span>))}</div>
                    <div className="meta">{ago(p.at, now)} · <span className="globe">public</span></div>
                    <div className="detail">{p.detail}</div>
                    <div className="acts">
                      <button className={`heart ${p.liked ? "on" : ""}`} onClick={() => like(p)} aria-label="like">
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="M12 21s-7.5-4.6-10-9.3C.4 8.3 2.4 4 6.3 4c2.2 0 3.7 1.3 4.7 2.8C12 5.3 13.5 4 15.7 4c3.9 0 5.9 4.3 4.3 7.7C19.5 16.4 12 21 12 21z" fill={p.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" /></svg>
                        {p.likes > 0 && <span>{p.likes}</span>}
                      </button>
                      <button className="bubble" onClick={() => setOpen(open === p.id ? null : p.id)} aria-label="comments">
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
                        {p.comments.length > 0 && <span>{p.comments.length}</span>}
                      </button>
                    </div>
                    {(open === p.id || p.comments.length > 0) && (
                      <div className="comments">
                        {p.comments.slice(open === p.id ? 0 : -2).map((c) => (
                          <div key={c.id} className="comment"><b>{c.by.login}</b> {c.text}</div>
                        ))}
                        {open === p.id && (
                          <form className="reply" onSubmit={(e) => { e.preventDefault(); comment(p); }}>
                            <input value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 140))} placeholder={me ? "talk your talk…" : "sign in to comment"} autoFocus />
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                  {p.pts != null && <div className={`amt ${p.won ? "up" : "down"}`}>+{p.pts}<small>pts</small></div>}
                </>
              )}
            </li>
          ))}
        </ul>
        {next != null && posts.length > 0 && (
          <button className="btn-ghost more" onClick={() => load(next, false)}>older</button>
        )}
      </section>
    </main>
  );
}
