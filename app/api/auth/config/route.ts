import { NextResponse } from "next/server";
import { devLoginAllowed, githubConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ github: githubConfigured(), dev: devLoginAllowed() });
}
