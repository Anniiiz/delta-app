import type { Row, StoreObs } from "./analytics";

/**
 * Page-level filters (Power BI-style slicers). They live in the URL (?banner=Prisma,Alepa&segment=…),
 * so every visual on a page is computed server-side from the same filtered data, links can be shared,
 * and clicking a bar in a chart simply adds a value to the URL.
 *
 * The competitor filter never removes the account's own products: "company=Mondelēz" means
 * "compare me against Mondelēz".
 */
export type FilterDim = "retailer" | "banner" | "segment" | "company" | "offer";
export const FILTER_DIMS: FilterDim[] = ["retailer", "banner", "segment", "company", "offer"];

export interface PageFilters {
  retailer: string[];
  banner: string[];
  segment: string[];
  company: string[];
  offer: string[]; // "on" | "off"
}

export const RETAILER_LABEL: Record<string, string> = { Kesko: "K-Group", "S Group": "S Group", Wolt: "Wolt" };

export function parseFilters(sp: Record<string, string | string[] | undefined>): PageFilters {
  const get = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v.join(",") : (v ?? "");
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
  };
  return { retailer: get("retailer"), banner: get("banner"), segment: get("segment"), company: get("company"), offer: get("offer") };
}

/** The same filters minus one dimension: a chart that sets a filter keeps showing all its bars (cross-highlight). */
export const without = (f: PageFilters, dim: FilterDim): PageFilters => ({ ...f, [dim]: [] });

export const filtersActive = (f: PageFilters) => FILTER_DIMS.some((d) => f[d].length > 0);

function keep(f: PageFilters, own: string, x: { retailer: string; banner: string; segment: string | null; company: string | null; onOffer: boolean }) {
  if (f.retailer.length && !f.retailer.includes(x.retailer)) return false;
  if (f.banner.length && !f.banner.includes(x.banner)) return false;
  if (f.segment.length && !(x.segment && f.segment.includes(x.segment))) return false;
  if (f.company.length && x.company !== own && !(x.company && f.company.includes(x.company))) return false;
  if (f.offer.length === 1 && (f.offer[0] === "on") !== x.onOffer) return false;
  return true;
}

/** Panel rows (latest observation per product × store) that pass the filters. */
export function filterRows(rows: Row[], f: PageFilters, own: string): Row[] {
  if (!filtersActive(f)) return rows;
  return rows.filter((r) => keep(f, own, { retailer: r.retailer, banner: r.banner, segment: r.segment, company: r.company, onOffer: !!r.promo?.active }));
}

/** Predicate for the all-store views (store index, chain gaps, store outliers, coverage). */
export function storeFilter(f: PageFilters, own: string): ((r: StoreObs) => boolean) | undefined {
  if (!filtersActive(f)) return undefined;
  return (r) => keep(f, own, { retailer: r.retailer, banner: r.banner, segment: r.segment, company: r.company, onOffer: !!r.promoLabel });
}

export interface FilterOptions {
  retailer: string[];
  banner: string[];
  segment: string[];
  company: string[];
}

/** Values to offer in the filter bar, from the unfiltered rows (so options never disappear). */
export function filterOptions(rows: Row[], own: string, topCompanies = 25): FilterOptions {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const coCount = new Map<string, number>();
  for (const r of rows) if (r.company && r.company !== own) coCount.set(r.company, (coCount.get(r.company) ?? 0) + 1);
  return {
    retailer: uniq(rows.map((r) => r.retailer)),
    banner: uniq(rows.map((r) => r.banner)),
    segment: uniq(rows.map((r) => r.segment)),
    company: [...coCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, topCompanies).map(([c]) => c),
  };
}
