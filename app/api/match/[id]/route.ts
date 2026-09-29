import { NextResponse } from "next/server";
import { get, set, withLock } from "@/lib/store";
import { FAIL_PENALTY_MS, resolve, liveMatch, viewFor, type Match } from "@/lib/game";
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

// Progress report from a player's browser.
// { playerId, passed, attempts, failedSubmits, done, code }
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
        const passed = Math.max(0, Math.min(m.total, Number(body.passed) || 0));
        p.passed = Math.max(p.passed, passed);
        p.attempts = Math.max(p.attempts, Number(body.attempts) || 0);
        p.prompts = Math.max(p.prompts ?? 0, Number(body.prompts) || 0);
        if (body.done && passed === m.total && p.doneAt == null) {
          const failed = Math.max(0, Number(body.failedSubmits) || 0);
          p.doneAt = now - m.startAt + failed * FAIL_PENALTY_MS;
        }
      }
      if (typeof body.code === "string") p.code = body.code.slice(0, 20000);
      p.lastSeen = now;
      await awardIfOver(m, now);
      await set(`match:${id}`, m, 3600);
      return NextResponse.json(viewFor(m, p.id));
    });
  } catch {
    return NextResponse.json({ error: "busy" }, { status: 503 });
  }
}
