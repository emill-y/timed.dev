import { NextResponse } from "next/server";
import { appOrigin, devLoginAllowed, startSession } from "@/lib/auth";
import { upsertGithubUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

// Local development only (never in production, never once GitHub is
// configured): sign in as any login without GitHub.
export async function GET(req: Request) {
  if (!devLoginAllowed()) return NextResponse.json({ error: "not available" }, { status: 404 });
  const login = (new URL(req.url).searchParams.get("login") || "dev").replace(/[^\w-]/g, "").slice(0, 39) || "dev";
  let h = 0;
  for (const c of login.toLowerCase()) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  const u = await upsertGithubUser({ id: 9e9 + h, login, avatar_url: `https://github.com/identicons/${login}.png` });
  await startSession(u.username);
  return NextResponse.redirect(`${appOrigin(req)}/`);
}
