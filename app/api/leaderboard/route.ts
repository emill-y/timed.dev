import { NextResponse } from "next/server";
import { zrank, ztop } from "@/lib/store";
import { getUser, today } from "@/lib/accounts";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BOARDS: Record<string, () => string> = {
  all: () => "lb:all",
  classic: () => "lb:classic",
  ai: () => "lb:ai",
  today: () => `lb:day:${today()}`,
};

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const board = BOARDS[q.get("board") ?? "all"] ? (q.get("board") ?? "all") : "all";
  const key = BOARDS[board]();
  const top = await ztop(key, 50);
  const rows = await Promise.all(
    top.map(async ({ member, score }, i) => {
      const u = await getUser(member);
      return {
        rank: i + 1,
        handle: member,
        points: Math.round(score),
        wins: u?.wins ?? 0,
        matches: u?.matches ?? 0,
        bestClassic: u?.best.classic ?? null,
        bestAi: u?.best.ai ?? null,
      };
    }),
  );
  const me = await currentUser();
  const myRank = me ? await zrank(key, me.username) : null;
  return NextResponse.json({ board, rows, me: me ? { username: me.username, rank: myRank == null ? null : myRank + 1 } : null });
}
