import { NextResponse } from "next/server";
import { clientIp, hashPassword, limited, PASSWORD_MIN, startSession, USERNAME_RE } from "@/lib/auth";
import { createUser, publicUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!USERNAME_RE.test(username)) return NextResponse.json({ error: "username: 3-18 letters, numbers, _ . -" }, { status: 400 });
  if (password.length < PASSWORD_MIN || password.length > 200) return NextResponse.json({ error: `password: at least ${PASSWORD_MIN} characters` }, { status: 400 });
  if (await limited(`signup:${clientIp(req)}`, 5, 3600)) return NextResponse.json({ error: "too many signups from here, try later" }, { status: 429 });

  const u = await createUser(username, await hashPassword(password));
  if (!u) return NextResponse.json({ error: "that username is taken" }, { status: 409 });
  await startSession(u.username);
  return NextResponse.json({ user: publicUser(u, null) });
}
