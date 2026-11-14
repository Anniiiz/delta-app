import { db } from "./db";
import { latestRows, type Row } from "./analytics";
import { validUntil } from "./normalize";
import { ensureData } from "./importer";

/**
 * Account view: one company's products across every product category and every store scope in the
 * database (not the confectionery demo scope). Built on `latestRows` (latest observation per product ×
 * store, promotions as stored by the importer via `promotionOf`), so the honesty rules hold unchanged:
 * promotions only where the retailer advertised them, discount % only with a stated reference price.
 */

export interface AccountPromoInfo {
  type: string; // campaign | multibuy | loyalty
  label: string | null;
  offerPrice: number; // per pack
  referencePrice: number | null;
  referenceKind: string | null; // regular | lowest_30d
  discountPct: number | null; // only when a reference price was stated
  validTo: string | null;
  active: boolean;
}

export interface AccountCell {
  key: string;
  productId: string;
  storeId: string;
  storeName: string;
  banner: string;
  retailer: string;
  level: "store" | "chain";
  city: string | null;
  lat: number | null;
  lon: number | null;
  price: number;
  promo: AccountPromoInfo | null;
  sourceUrl: string;
  capturedAt: string;
}

export interface AccountBannerStat {
  banner: string;
  retailer: string;
  /** Store scopes of this banner where the product has a latest observation. */
  stores: number;
  /** Store scopes of this banner in the dataset, at the level(s) the product was seen at (chain feed → chain scopes). */
  capturedStores: number;
  minPrice: number;
  maxPrice: number;
  /** Most common shelf price; ties → lower. */
  modePrice: number;
  promoStores: number;
  chainOnly: boolean;
}

export interface AccountProduct {
  key: string;
  name: string;
  ean: string | null;
  productIds: string[];
  brand: string | null;
  segment: string | null;
  imageUrl: string | null;
  storesSeen: number;
  banners: AccountBannerStat[];
  minPrice: number;
  maxPrice: number;
  modePrice: number;
  /** (max/min − 1) × 100 over store-level shelf prices; null with fewer than 2 store-level scopes. */
  spreadPct: number | null;
  promoStores: number;
  firstSeen: string;
  lastSeen: string;
}

export interface AccountPromo {
  key: string;
  name: string;
  brand: string | null;
  company: string | null;
  own: boolean;
  segment: string | null;
  banner: string;
  retailer: string;
  level: "store" | "chain";
  type: string;
  label: string | null;
  offerPrice: number;
  referencePrice: number | null;
  referenceKind: string | null;
  discountPct: number | null;
  validTo: string | null;
  active: boolean;
  stores: number;
  sourceUrl: string;
}

export interface AccountSummary {
  company: string;
  products: number;
  storesSeen: number;
  storeScopesTotal: number;
  banners: number;
  livePromos: number;
  promoStoreListings: number;
  endingSoon: number;
  widestSpread: { key: string; name: string; min: number; max: number; pct: number; stores: number } | null;
}

const ENDING_SOON_MS = 3 * 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------ shared loading

interface StoreInfo {
  id: string;
  banner: string;
  retailer: string;
  level: "store" | "chain";
  city: string | null;
  lat: number | null;
  lon: number | null;
}

interface Loaded {
  rows: Row[];
  stores: Map<string, StoreInfo>;
  seen: Map<string, { first: string; last: string }>;
}

let cache: { sig: string; data: Loaded } | null = null;

/** Latest rows for every category × every store scope, memoised until observations change. */
function load(): Loaded {
  ensureData();
  const d = db();
  const sigRow = d.prepare("SELECT COUNT(*) AS n, MAX(id) AS m, (SELECT COUNT(*) FROM stores) AS s, (SELECT COUNT(*) FROM products) AS p FROM observations").get() as Record<string, number | null>;
  const sig = `${sigRow.n}:${sigRow.m}:${sigRow.s}:${sigRow.p}`;
  if (cache && cache.sig === sig) return cache.data;

  const storeRows = d.prepare("SELECT id, banner, retailer, level, city, lat, lon FROM stores ORDER BY id").all() as unknown as StoreInfo[];
  const allStores = storeRows.map((s) => s.id);
  const stores = new Map(storeRows.map((s) => [s.id, s]));
  const categories = (d.prepare("SELECT DISTINCT category FROM products ORDER BY category").all() as { category: string }[]).map((c) => c.category);
  const rows = allStores.length ? categories.flatMap((category) => latestRows({ category, storeIds: allStores })) : [];
  const seen = new Map(
    (
      d.prepare("SELECT product_id, MIN(captured_at) AS first, MAX(captured_at) AS last FROM observations GROUP BY product_id").all() as {
        product_id: string;
        first: string;
        last: string;
      }[]
    ).map((r) => [r.product_id, { first: r.first, last: r.last }]),
  );
  const data = { rows, stores, seen };
  cache = { sig, data };
  return data;
}

