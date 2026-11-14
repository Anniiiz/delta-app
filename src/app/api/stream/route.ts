import { bus } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-sent events: tells open dashboards to refresh when observations or alerts change. */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      const onMsg = (m: { kind: string }) => send(m.kind, m);
      bus.on("message", onMsg);
      const ping = setInterval(() => send("ping", { t: Date.now() }), 20000);
      send("hello", { t: Date.now() });
      cleanup = () => {
        clearInterval(ping);
        bus.off("message", onMsg);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
