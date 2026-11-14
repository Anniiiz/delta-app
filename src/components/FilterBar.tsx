"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Filter, Loader2, X } from "lucide-react";
import type { FilterDim, FilterOptions } from "@/lib/filters";
import { cls } from "./ui";

/**
 * Power BI-style slicer bar. Filters live in the URL; every visual on the page reads the same filters,
 * and clicking a bar in a chart (see useCrossFilter) adds to them.
 */
const DIMS: { dim: FilterDim; label: string }[] = [
  { dim: "retailer", label: "Chain" },
  { dim: "banner", label: "Store type" },
  { dim: "segment", label: "Product group" },
  { dim: "company", label: "Competitor" },
  { dim: "offer", label: "Offer" },
];

const VALUE_LABEL: Record<string, string> = { Kesko: "K-Group", on: "On offer", off: "No offer" };
const show = (v: string) => VALUE_LABEL[v] ?? v;

export function useFilterUrl() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const values = (dim: FilterDim) => (sp.get(dim) ?? "").split(",").filter(Boolean);
  const go = (href: string) => {
    // Instant feedback: the page dims until the filtered version arrives (cleared by FilterBar on URL change).
    document.body.dataset.filtering = "1";
    setTimeout(() => delete document.body.dataset.filtering, 8000); // never leave the page dimmed
    start(() => router.push(href, { scroll: false }));
  };
  const set = (dim: FilterDim, vals: string[]) => {
    const q = new URLSearchParams(sp.toString());
    if (vals.length) q.set(dim, vals.join(","));
    else q.delete(dim);
    const s = q.toString();
    go(s ? `${path}?${s}` : path);
  };
  const toggle = (dim: FilterDim, v: string) => {
    const cur = values(dim);
    set(dim, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  };
  const clear = () => go(path);
  return { values, set, toggle, clear, pending };
}

export function FilterBar({ options }: { options: FilterOptions }) {
  const f = useFilterUrl();
  const search = useSearchParams().toString();
  useEffect(() => {
    delete document.body.dataset.filtering;
    // Remember the filters for this tab so the sidebar can carry them to the other filterable pages.
    try {
      const q = new URLSearchParams(search);
      for (const k of [...q.keys()]) if (!["retailer", "banner", "segment", "company", "offer"].includes(k)) q.delete(k);
      sessionStorage.setItem("delta.filters", q.toString());
    } catch {
      /* storage unavailable */
    }
  }, [search]);
  const [open, setOpen] = useState<FilterDim | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const opts: Record<FilterDim, string[]> = { ...options, offer: ["on", "off"] };
  const active = DIMS.flatMap(({ dim, label }) => f.values(dim).map((v) => ({ dim, label, v })));

  return (
    <>
    <div role="status" className="filter-loader pointer-events-none fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-2xl">
        <span className="delta-loader" aria-hidden>
          <svg viewBox="0 0 32 32" width="22" height="22">
            <path d="M16 4 L29 27 H3 Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <div className="text-[13px] text-ink">Updating view…</div>
          <div className="loader-bar mt-1 h-1 w-28 overflow-hidden rounded-full bg-raised-2" />
        </div>
      </div>
    <div ref={ref} className="sticky top-11 z-20 -mx-4 border-b border-line bg-card/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-mute">
          <Loader2 size={13} className="filter-spinner animate-spin" aria-hidden />
          <Filter size={13} className="filter-icon" aria-hidden /> Filters
        </span>
        {DIMS.map(({ dim, label }) => {
          const sel = f.values(dim);
          return (
            <div key={dim} className="relative">
              <button
                type="button"
                onClick={() => setOpen(open === dim ? null : dim)}
                aria-expanded={open === dim}
                className={cls(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors",
                  sel.length ? "border-tag/40 bg-tagbg text-ink" : "border-line text-ink-2 hover:bg-raised",
                )}
              >
                {label}
                {sel.length > 0 && <span className="num rounded bg-tag px-1 text-[10px] text-white">{sel.length}</span>}
                <ChevronDown size={12} className="text-mute" aria-hidden />
              </button>
              {open === dim && (
                <div role="listbox" aria-multiselectable className="animate-pop absolute left-0 top-8 z-30 max-h-72 w-60 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-2xl">
                  {opts[dim].map((v) => {
                    const on = sel.includes(v);
                    return (
                      <button
                        key={v}
                        role="option"
                        aria-selected={on}
                        onClick={() => (dim === "offer" ? f.set(dim, on ? [] : [v]) : f.toggle(dim, v))}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-raised-2 hover:text-ink"
                      >
                        <span className={cls("grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border", on ? "border-tag bg-tag text-white" : "border-line")}>
                          {on && <Check size={11} aria-hidden />}
                        </span>
                        <span className="truncate">{show(v)}</span>
                      </button>
                    );
                  })}
                  {sel.length > 0 && (
                    <button onClick={() => f.set(dim, [])} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-mute hover:bg-raised-2 hover:text-ink">
                      Clear {label.toLowerCase()}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {active.length > 0 && <span className="mx-1 h-4 w-px bg-line" aria-hidden />}
        {active.map(({ dim, label, v }) => (
          <button
            key={dim + v}
            onClick={() => f.toggle(dim, v)}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-tagbg px-1.5 text-xs text-ink hover:bg-tag/25"
            title={`Remove ${label}: ${show(v)}`}
          >
            <span className="text-mute">{label}:</span> {show(v)} <X size={11} aria-hidden />
          </button>
        ))}
        {active.length > 0 && (
          <button onClick={f.clear} className="ml-auto text-xs text-mute hover:text-ink">
            Clear all
          </button>
        )}
      </div>
    </div>
    </>
  );
}
