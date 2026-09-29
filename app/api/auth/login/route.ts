import { NextResponse } from "next/server";
import { clientIp, dummy, limited, startSession, verifyPassword } from "@/lib/auth";
import { getUser, publicUser } from "@/lib/accounts";
import { zrank } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().slice(0, 40);
  const password = String(body.password ?? "").slice(0, 200);
  const ip = clientIp(req);
  if ((await limited(`login:${ip}`, 20, 900)) || (await limited(`login-user:${username.toLowerCase()}`, 10, 900))) {
    return NextResponse.json({ error: "too many attempts, wait a few minutes" }, { status: 429 });
  }
  const u = username ? await getUser(username) : null;
  const ok = await verifyPassword(password, u?.passHash ?? (await dummy()));
  if (!u || !ok) return NextResponse.json({ error: "wrong username or password" }, { status: 401 });
  await startSession(u.username);
  const rank = await zrank("lb:all", u.username);
  return NextResponse.json({ user: publicUser(u, rank == null ? null : rank + 1) });
}
