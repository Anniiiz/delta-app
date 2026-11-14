"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BellRing, Boxes, ChevronRight, LayoutDashboard, MessageSquare, PackageSearch, Radar, Search, Star, Tags, TrendingUp, X } from "lucide-react";
import { Wordmark, cls, ago } from "./ui";

export interface ShellInfo {
  companies: { name: string; brands: string[]; products: number }[];
  unread: number;
  lastUpdate: string | null;
  replayAlerts: number;
  hasKey: boolean;
  liveMonitors: number;
  scopeLabel: string;
}

const NAV = [
  { href: "/", label: "Overview", short: "Overview", icon: LayoutDashboard },
  { href: "/account", label: "My Products", short: "Products", icon: PackageSearch },
  { href: "/prices", label: "Price Intelligence", short: "Prices", icon: TrendingUp },
  { href: "/promotions", label: "Promotion Tracker", short: "Promos", icon: Tags },
  { href: "/monitor", label: "Competitor Monitor", short: "Monitor", icon: Radar },
  { href: "/catalog", label: "Products & Stores", short: "Catalog", icon: Boxes },
] as const;

/** The signed-in customer account (see src/lib/context.ts). */
const ACCOUNT = "Fazer";

/** Sidebar and ⌘K only; on mobile /ask is reached from the header icon, so the tab bar keeps 6 tabs. */
const ASK_NAV = { href: "/ask", label: "Ask delta.", short: "Ask", icon: MessageSquare } as const;

/** Sidebar and ⌘K only, right after My Products; not in the mobile tab bar (reached from ⌘K there). */
const AREA_NAV = { href: "/area", label: "My area", short: "Area", icon: Star } as const;

const ALL_NAV = [...NAV.slice(0, 2), AREA_NAV, ...NAV.slice(2), ASK_NAV];

/** Pages that share the filter bar, the URL keys they use, and where FilterBar remembers the last query. */
const FILTERABLE = ["/", "/prices", "/promotions"];
const FILTER_KEYS = ["retailer", "banner", "segment", "company", "offer"];
const FILTER_STORE = "delta.filters";

export default function Shell(props: { info: ShellInfo; children: ReactNode }) {
  return (
    <Suspense>
      <ShellInner {...props} />
    </Suspense>
  );
}

