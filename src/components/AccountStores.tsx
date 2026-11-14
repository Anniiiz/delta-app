"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { AccountCell } from "@/lib/account";
import { Empty, Price, PromoChip, SourceLink, StoreBadge, cls, stamp } from "./ui";

type SortKey = "store" | "banner" | "city" | "price" | "checked";

/** Every store where one product is seen, with a marker on prices off the most common price. */
export function AccountStores({ cells, modePrice, banners }: { cells: AccountCell[]; modePrice: number; banners: string[] }) {
  const [banner, setBanner] = useState("");
  const [offOnly, setOffOnly] = useState(false);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "price", dir: -1 });

  const present = useMemo(() => banners.filter((b) => cells.some((c) => c.banner === b)), [banners, cells]);
  const off = (c: AccountCell) => Math.abs(c.price - modePrice) >= 0.005;
  const offCount = cells.filter(off).length;

  const sorted = useMemo(() => {
    const rows = cells.filter((c) => (!banner || c.banner === banner) && (!offOnly || Math.abs(c.price - modePrice) >= 0.005));
    const v = (c: AccountCell): string | number => {
      switch (sort.k) {
        case "store": return c.storeName;
        case "banner": return banners.indexOf(c.banner);
        case "city": return c.city ?? "";
        case "price": return c.price;
        case "checked": return c.capturedAt;
      }
    };
    return [...rows].sort((a, b) => {
      const x = v(a), y = v(b);
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return d * sort.dir || a.storeName.localeCompare(b.storeName);
    });
  }, [cells, banner, offOnly, modePrice, sort, banners]);

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={right ? "r" : undefined} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === "price" ? -1 : 1 }))}>
        {children}
        {sort.k === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <button className={cls("chip", !banner ? "bg-raised-2 text-ink" : "text-mute hover:text-ink")} onClick={() => setBanner("")} aria-pressed={!banner}>
          All banners <span className="num text-faint">{cells.length}</span>
        </button>
        {present.map((b) => (
          <button key={b} className={cls("chip", banner === b ? "bg-raised-2 text-ink" : "text-mute hover:text-ink")} onClick={() => setBanner(banner === b ? "" : b)} aria-pressed={banner === b}>
            <StoreBadge banner={b} /> {b} <span className="num text-faint">{cells.filter((c) => c.banner === b).length}</span>
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-mute">
          <input type="checkbox" checked={offOnly} onChange={(e) => setOffOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
          Off the most common price <span className="num text-faint">{offCount}</span>
        </label>
        {(banner || offOnly) && (
          <button className="btn-ghost h-7 min-h-7 px-2 text-xs" onClick={() => { setBanner(""); setOffOnly(false); }}>
            <X size={13} aria-hidden /> Clear
          </button>
        )}
      </div>
      {sorted.length ? (
        <div className="max-h-[560px] overflow-auto">
          <table className="dt">
            <thead>
              <tr>
                <Th k="store">Store</Th>
                <Th k="banner">Banner</Th>
                <Th k="city">City</Th>
                <Th k="price" right>Shelf price</Th>
                <th>Vs most common</th>
                <th>Promotion</th>
                <Th k="checked">Captured</Th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const d = c.price - modePrice;
                return (
                  <tr key={`${c.productId}|${c.storeId}`}>
                    <td className="max-w-[300px]">
                      <div className="truncate text-ink" title={c.storeName}>{c.storeName}</div>
                      {c.level === "chain" && <div className="text-[11px] text-faint">chain-wide offer feed</div>}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
                        <StoreBadge banner={c.banner} /> {c.banner}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-ink-2">{c.city ?? <span className="text-faint">—</span>}</td>
                    <td className="r"><Price value={c.price} className={!off(c) ? "text-ink" : d > 0 ? "text-berry" : "text-leaf"} /></td>
                    <td>
                      {!off(c) ? (
                        <span className="text-xs text-faint">at most common</span>
                      ) : d > 0 ? (
                        <span className="chip border-berry/30 bg-berrybg text-berry" title={`€${Math.abs(d).toFixed(2)} above the most common price, €${modePrice.toFixed(2)}`}>
                          above · +€{d.toFixed(2)}
                        </span>
                      ) : (
                        <span className="chip border-leaf/30 bg-mint text-leaf" title={`€${Math.abs(d).toFixed(2)} below the most common price, €${modePrice.toFixed(2)}`}>
                          below · −€{Math.abs(d).toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td>{c.promo ? <PromoChip type={c.promo.type} label={c.promo.label} /> : <span className="text-xs text-faint">—</span>}</td>
                    <td className="whitespace-nowrap text-xs text-mute">{stamp(c.capturedAt)}</td>
                    <td><SourceLink url={c.sourceUrl} label="source" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4">
          <Empty>No captured store matches these filters.</Empty>
        </div>
      )}
    </div>
  );
}
