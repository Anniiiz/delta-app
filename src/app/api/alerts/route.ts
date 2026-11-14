import { NextResponse } from "next/server";
import { markAlertsRead } from "@/lib/alerts";

export const runtime = "nodejs";

export async function POST() {
  markAlertsRead();
  return NextResponse.json({ ok: true });
}