const keyOf = (r: Row) => r.ean ?? r.productId;
const isActive = (validTo: string | null, now: number) => {
  const t = validUntil(validTo);
  return t == null || t >= now;
};

function toCell(r: Row, s: StoreInfo | undefined, now: number): AccountCell {
  return {
    key: keyOf(r),
    productId: r.productId,
    storeId: r.storeId,
    storeName: r.storeName,
    banner: r.banner,
    retailer: r.retailer,
    level: r.level,
    city: s?.city ?? null,
    lat: s?.lat ?? null,
    lon: s?.lon ?? null,
    price: r.price,
    promo: r.promo
      ? {
          type: r.promo.type,
          label: r.promo.label,
          offerPrice: r.promo.offerPrice,
          referencePrice: r.promo.referencePrice,
          referenceKind: r.promo.referenceKind,
          discountPct: r.promo.referencePrice != null ? r.promo.discountPct : null,
          validTo: r.promo.validTo,
          active: isActive(r.promo.validTo, now),
        }
      : null,
    sourceUrl: r.sourceUrl,
    capturedAt: r.capturedAt,
  };
}

/** One row per product key × store: if two listings of the same EAN exist in one store, keep the latest. */
function dedupe(rows: Row[]): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = `${keyOf(r)}|${r.storeId}`;
    const prev = m.get(k);
    if (!prev || r.capturedAt > prev.capturedAt || (r.capturedAt === prev.capturedAt && r.obsId > prev.obsId)) m.set(k, r);
  }
  return [...m.values()];
}

function companyRows(company: string): Row[] {
  return dedupe(load().rows.filter((r) => r.company === company));
}

/** Most common value; ties → lower. */
export function modeOf(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** (max/min − 1) × 100 over store-level prices; null with fewer than 2 store-level scopes. */
export function spreadOf(cells: { level: string; price: number }[]): { min: number; max: number; pct: number; stores: number } | null {
  const prices = cells.filter((c) => c.level === "store").map((c) => c.price);
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { min, max, pct: min > 0 ? round1((max / min - 1) * 100) : 0, stores: prices.length };
}

// ------------------------------------------------------------------ public API

/** Store scopes per banner × level across the whole dataset. */
export function bannerTotals(): { banner: string; retailer: string; level: "store" | "chain"; stores: number }[] {
  load();
  const rows = db()
    .prepare("SELECT banner, retailer, level, COUNT(*) AS stores FROM stores GROUP BY banner, retailer, level ORDER BY retailer, banner, level")
    .all() as { banner: string; retailer: string; level: "store" | "chain"; stores: number }[];
  return rows.map((r) => ({ banner: r.banner, retailer: r.retailer, level: r.level, stores: r.stores }));
}

/** Latest observation per product key × store scope for the company (or one product key). */
export function accountCells(company: string, key?: string, now = Date.now()): AccountCell[] {
  const { stores } = load();
  return companyRows(company)
    .filter((r) => key == null || keyOf(r) === key)
    .map((r) => toCell(r, stores.get(r.storeId), now))
    .sort((a, b) => a.key.localeCompare(b.key) || a.retailer.localeCompare(b.retailer) || a.banner.localeCompare(b.banner) || a.storeName.localeCompare(b.storeName));
}

/** Every product of the company (merged by EAN), sorted by store scopes seen. */
export function accountProducts(company: string, now = Date.now()): AccountProduct[] {
  const { stores, seen } = load();
  const rows = companyRows(company);
  const scopeCounts = new Map<string, number>(); // banner|level → store scopes in dataset
  for (const s of stores.values()) scopeCounts.set(`${s.banner}|${s.level}`, (scopeCounts.get(`${s.banner}|${s.level}`) ?? 0) + 1);

  const byKey = new Map<string, Row[]>();
  for (const r of rows) byKey.set(keyOf(r), [...(byKey.get(keyOf(r)) ?? []), r]);

  const out: AccountProduct[] = [];
  for (const [key, rs] of byKey) {
    const cells = rs.map((r) => toCell(r, stores.get(r.storeId), now));
    const productIds = [...new Set(rs.map((r) => r.productId))].sort();
    // Representative listing: the one seen in most stores; ties → alphabetical product id.
    const perId = productIds.map((id) => ({ id, n: rs.filter((r) => r.productId === id).length })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
    const rep = rs.find((r) => r.productId === perId[0].id)!;

    const byBanner = new Map<string, AccountCell[]>();
    for (const c of cells) byBanner.set(c.banner, [...(byBanner.get(c.banner) ?? []), c]);
    const banners: AccountBannerStat[] = [...byBanner.entries()]
      .map(([banner, cs]) => {
        const levels = new Set(cs.map((c) => c.level));
        const prices = cs.map((c) => c.price);
        return {
          banner,
          retailer: cs[0].retailer,
          stores: cs.length,
          capturedStores: [...levels].reduce((n, l) => n + (scopeCounts.get(`${banner}|${l}`) ?? 0), 0),
          minPrice: Math.min(...prices),
          maxPrice: Math.max(...prices),
          modePrice: modeOf(prices),
          promoStores: cs.filter((c) => c.promo?.active).length,
          chainOnly: !levels.has("store"),
        };
      })
      .sort((a, b) => b.stores - a.stores || a.banner.localeCompare(b.banner));

    const prices = cells.map((c) => c.price);
    const firsts = productIds.map((id) => seen.get(id)?.first).filter(Boolean) as string[];
    const lasts = productIds.map((id) => seen.get(id)?.last).filter(Boolean) as string[];
    out.push({
      key,
      name: rep.name,
      ean: rep.ean,
      productIds,
      brand: rep.brand ?? rs.find((r) => r.brand)?.brand ?? null,
      segment: rep.segment ?? rs.find((r) => r.segment)?.segment ?? null,
      imageUrl: rep.imageUrl ?? rs.find((r) => r.imageUrl)?.imageUrl ?? null,
      storesSeen: cells.length,
      banners,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      modePrice: modeOf(prices),
      spreadPct: spreadOf(cells)?.pct ?? null,
      promoStores: cells.filter((c) => c.promo?.active).length,
      firstSeen: firsts.sort()[0] ?? rs.map((r) => r.capturedAt).sort()[0],
      lastSeen: lasts.sort().at(-1) ?? rs.map((r) => r.capturedAt).sort().at(-1)!,
    });
  }
  return out.sort((a, b) => b.storesSeen - a.storesSeen || a.name.localeCompare(b.name));
}

function groupPromos(rows: Row[], company: string, now: number, activeOnly: boolean): AccountPromo[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.promo) continue;
    if (activeOnly && !isActive(r.promo.validTo, now)) continue;
    const k = [keyOf(r), r.banner, r.promo.type, r.promo.label ?? "", r.promo.offerPrice].join("|");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: AccountPromo[] = [];
  for (const rs of groups.values()) {
    // Representative: the most recent capture, then store id, so the output is deterministic.
    const rep = [...rs].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.storeId.localeCompare(b.storeId))[0];
    const p = rep.promo!;
    out.push({
      key: keyOf(rep),
      name: rep.name,
      brand: rep.brand,
      company: rep.company,
      own: rep.company === company,
      segment: rep.segment,
      banner: rep.banner,
      retailer: rep.retailer,
      level: rs.some((r) => r.level === "store") ? "store" : "chain",
      type: p.type,
      label: p.label,
      offerPrice: p.offerPrice,
      referencePrice: p.referencePrice,
      referenceKind: p.referenceKind,
      discountPct: p.referencePrice != null ? p.discountPct : null,
      validTo: p.validTo,
      active: isActive(p.validTo, now),
      stores: new Set(rs.map((r) => r.storeId)).size,
      sourceUrl: rep.sourceUrl,
    });
  }
  const end = (x: AccountPromo) => validUntil(x.validTo) ?? Number.POSITIVE_INFINITY;
  return out.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      end(a) - end(b) ||
      b.stores - a.stores ||
      a.name.localeCompare(b.name) ||
      a.banner.localeCompare(b.banner) ||
      a.offerPrice - b.offerPrice,
  );
}

