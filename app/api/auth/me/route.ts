import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { publicUser } from "@/lib/accounts";
import { zrank } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ user: null });
  const rank = await zrank("lb:all", u.username);
  return NextResponse.json({ user: publicUser(u, rank == null ? null : rank + 1) });
}
