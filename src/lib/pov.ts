import { allStoreLatest, median, storeSpread, type Row, type SegmentPosition, type StoreObs } from "./analytics";

/**
 * The customer's point of view: the same deterministic data, cut for one company ("you").
 * Everything is computed over every Helsinki store with its own online prices, except where a function
 * says it uses the dashboard panel.
 */

export interface Coverage {
  banner: string;
  stores: number;
  carrying: number;
  share: number;
  /** Your products as a share of all sweets listed online, averaged over the banner's stores. */
  rangeShare: number;
  ownPerStore: number;
  allPerStore: number;
}

/** In how many stores of each banner at least one of your products was seen. */
export function shelfCoverage(company: string, filter?: (r: StoreObs) => boolean): { byBanner: Coverage[]; stores: number; carrying: number; products: number } {
  const rows = filter ? allStoreLatest().filter(filter) : allStoreLatest();
  const all = new Map<string, Set<string>>();
  const mine = new Map<string, Set<string>>();
  const ownProducts = new Set<string>();
  for (const r of rows) {
    (all.get(r.banner) ?? all.set(r.banner, new Set()).get(r.banner)!).add(r.storeId);
    if (r.company === company) {
      (mine.get(r.banner) ?? mine.set(r.banner, new Set()).get(r.banner)!).add(r.storeId);
      ownProducts.add(r.ean ?? r.productId);
    }
  }
  // Listings per store: yours and everyone's.
  const perStore = new Map<string, { banner: string; own: number; all: number }>();
  for (const r of rows) {
    const e = perStore.get(r.storeId) ?? { banner: r.banner, own: 0, all: 0 };
    e.all++;
    if (r.company === company) e.own++;
    perStore.set(r.storeId, e);
  }
  const byBanner = [...all.entries()]
    .map(([banner, s]) => {
      const ps = [...perStore.values()].filter((x) => x.banner === banner);
      const own = ps.reduce((n, x) => n + x.own, 0);
      const tot = ps.reduce((n, x) => n + x.all, 0);
      return { banner, stores: s.size, carrying: mine.get(banner)?.size ?? 0, share: (mine.get(banner)?.size ?? 0) / s.size, rangeShare: tot ? own / tot : 0, ownPerStore: own / ps.length, allPerStore: tot / ps.length };
    })
    .sort((a, b) => b.stores - a.stores);
  return {
    byBanner,
    stores: new Set(rows.map((r) => r.storeId)).size,
    carrying: new Set(rows.filter((r) => r.company === company).map((r) => r.storeId)).size,
    products: ownProducts.size,
  };
}

export interface ProductGap {
  ean: string;
  name: string;
  kesko: number;
  sGroup: number;
  gap: number;
  stores: number;
}

/** Your identical products (same EAN) in both K-Group and S Group stores: median shelf price per chain. */
export function ownChainGaps(company: string, limit = 10, filter?: (r: StoreObs) => boolean): ProductGap[] {
  const by = new Map<string, { name: string; k: number[]; s: number[] }>();
  for (const r of filter ? allStoreLatest().filter(filter) : allStoreLatest()) {
    if (r.company !== company || !r.ean || (r.retailer !== "Kesko" && r.retailer !== "S Group")) continue;
    const e = by.get(r.ean) ?? { name: r.name, k: [], s: [] };
    (r.retailer === "Kesko" ? e.k : e.s).push(r.price);
    if (r.retailer === "S Group") e.name = r.name;
    by.set(r.ean, e);
  }
  return [...by.entries()]
    .filter(([, e]) => e.k.length && e.s.length)
    .map(([ean, e]) => ({ ean, name: e.name, kesko: median(e.k)!, sGroup: median(e.s)!, gap: median(e.k)! / median(e.s)! - 1, stores: e.k.length + e.s.length }))
    .sort((a, b) => b.stores - a.stores)
    .slice(0, limit);
}

export interface Attention {
  tone: "warn" | "info" | "good";
  title: string;
  detail: string;
  href?: string;
}

/**
 * "Needs your attention": a short, ranked list built only from computed facts. Describes the market;
 * never suggests coordinating prices with competitors or setting retailers' shelf prices.
 */
export function attention(company: string, rows: Row[], pos: SegmentPosition[], filter?: (r: StoreObs) => boolean): Attention[] {
  const out: Attention[] = [];
  const ownSegments = new Set(rows.filter((r) => r.company === company && r.segment).map((r) => r.segment!));

  // Competitor offers in your groups that run the deepest stated discounts
  const against = rows
    .filter((r) => r.company !== company && r.promo?.active && r.segment && ownSegments.has(r.segment) && r.promo.discountPct != null)
    .sort((a, b) => b.promo!.discountPct! - a.promo!.discountPct!);
  if (against[0]) {
    const a = against[0];
    out.push({
      tone: "warn",
      title: `${a.brand ?? a.company} is running −${a.promo!.discountPct!.toFixed(0)}% in ${a.segment}`,
      detail: `${a.name} at ${a.storeName}: ${a.promo!.label}${a.promo!.validTo ? ` until ${Number(a.promo!.validTo.slice(8, 10))}.${Number(a.promo!.validTo.slice(5, 7))}.` : ""} · ${against.length - 1} more competitor offers with a stated discount in your groups`,
      href: "/promotions",
    });
  }

  // Groups where you are clearly above or below the competitor median
  for (const p of pos.filter((x) => x.gapPct != null && Math.abs(x.gapPct) >= 0.2).sort((a, b) => Math.abs(b.gapPct!) - Math.abs(a.gapPct!)).slice(0, 2))
    out.push({
      tone: "info",
      title: `${p.segment}: you are ${Math.abs(Math.round(p.gapPct! * 100))}% ${p.gapPct! > 0 ? "above" : "below"} competitors per kg`,
      detail: `Your median €${p.ownMedian!.toFixed(2)}/kg vs €${p.competitorMedian!.toFixed(2)}/kg (${p.ownObs} vs ${p.competitorObs} listings in the panel stores).`,
      href: "/prices",
    });

  // Your products priced differently in some stores of the same chain
  const own = storeSpread(undefined, 400, filter).filter((s) => s.company === company);
  if (own[0]) {
    const s = own[0];
    out.push({
      tone: "info",
      title: `${s.name} varies by store at ${s.retailer}`,
      detail: `€${s.modal.toFixed(2)} in most of ${s.stores} stores, €${s.min.toFixed(2)}–€${s.max.toFixed(2)} overall. ${own.length - 1} more of your products vary by store.`,
      href: "/prices",
    });
  }

  // Your offers about to end
  const ending = rows.filter((r) => r.company === company && r.promo?.active && r.promo.validTo && Date.parse(r.promo.validTo.length === 10 ? `${r.promo.validTo}T23:59:59+02:00` : r.promo.validTo) - Date.now() < 3 * 86400_000);
  if (ending.length)
    out.push({ tone: "info", title: `${ending.length} of your offers end within 3 days`, detail: [...new Set(ending.map((r) => r.name))].slice(0, 2).join(", ") + (ending.length > 2 ? "…" : ""), href: "/promotions" });

  return out.slice(0, 5);
}

/** Median gap across the groups where you have like-for-like competitors (each group counts once). */
export function overallPosition(pos: SegmentPosition[]): number | null {
  const gaps = pos.map((p) => p.gapPct).filter((x): x is number => x != null);
  return gaps.length ? median(gaps) : null;
}
