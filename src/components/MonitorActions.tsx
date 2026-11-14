"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { History, Loader2, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { stamp } from "./ui";

async function call(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return { busy, msg, run };
}

export function CreateMonitorButton({ productId, storeId, disabled }: { productId: string; storeId: string; disabled?: boolean }) {
  const { busy, msg, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="btn-soft h-7 min-h-7 px-2 text-xs"
        disabled={disabled || !!busy}
        title={disabled ? "Set CONTEXT_DEV_API_KEY in .env.local first" : "Creates a Context.dev page monitor (about 1 credit per scheduled run)"}
        onClick={() => run("c", async () => (await call("/api/monitors", { method: "POST", body: JSON.stringify({ action: "create", productId, storeId }) }), "Monitor created"))}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create monitor
      </button>
      {msg && <span className={msg.ok ? "text-xs text-leaf" : "max-w-[260px] text-right text-xs text-berry"}>{msg.text}</span>}
    </div>
  );
}

export function MonitorRowActions({ id }: { id: string }) {
  const { busy, msg, run } = useAction();
  return (
    <div className="flex items-center gap-1">
      <button className="btn-soft h-7 min-h-7 px-2 text-xs" disabled={!!busy} onClick={() => run("r", async () => (await call("/api/monitors", { method: "POST", body: JSON.stringify({ action: "run", id }) }), "Run queued; results arrive via poll/webhook"))}>
        {busy === "r" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run now
      </button>
      <button className="btn-ghost h-7 min-h-7 px-2 text-xs" disabled={!!busy} aria-label="Delete monitor" onClick={() => confirm("Delete this Context.dev monitor?") && run("d", async () => (await call("/api/monitors", { method: "POST", body: JSON.stringify({ action: "delete", id }) }), "Deleted"))}>
        <Trash2 size={13} />
      </button>
      {msg && <span className={msg.ok ? "text-xs text-leaf" : "text-xs text-berry"}>{msg.text}</span>}
    </div>
  );
}

export function PollButton({ disabled }: { disabled?: boolean }) {
  const { busy, msg, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button className="btn-soft h-7 min-h-7 px-2 text-xs" disabled={disabled || !!busy} onClick={() => run("p", async () => `${(await call("/api/monitors", { method: "POST", body: JSON.stringify({ action: "poll" }) })).processed} new changes`)}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check for changes
      </button>
      {msg && <span className={msg.ok ? "text-xs text-leaf" : "text-xs text-berry"}>{msg.text}</span>}
    </span>
  );
}

export interface PairView {
  storeId: string;
  storeName: string;
  sourceUrl: string;
  before: { at: string; products: number };
  after: { at: string; products: number };
}

export function ReplayControls({ pairs, hasReplay }: { pairs: PairView[]; hasReplay: boolean }) {
  const { busy, msg, run } = useAction();
  return (
    <div className="space-y-3">
      {pairs.map((p) => (
        <div key={p.storeId + p.sourceUrl} className="rounded-md border border-violet/25 bg-violetbg/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <History size={14} className="text-violet" aria-hidden />
            <span className="text-[13px] text-ink">{p.storeName} · offer page</span>
            <span className="text-xs text-mute">
              {stamp(p.before.at)} → {stamp(p.after.at)} · {p.after.products} offers
            </span>
            <button
              className="btn-soft ml-auto h-7 min-h-7 px-2 text-xs"
              disabled={!!busy}
              onClick={() =>
                run(p.storeId, async () => {
                  const s = await call("/api/replay", { method: "POST", body: JSON.stringify({ storeId: p.storeId, sourceUrl: p.sourceUrl, beforeAt: p.before.at, afterAt: p.after.at }) });
                  return `${s.changes} changes · ${s.relevant} relevant · ${s.filteredOut} low priority`;
                })
              }
            >
              {busy === p.storeId ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Replay
            </button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        {hasReplay && (
          <button className="btn-ghost h-7 min-h-7 px-2 text-xs" disabled={!!busy} onClick={() => run("x", async () => (await call("/api/replay", { method: "DELETE", body: "{}" }), "Replay alerts removed"))}>
            <Trash2 size={13} /> Remove replay alerts
          </button>
        )}
        {msg && <span className={msg.ok ? "text-xs text-ink-2" : "text-xs text-berry"}>{msg.text}</span>}
      </div>
    </div>
  );
}

/** Opening the monitor page marks alerts as read (clears the sidebar badge on the next refresh). */
export function MarkReadOnView() {
  useEffect(() => {
    void fetch("/api/alerts", { method: "POST" });
  }, []);
  return null;
}
