import { NextResponse } from "next/server";
import { step } from "@/lib/rlenv";
import { rlGate } from "@/lib/rlauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  const gate = await rlGate(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = await req.json().catch(() => ({}));
  if (typeof body.episode_id !== "string" || typeof body.code !== "string") {
    return NextResponse.json({ error: "body needs episode_id and code" }, { status: 400 });
  }
  try {
    return NextResponse.json(await step(body.episode_id, body.code));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
