import { NextResponse } from "next/server";
import { addComment, postExists } from "@/lib/feed";
import { currentUser, limited } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "sign in to comment" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 140);
  if (!text) return NextResponse.json({ error: "empty comment" }, { status: 400 });
  if (await limited(`comment:${me.username.toLowerCase()}`, 10, 60)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  if (!(await postExists(id))) return NextResponse.json({ error: "no such post" }, { status: 404 });
  return NextResponse.json({ comment: await addComment(id, { login: me.username, avatar: me.avatar }, text) });
}
