"use client";
import { useState } from "react";

// GitHub avatar with an initials fallback (blocked CDN, deleted account...).
export default function Avatar({ src, login, big }: { src?: string | null; login?: string; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = big ? "av" : "av-sm";
  if (src && !broken) return <img src={src} alt="" className={cls} onError={() => setBroken(true)} />;
  return <span className={`${cls} av-mono`} aria-hidden>{(login ?? "td").slice(0, 2)}</span>;
}
