// Sign-in is GitHub OAuth only. Sessions are random tokens in an httpOnly
// cookie, stored server-side only as a SHA-256 hash.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { del, get, incr, set } from "./store";
import { getUser, type User } from "./accounts";

export const SESSION_COOKIE = "td_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export async function startSession(username: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await set(`sess:${sha(token)}`, { u: username.toLowerCase(), at: Date.now() }, SESSION_TTL);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await del(`sess:${sha(token)}`);
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await get<{ u: string }>(`sess:${sha(token)}`);
  return s ? getUser(s.u) : null;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

// True when the caller is over the limit for this bucket.
export async function limited(bucket: string, max: number, windowSec: number): Promise<boolean> {
  return (await incr(`rl:${bucket}`, windowSec)) > max;
}

// ---- GitHub OAuth ----
// The base URLs are overridable only so tests can point at a mock server.
export const GH = {
  web: process.env.GITHUB_OAUTH_BASE || "https://github.com",
  api: process.env.GITHUB_API_BASE || "https://api.github.com",
  id: process.env.GITHUB_CLIENT_ID || "",
  secret: process.env.GITHUB_CLIENT_SECRET || "",
};
export const githubConfigured = () => Boolean(GH.id && GH.secret);
export const devLoginAllowed = () => process.env.NODE_ENV !== "production" && !githubConfigured();

export function appOrigin(req: Request): string {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "");
}
