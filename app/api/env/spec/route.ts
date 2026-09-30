import { NextResponse } from "next/server";
import { spec } from "@/lib/rlenv";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(spec());
}
