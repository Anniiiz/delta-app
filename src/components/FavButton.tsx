"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Star } from "lucide-react";
import { cls } from "./ui";

export type FavKind = "product" | "category" | "subcategory";

/**
 * Star toggle for a product, category or subcategory. Optimistic: flips at once, saves, then refreshes the
 * server-rendered page; on failure it flips back and shows a short message without moving the layout.
 * `implied` names the parent it is followed through (outlined accent star).
 */
export function FavButton({ kind, id, on, implied, label, className }: { kind: FavKind; id: string; on: boolean; implied?: string; label: string; className?: string }) {
  const router = useRouter();
  const [local, setLocal] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  // Server props catch up after the refresh: drop the optimistic value.
  useEffect(() => setLocal(null), [on]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);

  const cur = local ?? on;
  const viaParent = !cur && !!implied;

  async function toggle() {
    if (busy) return;
    const next = !cur;
    setLocal(next);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/favourites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, key: id }) });
      const data = (await res.json().catch(() => ({}))) as { on?: boolean; error?: string };
      if (!res.ok || typeof data.on !== "boolean") throw new Error(data.error ?? "Could not save");
      setLocal(data.on);
      startTransition(() => router.refresh());
    } catch (e) {
      setLocal(!next);
      setError((e as Error).message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  // Styles live in globals.css (.fav) so a table of stars stays light.
  return (
    <span className={cls("fav", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={cur}
        aria-label={`${cur ? "Remove" : "Add"} ${label} ${cur ? "from" : "to"} favourites`}
        title={viaParent ? `Followed through ${implied}` : undefined}
        data-implied={viaParent || undefined}
      >
        <Star size={14} aria-hidden fill={cur ? "currentColor" : viaParent ? "rgb(113 112 255 / 0.18)" : "none"} />
      </button>
      {error && (
        <span role="status" className="absolute left-full top-1/2 z-10 ml-1 -translate-y-1/2 whitespace-nowrap rounded-md border border-berry/30 bg-raised px-2 py-0.5 text-[11px] text-berry shadow-lg">
          {error}
        </span>
      )}
    </span>
  );
}
