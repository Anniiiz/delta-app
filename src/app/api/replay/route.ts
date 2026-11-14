import { NextResponse } from "next/server";
import { clearReplay, replay, replayablePairs } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replays two recorded captures of a retailer offer page through the alert pipeline. Clearly labelled; no web requests. */
export async function POST(req: Request) {
  const b = (await req.json()) as { storeId: string; sourceUrl: string; beforeAt: string; afterAt: string };
  const ok = replayablePairs().some((p) => p.storeId === b.storeId && p.sourceUrl === b.sourceUrl && p.before.at === b.beforeAt && p.after.at === b.afterAt);
  if (!ok) return NextResponse.json({ error: "Not a recorded capture pair" }, { status: 400 });
  return NextResponse.json(replay(b));
}

export async function DELETE() {
  clearReplay();
  return NextResponse.json({ ok: true });
}
