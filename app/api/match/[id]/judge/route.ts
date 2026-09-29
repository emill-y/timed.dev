import { NextResponse } from "next/server";
import { claimKey, del, get, set, withLock } from "@/lib/store";
import { FAIL_PENALTY_MS, liveMatch, resolve, type Match } from "@/lib/game";
import { getProblem } from "@/lib/problems";
import { judge } from "@/lib/judge";
import { awardIfOver } from "@/lib/accounts";
import { currentUser, limited } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

type Ctx = { params: Promise<{ id: string }> };

// RUN (visible tests) and SUBMIT (all tests) are judged here, server-side.
// Progress, finish times, wins and points all come from this route, never
// from what a browser claims.
export async function POST(req: Request, { params }: Ctx) {
  const at = Date.now(); // the clock stops when the submit arrives, not when judging ends
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const playerId = String(body.playerId ?? "");
  const code = String(body.code ?? "").slice(0, 20000);
  const submit = body.kind === "submit";

  const m = await get<Match>(`match:${id}`);
  if (!m) return NextResponse.json({ error: "no such match" }, { status: 404 });
  const p = m.players.find((x) => x.id === playerId && !x.bot);
  if (!p) return NextResponse.json({ error: "not in match" }, { status: 403 });
  if (p.userId) {
    const u = await currentUser();
    if (!u || u.username.toLowerCase() !== p.userId.toLowerCase()) return NextResponse.json({ error: "log in again to play this seat" }, { status: 401 });
  }
  if (at < m.startAt) return NextResponse.json({ error: "not started" }, { status: 409 });
  if (resolve(liveMatch(m, at), at).over || p.doneAt != null) return NextResponse.json({ error: "match over" }, { status: 409 });

  // One judge run in flight per seat, and a sane rate cap.
  const slot = `judging:${id}:${playerId}`;
  if (await limited(`judge:${playerId}`, 40, 60)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  if (!(await claimKey(slot, 1, 25))) return NextResponse.json({ error: "still judging your last run" }, { status: 429 });

  try {
    const problem = getProblem(m.problemId);
    const out = await judge(code, problem, submit);
    const passed = out.results.filter((r) => r.pass).length;
    const allGreen = submit && !out.fatal && passed === problem.tests.length;

    const state = await withLock(`match:${id}`, async () => {
      const fresh = (await get<Match>(`match:${id}`))!;
      const me = fresh.players.find((x) => x.id === playerId)!;
      if (!resolve(liveMatch(fresh, at), at).over && me.doneAt == null) {
        me.passed = Math.max(me.passed, passed);
        me.code = code;
        me.lastSeen = Date.now();
        if (submit) {
          me.attempts++;
          if (allGreen) me.doneAt = at - fresh.startAt + (me.failed ?? 0) * FAIL_PENALTY_MS;
          else me.failed = (me.failed ?? 0) + 1;
        }
      }
      await awardIfOver(fresh);
      await set(`match:${id}`, fresh, 3600);
      return { failed: me.failed ?? 0, attempts: me.attempts, done: me.doneAt != null };
    });

    return NextResponse.json({ ...out, kind: submit ? "submit" : "run", allGreen, ...state });
  } finally {
    await del(slot);
  }
}
