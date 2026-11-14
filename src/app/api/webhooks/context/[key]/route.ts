import { NextRequest } from "next/server";
import { monitorByRoute, persistEventOnce, processEvent, verifySignature } from "@/lib/monitors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Context.dev monitor webhook receiver.
 * 1. Look up the monitor by its unguessable route key (lookup only, not authentication)
 * 2. Verify the HMAC signature over the RAW body before parsing
 * 3. Validate the envelope against the X-Context-Id / X-Context-Event headers
 * 4. Persist once (dedupe on event id), acknowledge fast, process asynchronously
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const mon = monitorByRoute(key);
  if (!mon) return new Response("Unknown webhook route", { status: 404 });
  if (!mon.webhook_secret) return new Response("Secret not stored yet", { status: 503 });

  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifySignature(raw, req.headers.get("x-context-signature") ?? "", mon.webhook_secret)) return new Response("Invalid webhook signature", { status: 401 });

  let ev: { id?: unknown; event?: unknown; data?: { run?: { monitor_id?: string }; change?: { monitor_id?: string } } };
  try {
    ev = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (typeof ev.id !== "string" || ev.id !== req.headers.get("x-context-id") || typeof ev.event !== "string" || ev.event !== req.headers.get("x-context-event"))
    return new Response("Invalid event envelope", { status: 400 });
  const payloadMonitor = ev.data?.change?.monitor_id ?? ev.data?.run?.monitor_id;
  if (payloadMonitor && payloadMonitor !== mon.id) return new Response("Event does not belong to this monitor", { status: 400 });

  let fresh: boolean;
  try {
    fresh = persistEventOnce({ id: ev.id, event: ev.event }, mon.id, raw.toString("utf8"));
  } catch {
    return new Response("Could not persist event", { status: 503 });
  }
  if (fresh) setTimeout(() => void processEvent(ev.id as string), 0);
  return new Response(null, { status: 204 });
}
