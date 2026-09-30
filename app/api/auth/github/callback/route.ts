import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { appOrigin, clientIp, GH, githubConfigured, limited, startSession } from "@/lib/auth";
import { upsertGithubUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const fail = (req: Request, why: string) => NextResponse.redirect(`${appOrigin(req)}/?auth_error=${encodeURIComponent(why)}`);

// Step 2: GitHub sends the player back with ?code&state. Swap the code for a
// token server-side, read the profile, then drop the token (we only need
// the identity).
export async function GET(req: Request) {
  if (!githubConfigured()) return fail(req, "github sign-in is not configured");
  if (await limited(`oauth:${clientIp(req)}`, 30, 600)) return fail(req, "too many sign-in attempts");

  const q = new URL(req.url).searchParams;
  const code = q.get("code") ?? "";
  const state = q.get("state") ?? "";
  const jar = await cookies();
  const expected = jar.get("td_oauth")?.value ?? "";
  jar.delete("td_oauth");
  if (!code || !state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    return fail(req, "sign-in expired, try again");
  }

  try {
    const tokRes = await fetch(`${GH.web}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: GH.id, client_secret: GH.secret, code, redirect_uri: `${appOrigin(req)}/api/auth/github/callback` }),
      cache: "no-store",
    });
    const tok = (await tokRes.json()) as { access_token?: string; error?: string };
    if (!tok.access_token) return fail(req, tok.error || "github refused the sign-in");

    const userRes = await fetch(`${GH.api}/user`, {
      headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "timed.dev" },
      cache: "no-store",
    });
    if (!userRes.ok) return fail(req, "couldn't read your github profile");
    const gh = (await userRes.json()) as { id: number; login: string; avatar_url: string; name?: string | null };
    if (typeof gh.id !== "number" || !gh.login) return fail(req, "unexpected github profile");

    const u = await upsertGithubUser(gh);
    await startSession(u.username);
    return NextResponse.redirect(`${appOrigin(req)}/`);
  } catch {
    return fail(req, "github is unreachable right now");
  }
}
