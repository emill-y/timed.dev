import { NextResponse } from "next/server";
import { page } from "@/lib/feed";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const offset = Math.max(0, Number(new URL(req.url).searchParams.get("offset")) || 0);
  const me = await currentUser();
  const posts = await page(offset, 20, me?.username);
  return NextResponse.json({ posts, me: me ? { login: me.username, avatar: me.avatar } : null, next: posts.length === 20 ? offset + 20 : null });
}
