// Username + password accounts. Passwords are hashed with scrypt (per-user
// salt); sessions are random tokens in an httpOnly cookie, stored server-side
// only as a SHA-256 hash.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { del, get, incr, set } from "./store";
import { getUser, type User } from "./accounts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = "td_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,18}$/;
export const PASSWORD_MIN = 8;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const want = Buffer.from(keyB64, "base64");
  const got = await scrypt(pw, Buffer.from(saltB64, "base64"), want.length);
  return timingSafeEqual(got, want);
}

// A hash to compare against when the username doesn't exist, so a login for
// a missing user takes as long as one with a wrong password.
let dummyHash: Promise<string> | null = null;
export const dummy = () => (dummyHash ??= hashPassword("timed.dev-dummy-password"));

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
