"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Me } from "@/lib/client";

type Props = { initial?: "login" | "signup"; onDone: (u: Me) => void; onClose: () => void };

export default function AuthModal({ initial = "login", onDone, onClose }: Props) {
  const [tab, setTab] = useState<"login" | "signup">(initial);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    userRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: Me }>(`/api/auth/${tab}`, { username, password });
      onDone(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet auth" onSubmit={submit} onKeyDown={(e) => e.stopPropagation()}>
        <div className="auth-tabs">
          <button type="button" className={`opt ${tab === "login" ? "on" : ""}`} onClick={() => setTab("login")}>log in</button>
          <button type="button" className={`opt ${tab === "signup" ? "on" : ""}`} onClick={() => setTab("signup")}>sign up</button>
        </div>
        <h3>{tab === "login" ? "back in the seat" : "get a racing licence"}</h3>
        <label>
          <span>username</span>
          <input
            ref={userRef}
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/[^\w.-]/g, "").slice(0, 18))}
            autoComplete="username"
            spellCheck={false}
            required
            minLength={3}
          />
        </label>
        <label>
          <span>password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            required
            minLength={tab === "signup" ? 8 : 1}
          />
        </label>
        {tab === "signup" && <p className="fine">3-18 characters: letters, numbers, _ . -. Password at least 8 characters. No email needed, so pick a password you won&apos;t forget: there&apos;s no reset yet.</p>}
        {error && <p className="bad">{error}</p>}
        <div className="keys-row">
          <button className="act submit" type="submit" disabled={busy}><span>{busy ? "…" : tab === "login" ? "log in" : "create account"}</span></button>
          <button type="button" className="btn-ghost" onClick={onClose}>cancel</button>
        </div>
      </form>
    </div>
  );
}
