import { NextResponse } from "next/server";
import { postExists, toggleLike } from "@/lib/feed";
import { currentUser, limited } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "sign in to like" }, { status: 401 });
  if (await limited(`like:${me.username.toLowerCase()}`, 120, 60)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  if (!(await postExists(id))) return NextResponse.json({ error: "no such post" }, { status: 404 });
  return NextResponse.json({ liked: await toggleLike(id, me.username) });
}
