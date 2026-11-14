"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { ExplorerRow } from "@/lib/explorer";
type Row = ExplorerRow;
import { HBar, Legend, Strip } from "./Charts";
import { useFilterUrl } from "./FilterBar";
import { Empty, OwnDot, Price, PromoChip, SourceLink, StoreBadge, cls, stamp } from "./ui";

type SortKey = "name" | "brand" | "store" | "price" | "unit" | "checked";

const FLAG_SHORT: Record<string, string> = {
  size_range: "size range",
  size_missing: "no size",
  size_conflict: "size conflict",
  size_from_url: "size from URL",
  reference_price_missing: "no ref. price",
  reference_is_bundle_total: "ref. converted",
  stated_unit_price_without_unit: "unit unclear",
};

/**
 * The server sends only the listings of the selected product group(s); picking another group changes the
 * page's Product group filter (URL), so the explorer and every chart above it stay in sync.
 */
export function PriceExplorer({ rows, company, segments, segment }: { rows: Row[]; company: string; segments: string[]; segment: string }) {
  const pageFilter = useFilterUrl();
  const [brand, setBrand] = useState("");
  const [retailer, setRetailer] = useState("");
  const [store, setStore] = useState("");
  const [promo, setPromo] = useState<"" | "on" | "off">("");
  const [side, setSide] = useState<"" | "own" | "comp">("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "unit", dir: 1 });
  const [open, setOpen] = useState<Row | null>(null);
  const [shown, setShown] = useState(100);

  const opts = (f: (r: Row) => string | null) => [...new Set(rows.map(f).filter(Boolean) as string[])].sort();
  const filtered = useMemo(() => {
    const lo = min ? Number(min) : null;
    const hi = max ? Number(max) : null;
    return rows.filter(
      (r) =>
        (!brand || r.brand === brand) &&
        (!retailer || r.retailer === retailer) &&
        (!store || r.storeName === store) &&
        (!promo || (promo === "on" ? !!r.promo?.active : !r.promo?.active)) &&
        (!side || (side === "own" ? r.company === company : r.company !== company)) &&
        (lo == null || r.price >= lo) &&
        (hi == null || r.price <= hi),
    );
  }, [rows, brand, retailer, store, promo, side, min, max, company]);

  const sorted = useMemo(() => {
    const v = (r: Row): string | number => {
      switch (sort.k) {
        case "name": return r.name;
        case "brand": return r.brand ?? "";
        case "store": return r.storeName;
        case "price": return r.price;
        case "unit": return r.unitPrice ?? Number.POSITIVE_INFINITY;
        case "checked": return r.capturedAt;
      }
    };
    return [...filtered].sort((a, b) => {
      const x = v(a), y = v(b);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [filtered, sort]);

  const shortName = (n: string) => n.replace(/\s+(suklaalevy|suklaapatukka|suklaakonvehtirasia|konvehteja|konvehti)\b/i, "").replace(/\s+[\d,.-]+\s?g$/i, "");
  const priced = filtered.filter((r) => r.unitPrice != null);
  // One bar per product: median €/kg across the stores that list it (store detail in the tooltip).
  const byProduct = new Map<string, Row[]>();
  for (const r of priced) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  const allBars = [...byProduct.values()].map((rs) => {
    const xs = rs.map((r) => r.unitPrice!).sort((a, b) => a - b);
    const mid = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
    return { key: rs[0].productId, label: shortName(rs[0].name), sub: rs.length > 1 ? `${rs.length} stores · €${xs[0].toFixed(2)}–€${xs[xs.length - 1].toFixed(2)}/kg` : rs[0].storeName, value: mid, own: rs[0].company === company, n: rs.length };
  });
  // Keep charts readable: own products first, then the most widely listed competitor products.
  const chart = [...allBars].sort((a, b) => Number(b.own) - Number(a.own) || b.n - a.n).slice(0, 25);
  const coCount = new Map<string, number>();
  for (const r of priced) coCount.set(r.company ?? "Other", (coCount.get(r.company ?? "Other") ?? 0) + 1);
  const topCos = new Set([company, ...[...coCount.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 10)]);
  const strip = priced.filter((r) => topCos.has(r.company ?? "Other")).map((r) => ({ group: r.company ?? "Other", value: r.unitPrice!, own: r.company === company, label: shortName(r.name), sub: `${r.storeName} · €${r.price.toFixed(2)}` }));
  const reset = () => {
    setBrand(""); setRetailer(""); setStore(""); setPromo(""); setSide(""); setMin(""); setMax("");
  };
  const anyFilter = brand || retailer || store || promo || side || min || max;

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={right ? "r" : undefined} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {children}
        {sort.k === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Filters: one row above everything they control */}
      <div className="card flex flex-wrap items-end gap-2 p-3">
        <Sel label="Comparison group" value={segment} onChange={(v) => pageFilter.set("segment", v ? [v] : [])} options={segments} all={segment ? "Your default group" : "As filtered above"} />
        <Sel label="Brand" value={brand} onChange={setBrand} options={opts((r) => r.brand)} all="All brands" />
        <Sel label="Retailer" value={retailer} onChange={setRetailer} options={opts((r) => r.retailer)} all="All retailers" />
        <Sel label="Store" value={store} onChange={setStore} options={opts((r) => r.storeName)} all="All stores" />
        <Sel label="Promotion" value={promo} onChange={(v) => setPromo(v as "" | "on" | "off")} options={["on", "off"]} labels={{ on: "On promotion", off: "No promotion" }} all="Any" />
        <Sel label="Side" value={side} onChange={(v) => setSide(v as "" | "own" | "comp")} options={["own", "comp"]} labels={{ own: `Yours (${company})`, comp: "Competitors" }} all="Everyone" />
        <label className="flex flex-col gap-1">
          <span className="label">Shelf price €</span>
          <span className="flex items-center gap-1">
            <input className="input w-16" inputMode="decimal" placeholder="min" value={min} onChange={(e) => setMin(e.target.value)} />
            <span className="text-faint">–</span>
            <input className="input w-16" inputMode="decimal" placeholder="max" value={max} onChange={(e) => setMax(e.target.value)} />
          </span>
        </label>
        {anyFilter && (
          <button className="btn-ghost text-xs" onClick={reset}>
            <X size={13} /> Clear
          </button>
        )}
        <span className="ml-auto self-center text-xs text-mute">{filtered.length} listings</span>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="card min-w-0">
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <h2 className="flex-1 text-[13px] font-semibold text-ink">
              €/kg by product{segment ? ` · ${segment}` : ""}
              {allBars.length > chart.length && <span className="ml-2 text-xs font-normal text-faint">top {chart.length} of {allBars.length}</span>}
            </h2>
            <Legend ownLabel={company} />
          </header>
          <div className="p-4">{chart.length ? <HBar data={chart} labelWidth={180} /> : <Empty>No comparable unit prices.</Empty>}</div>
        </section>
        <section className="card min-w-0">
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <h2 className="flex-1 text-[13px] font-semibold text-ink">€/kg spread: you vs competitors</h2>
            <span className="text-xs text-mute">one dot per listing</span>
          </header>
          <div className="p-4">{strip.length ? <Strip data={strip} /> : <Empty>No comparable unit prices.</Empty>}</div>
        </section>
      </div>

      <section className="card min-w-0">
        <div className="max-h-[640px] overflow-auto">
          <table className="dt">
            <thead>
              <tr>
                <Th k="name">Product</Th>
                <Th k="store">Store</Th>
                <th>Pack</th>
                <Th k="price" right>Shelf price</Th>
                <Th k="unit" right>Per kg</Th>
                <th>Promotion</th>
                <Th k="checked">Last checked</Th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, shown).map((r) => (
                <tr key={`${r.productId}|${r.storeId}`} className="cursor-pointer" onClick={() => setOpen(r)}>
                  <td className="max-w-[340px]">
                    <div className="flex items-center gap-2">
                      <OwnDot own={r.company === company} />
                      <div className="min-w-0">
                        <div className="truncate text-ink" title={r.name}>{r.name}</div>
                        <div className="text-xs text-mute">{r.brand} · {r.segment}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
                      <StoreBadge banner={r.banner} /> {r.storeName}
                    </span>
                    {r.level === "chain" && <div className="pl-6 text-[11px] text-faint">chain-wide offer</div>}
                  </td>
                  <td className="whitespace-nowrap text-ink-2">
                    {r.sizeIsRange ? <span title="Pack size varies">{r.sizeRaw}</span> : r.sizeValue ? `${Math.round(r.sizeValue * 1000)} g` : "—"}
                  </td>
                  <td className="r"><Price value={r.price} /></td>
                  <td className="r">
                    {r.unitPrice != null ? <Price value={r.unitPrice} className="text-ink-2" /> : <span className="text-xs text-faint">n/a</span>}
                    {r.flags.filter((f) => FLAG_SHORT[f] && f.startsWith("size")).map((f) => (
                      <div key={f} className="text-[11px] text-faint">{FLAG_SHORT[f]}</div>
                    ))}
                  </td>
                  <td>{r.promo ? <PromoChip type={r.promo.type} label={r.promo.label} /> : <span className="text-xs text-faint">—</span>}</td>
                  <td className="whitespace-nowrap text-xs text-mute">{stamp(r.capturedAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}><SourceLink url={r.sourceUrl} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sorted.length > shown && (
          <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-xs text-mute">
            Showing {shown} of {sorted.length} listings
            <button className="btn-soft h-7 min-h-7 px-2 text-xs" onClick={() => setShown((n) => n + 100)}>
              Show 100 more
            </button>
          </div>
        )}
      </section>

      {open && <Drawer row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Sel({ label, value, onChange, options, all, labels }: { label: string; value: string; onChange: (v: string) => void; options: string[]; all: string; labels?: Record<string, string> }) {
  return (
    <label className="flex min-w-[120px] flex-col gap-1">
      <span className="label">{label}</span>
      <select className="input h-8 py-0" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>{labels?.[o] ?? o}</option>
        ))}
      </select>
    </label>
  );
}

interface Hist { id: number; store_name: string; price: number; unit_price: number | null; promo_label: string | null; captured_at: string; source_url: string; origin: string; request_id: string | null }

function Drawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const [h, setH] = useState<Hist[] | null>(null);
  useEffect(() => {
    fetch(`/api/products/${encodeURIComponent(row.productId)}`).then((r) => r.json()).then((j) => setH(j.history));
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [row.productId, onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <aside role="dialog" aria-label={row.name} className="animate-slide-in absolute inset-y-0 right-0 w-[min(520px,100vw)] overflow-y-auto border-l border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          {row.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.imageUrl} alt="" className="h-14 w-14 rounded-md bg-white object-contain p-1" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] text-ink">{row.name}</h2>
            <p className="text-xs text-mute">{row.brand} · {row.company} · {row.segment}</p>
          </div>
          <button className="btn-ghost h-7 min-h-7 px-1.5" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <dt className="text-mute">EAN</dt><dd className="num text-ink-2">{row.ean ?? "not stated"}</dd>
          <dt className="text-mute">Pack size</dt><dd className="text-ink-2">{row.sizeRaw ?? "—"}</dd>
          <dt className="text-mute">Regular price</dt><dd className="text-ink-2"><Price value={row.regularPrice} /></dd>
          <dt className="text-mute">Lowest 30-day price</dt><dd className="text-ink-2"><Price value={row.lowest30d} /></dd>
          <dt className="text-mute">Product page</dt><dd><SourceLink url={row.productUrl} /></dd>
        </dl>
        {row.flags.length > 0 && (
          <div className="mt-4 rounded-md border border-line bg-white/[0.02] p-3 text-xs text-mute">
            <div className="mb-1 font-medium text-ink-2">Data quality notes</div>
            {row.flags.map((f) => <div key={f}>· {FLAG_SHORT[f] ?? f}</div>)}
          </div>
        )}
        <h3 className="mt-5 text-[13px] text-ink">Every observation (provenance)</h3>
        <p className="text-xs text-mute">One row per Context.dev capture of a retailer page, across all imported stores.</p>
        <ul className="mt-2 divide-y divide-line-2 text-[13px]">
          {(h ?? []).slice().reverse().slice(0, 60).map((o) => (
            <li key={o.id} className={cls("flex items-center gap-3 py-2", o.store_name === row.storeName && "text-ink")}>
              <span className="w-24 shrink-0 text-xs text-mute">{stamp(o.captured_at)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{o.store_name}</span>
              <Price value={o.price} />
              <SourceLink url={o.source_url} label="src" />
            </li>
          ))}
          {!h && <li className="py-3 text-xs text-mute">Loading…</li>}
        </ul>
      </aside>
    </div>
  );
}
