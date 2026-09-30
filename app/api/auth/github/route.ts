import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { appOrigin, GH, githubConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Step 1: send the player to GitHub with a one-time state value.
export async function GET(req: Request) {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "GitHub sign-in isn't configured on this deployment (set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)." }, { status: 503 });
  }
  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set("td_oauth", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL(`${GH.web}/login/oauth/authorize`);
  url.searchParams.set("client_id", GH.id);
  url.searchParams.set("redirect_uri", `${appOrigin(req)}/api/auth/github/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("allow_signup", "true");
  return NextResponse.redirect(url);
}