function ShellInner({ info, children }: { info: ShellInfo; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  // Delta is signed in as one customer account; there is no company switcher.
  const company = ACCOUNT;
  const [cmd, setCmd] = useState(false);
  const [live, setLive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Page filters (Overview, Prices, Promotions) follow you between those pages, like synced slicers.
  // The last filter query is kept for this browser tab, so a detour via another page doesn't lose it.
  const sp = useSearchParams();
  const [savedFilters, setSavedFilters] = useState("");
  useEffect(() => {
    try {
      setSavedFilters(sessionStorage.getItem(FILTER_STORE) ?? "");
    } catch {
      /* storage unavailable */
    }
  }, [path, sp]);
  const withCompany = useCallback(
    (href: string) => {
      if (!FILTERABLE.includes(href)) return href;
      const fromUrl = new URLSearchParams();
      if (FILTERABLE.includes(path)) for (const k of FILTER_KEYS) if (sp.get(k)) fromUrl.set(k, sp.get(k)!);
      const q = FILTERABLE.includes(path) ? fromUrl.toString() : savedFilters;
      return q ? `${href}?${q}` : href;
    },
    [path, sp, savedFilters],
  );

  // ⌘K opens the command menu from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmd((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Live updates: the server pushes an event when a monitor adds an observation or an alert; the page re-renders.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("hello", () => setLive(true));
    const refresh = (msg?: string) => {
      if (msg) {
        setToast(msg);
        setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000);
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };
    es.addEventListener("alerts", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      refresh(`${d.data.n} new ${d.data.origin === "replay" ? "replayed " : ""}alert${d.data.n > 1 ? "s" : ""}`);
    });
    es.addEventListener("state", () => refresh());
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [router]);

  const current = ALL_NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href))) ?? NAV[0];

  return (
    <div className="min-h-screen pb-16 md:grid md:grid-cols-[236px_minmax(0,1fr)] md:pb-0 print:block print:pb-0">
      <aside className="hidden print:hidden md:sticky md:top-0 md:flex md:h-screen md:flex-col md:gap-0.5 md:px-2.5 md:py-3" aria-label="Sidebar">
        <Link href={withCompany("/")} className="mb-2 flex h-8 items-center rounded-md px-1.5 hover:bg-raised">
          <Wordmark />
        </Link>
        <button
          type="button"
          onClick={() => setCmd(true)}
          className="mb-3 flex h-8 items-center gap-2 rounded-md border border-line bg-white/[0.02] px-2 text-[13px] text-mute hover:bg-raised hover:text-ink-2"
        >
          <Search size={14} aria-hidden /> <span className="flex-1 text-left">Search or jump to…</span>
          <span className="kbd">⌘K</span>
        </button>
        <nav aria-label="Sections" className="flex flex-col gap-px">
          {ALL_NAV.map((n) => {
            const active = n === current;
            return (
              <Link
                key={n.href}
                href={withCompany(n.href)}
                aria-current={active ? "page" : undefined}
                className={cls("flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors", active ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised/60 hover:text-ink")}
              >
                <n.icon size={15} aria-hidden className={active ? "text-ink" : "text-mute"} />
                <span className="flex-1">{n.label}</span>
                {n.href === "/monitor" && info.unread > 0 && <span className="num rounded-full bg-tagbg px-1.5 text-[11px] text-tag">{info.unread}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="mt-5 px-2 text-xs font-medium text-faint">Account</div>
        <div className="mx-0.5 mt-1 rounded-md border border-line bg-white/[0.02] px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span aria-hidden className="grid h-6 w-6 place-items-center rounded-[5px] bg-tag text-[11px] font-semibold text-white">{ACCOUNT[0]}</span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ink">{ACCOUNT}</div>
              <div className="truncate text-[11px] text-faint">Customer account</div>
            </div>
          </div>

        </div>

        <div className="mt-auto space-y-1.5 px-2 pt-3 text-xs text-mute">
          <div className="flex items-center gap-2">
            <span className={cls("h-1.5 w-1.5 rounded-full", live ? "live-dot bg-leaf" : "bg-faint")} aria-hidden />
            {live ? "Live updates on" : "Connecting…"}
          </div>
          {/* Relative time is computed on the server and again in the browser; a minute boundary between the two is expected. */}
          <div suppressHydrationWarning>Data updated {ago(info.lastUpdate)}</div>
          <div className="text-faint">{info.hasKey ? `${info.liveMonitors} Context.dev monitor${info.liveMonitors === 1 ? "" : "s"}` : "Context.dev key not set"}</div>
        </div>
      </aside>

      <div className="min-w-0 md:py-2 md:pr-2 print:p-0">
        <div className="min-h-screen bg-card md:min-h-[calc(100vh-16px)] md:rounded-lg md:border md:border-line">
          <header className="sticky top-0 z-30 print:hidden flex h-11 items-center gap-2 border-b border-line bg-card/95 px-4 backdrop-blur md:rounded-t-lg">
            <Link href={withCompany("/")} className="mr-1 md:hidden">
              <Wordmark />
            </Link>
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex">
              <span className="font-medium text-ink">{current.label}</span>
              <ChevronRight size={14} className="text-faint" aria-hidden />
              <span className="truncate text-mute">{company}</span>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {info.replayAlerts > 0 && (
                <Link href={withCompany("/monitor")} className="chip border-violet/30 bg-violetbg text-violet">
                  Replay alerts shown · recorded data
                </Link>
              )}
              {/* The account view covers every category and store, so the demo-scope chip would be wrong there. */}
              {!["/account", "/area", "/ask"].some((x) => path.startsWith(x)) && <span className="chip hidden text-mute lg:inline-flex">{info.scopeLabel}</span>}
              <Link href={ASK_NAV.href} className={cls("btn-ghost h-7 min-h-7 px-2 md:hidden", current === ASK_NAV && "bg-raised text-ink")} aria-label={ASK_NAV.label} aria-current={current === ASK_NAV ? "page" : undefined}>
                <MessageSquare size={15} aria-hidden />
              </Link>
              <button className="btn-ghost h-7 min-h-7 px-2 md:hidden" onClick={() => setCmd(true)} aria-label="Search or jump to">
                <Search size={15} aria-hidden />
              </button>
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] px-4 pb-10 pt-5 sm:px-6">{children}</main>
        </div>
      </div>

      {/* Mobile tab bar */}
      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 print:hidden border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={withCompany(n.href)} className={cls("flex flex-col items-center gap-0.5 py-2 text-[10px]", n === current ? "text-ink" : "text-mute")}>
            <n.icon size={17} aria-hidden />
            {n.short}
          </Link>
        ))}
      </nav>

      {cmd && <CommandMenu onClose={() => setCmd(false)} go={(href) => { setCmd(false); router.push(href); }} />}

      {toast && (
        <div role="status" className="animate-slide-in fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[13px] text-ink shadow-2xl md:bottom-4">
          <BellRing size={14} className="text-tag" aria-hidden /> {toast}
        </div>
      )}
    </div>
  );
}

function CommandMenu({ onClose, go }: { onClose: () => void; go: (href: string) => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const items = useMemo(() => {
    const all = ALL_NAV.map((n) => ({ label: n.label, hint: "Page", href: n.href }));
    const t = q.trim().toLowerCase();
    return t ? all.filter((x) => (x.label + " " + x.hint).toLowerCase().includes(t)) : all;
  }, [q]);
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 pt-[12vh]" onClick={onClose}>
      <div role="dialog" aria-label="Command menu" className="animate-pop mx-auto w-[min(560px,92vw)] overflow-hidden rounded-xl border border-line bg-raised shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="text-mute" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") setI((x) => Math.min(items.length - 1, x + 1));
              if (e.key === "ArrowUp") setI((x) => Math.max(0, x - 1));
              if (e.key === "Enter" && items[i]) go(items[i].href);
            }}
            placeholder="Jump to a page…"
            className="h-11 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <button onClick={onClose} className="btn-ghost h-7 min-h-7 px-1.5" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.map((x, k) => (
            <li key={x.label}>
              <button onMouseEnter={() => setI(k)} onClick={() => go(x.href)} className={cls("flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px]", k === i ? "bg-raised-2 text-ink" : "text-ink-2")}>
                <span className="flex-1">{x.label}</span>
                <span className="truncate text-xs text-faint">{x.hint}</span>
              </button>
            </li>
          ))}
          {!items.length && <li className="px-3 py-4 text-center text-[13px] text-mute">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
