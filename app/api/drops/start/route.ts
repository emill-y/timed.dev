import { NextResponse } from "next/server";
import { claimKey, set } from "@/lib/store";
import { dropAt, DROP_CLOCK_MS } from "@/lib/drops";
import { createMatch, uid } from "@/lib/game";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// One attempt per drop per account. The attempt gets its own 10-minute clock
// and may start any time before the drop closes. Drops always run with glitch
// paste on: one damaged paste, then the clipboard locks.
export async function POST() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "sign in with GitHub to take the drop" }, { status: 401 });
  const d = dropAt();
  const playerId = uid() + uid();
  const match = createMatch(
    "classic",
    "1v1",
    "rapid",
    [{ id: playerId, name: me.username, userId: me.username.toLowerCase(), team: 0, passed: 0, attempts: 0, lastSeen: Date.now() }],
    ["glitch"],
    { problemId: d.problem.id, clockMs: DROP_CLOCK_MS, drop: d.n },
  );
  const entry = { matchId: match.id, playerId };
  if (!(await claimKey(`drop:${d.n}:entry:${me.username.toLowerCase()}`, entry, 60 * 60 * 24))) {
    return NextResponse.json({ error: `you've already taken drop #${d.n}. The next one opens in ${Math.ceil((d.endsAt - Date.now()) / 60000)} min.` }, { status: 409 });
  }
  await set(`match:${match.id}`, match, 3600);
  return NextResponse.json({ status: "matched", ...entry });
}