/**
 * Own promotions (active first, then ended ones still showing on the latest capture) and active competitor
 * promotions in the comparison groups where the company has products. Soonest-ending first, then by stores.
 */
export function accountPromos(company: string, now = Date.now()): { own: AccountPromo[]; competitors: AccountPromo[] } {
  const all = dedupe(load().rows);
  const ownRows = all.filter((r) => r.company === company);
  const segments = new Set(ownRows.map((r) => r.segment).filter((s): s is string => !!s));
  const compRows = all.filter((r) => r.company != null && r.company !== company && r.segment != null && segments.has(r.segment));
  return { own: groupPromos(ownRows, company, now, false), competitors: groupPromos(compRows, company, now, true) };
}

export function accountSummary(company: string, now = Date.now()): AccountSummary {
  const { stores } = load();
  const products = accountProducts(company, now);
  const cells = accountCells(company, undefined, now);
  const { own } = accountPromos(company, now);
  const live = own.filter((p) => p.active);
  let widest: AccountSummary["widestSpread"] = null;
  for (const p of products) {
    const s = spreadOf(cells.filter((c) => c.key === p.key));
    if (s && (!widest || s.pct > widest.pct || (s.pct === widest.pct && s.stores > widest.stores))) widest = { key: p.key, name: p.name, ...s };
  }
  return {
    company,
    products: products.length,
    storesSeen: new Set(cells.map((c) => c.storeId)).size,
    storeScopesTotal: stores.size,
    banners: new Set(cells.map((c) => c.banner)).size,
    livePromos: live.length,
    promoStoreListings: cells.filter((c) => c.promo?.active).length,
    endingSoon: live.filter((p) => {
      const t = validUntil(p.validTo);
      return t != null && t <= now + ENDING_SOON_MS;
    }).length,
    widestSpread: widest,
  };
}
