import { NextResponse } from "next/server";
import { createMonitor, deleteMonitor, pollChanges, recommendedMonitors, runMonitorNow } from "@/lib/monitors";
import { hasContextKey } from "@/lib/contextdev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Monitor management. Every action here may spend Context.dev credits, so it only runs on an explicit click. */
export async function POST(req: Request) {
  if (!hasContextKey()) return NextResponse.json({ error: "CONTEXT_DEV_API_KEY is not set in .env.local" }, { status: 400 });
  const body = (await req.json()) as { action: string; productId?: string; storeId?: string; id?: string; minutes?: number };
  try {
    if (body.action === "create") {
      const rec = recommendedMonitors().find((r) => r.productId === body.productId && r.storeId === body.storeId);
      if (!rec) return NextResponse.json({ error: "Not a recommended monitor, or it already exists" }, { status: 400 });
      return NextResponse.json({ monitor: await createMonitor(rec, body.minutes ?? 360) });
    }
    if (body.action === "run" && body.id) return NextResponse.json({ run: await runMonitorNow(body.id) });
    if (body.action === "delete" && body.id) {
      await deleteMonitor(body.id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "poll") return NextResponse.json({ processed: await pollChanges() });
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
