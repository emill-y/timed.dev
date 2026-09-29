import { NextResponse } from "next/server";
import { zrank } from "@/lib/store";
import { claim, cleanHandle, getUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

// Claim-or-verify a handle, and return its public stats.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const handle = cleanHandle(body.handle);
  const c = await claim(handle, String(body.token ?? ""));
  if (c === "invalid") return NextResponse.json({ status: "invalid" }, { status: 400 });
  if (c === "taken") return NextResponse.json({ status: "taken" }, { status: 409 });
  const u = (await getUser(handle))!;
  const rank = await zrank("lb:all", u.handle);
  return NextResponse.json({
    status: "ok",
    handle: u.handle,
    points: u.points,
    byFormat: u.byFormat,
    wins: u.wins,
    losses: u.losses,
    draws: u.draws,
    matches: u.matches,
    best: u.best,
    rank: rank == null ? null : rank + 1,
  });
}
