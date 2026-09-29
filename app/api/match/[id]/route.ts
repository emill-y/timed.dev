import { NextResponse } from "next/server";
import { get, set, withLock } from "@/lib/store";
import { resolve, liveMatch, viewFor, type Match } from "@/lib/game";
import { awardIfOver } from "@/lib/accounts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const me = new URL(req.url).searchParams.get("p") ?? "";
  let m = await get<Match>(`match:${id}`);
  if (!m) return NextResponse.json({ error: "no such match" }, { status: 404 });
  // First poll after the flag drops settles the points.
  if (!m.awards && resolve(liveMatch(m)).over) {
    m = await withLock(`match:${id}`, async () => {
      const fresh = (await get<Match>(`match:${id}`))!;
      if (await awardIfOver(fresh)) await set(`match:${id}`, fresh, 3600);
      return fresh;
    }).catch(() => m!);
  }
  return NextResponse.json(viewFor(m, me));
}

// Heartbeat from a player's browser: code (shared with teammates) and the
// copilot prompt count. Scores never come through here; see ./judge.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    return await withLock(`match:${id}`, async () => {
      const m = await get<Match>(`match:${id}`);
      if (!m) return NextResponse.json({ error: "no such match" }, { status: 404 });
      const now = Date.now();
      const p = m.players.find((x) => x.id === body.playerId && !x.bot);
      if (!p) return NextResponse.json({ error: "not in match" }, { status: 403 });

      const over = resolve(liveMatch(m, now), now).over;
      if (!over && now >= m.startAt) {
        p.prompts = Math.max(p.prompts ?? 0, Math.min(999, Number(body.prompts) || 0));
        if (typeof body.code === "string" && p.doneAt == null) p.code = body.code.slice(0, 20000);
      }
      p.lastSeen = now;
      await awardIfOver(m, now);
      await set(`match:${id}`, m, 3600);
      return NextResponse.json(viewFor(m, p.id));
    });
  } catch {
    return NextResponse.json({ error: "busy" }, { status: 503 });
  }
}
