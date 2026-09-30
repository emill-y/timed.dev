import { NextResponse } from "next/server";
import { claimKey, get, zcard, zlow } from "@/lib/store";
import { dropAt, dropN, DROP_CLOCK_MS } from "@/lib/drops";
import { getUser } from "@/lib/accounts";
import { currentUser } from "@/lib/auth";
import { post } from "@/lib/feed";

export const dynamic = "force-dynamic";

async function board(n: number, size: number) {
  const rows = await zlow(`drop:${n}:board`, size);
  return Promise.all(rows.map(async (r, i) => ({ rank: i + 1, login: r.member, ms: r.score, avatar: (await getUser(r.member))?.avatar ?? null })));
}

export async function GET() {
  const now = Date.now();
  const d = dropAt(now);
  // The first visitor of a window announces the new drop. No cron needed.
  if (await claimKey(`drop:${d.n}:opened`, 1, 60 * 60 * 24 * 7)) {
    await post({ kind: "drop_open", line: [{ t: "drop " }, { t: `#${d.n}`, b: true }, { t: " is live: " }, { t: d.problem.title, b: true }], detail: "30 minutes · one attempt each · glitch paste on · fastest clear wins", drop: d.n });
  }
  const me = await currentUser();
  const mine = me ? await get<{ matchId: string; playerId: string }>(`drop:${d.n}:entry:${me.username.toLowerCase()}`) : null;
  const prev = dropN(d.n - 1);
  return NextResponse.json({
    now,
    current: {
      n: d.n,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      title: d.problem.title,
      tier: d.problem.tier,
      family: d.problem.family,
      clockMs: DROP_CLOCK_MS,
      entrants: await zcard(`drop:${d.n}:board`),
      board: await board(d.n, 10),
      entered: Boolean(mine),
    },
    previous: { n: prev.n, title: prev.problem.title, board: await board(prev.n, 3) },
  });
}
