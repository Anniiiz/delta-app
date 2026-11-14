import { db } from "./db";
import { ensureData } from "./importer";
import { AREA_SQL, DEMO_CATEGORY, DEMO_SCOPES, segmentBasis } from "./taxonomy";
import { FLAG_TEXT, validUntil, type QualityFlag } from "./normalize";

/**
 * Deterministic analytics over stored observations. Every number the UI shows comes from here;
 * nothing is estimated beyond the observations in the selected scope.
 */

export interface Row {
  obsId: number;
  productId: string;
  name: string;
  brand: string | null;
  company: string | null;
  segment: string | null;
  ean: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  sizeIsRange: boolean;
  sizeRaw: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  storeId: string;
  storeName: string;
  retailer: string;
  banner: string;
  level: "store" | "chain";
  price: number;
  unitPrice: number | null;
  unitBase: string | null;
  offerPrice: number | null;
  offerUnitPrice: number | null;
  regularPrice: number | null;
  lowest30d: number | null;
  promo: null | {
    type: string;
    label: string | null;
    offerPrice: number;
    referencePrice: number | null;
    referenceKind: string | null;
    discountPct: number | null;
    validFrom: string | null;
    validTo: string | null;
    conditions: string | null;
    active: boolean;
  };
  previousPrice: number | null;
  previousAt: string | null;
  captures: number;
  flags: QualityFlag[];
  sourceUrl: string;
  requestId: string | null;
  capturedAt: string;
  origin: string;
  listingStatus: string;
}

export interface Scope {
  category: string;
  storeIds: string[];
}

export const DEFAULT_SCOPE: Scope = { category: DEMO_CATEGORY, storeIds: DEMO_SCOPES };

let booted = false;
function boot() {
  if (booted) return;
  ensureData();
  booted = true;
}

const inList = (xs: string[]) => xs.map(() => "?").join(",");

/** Latest observation per product × store in scope, with the previous observation for change detection. */
/**
 * Per-request work is the same until new observations arrive, so results are memoised by data version
 * (latest observation id) and minute (promotion validity depends on the clock). Callers must not mutate.
 */
const memo = (globalThis as unknown as { __siMemo?: Map<string, unknown> }).__siMemo ?? new Map<string, unknown>();
(globalThis as unknown as { __siMemo?: Map<string, unknown> }).__siMemo = memo;
function cached<T>(name: string, scope: Scope, compute: () => T): T {
  boot();
  // Read from the database on every call: inserts by the poller, the daily sweep (another process) or a re-import all change it.
  const v = db().prepare("SELECT MAX(id) AS m, COUNT(*) AS n FROM observations").get() as { m: number; n: number };
  const key = `${name}|${v.m}|${v.n}|${Math.floor(Date.now() / 60_000)}|${scope.category}|${scope.storeIds.join(",")}`;
  if (memo.has(key)) return memo.get(key) as T;
  if (memo.size > 50) memo.clear();
  const out = compute();
  memo.set(key, out);
  return out;
}

export function latestRows(scope: Scope = DEFAULT_SCOPE): Row[] {
  return cached("latestRows", scope, () => latestRowsUncached(scope));
}

function latestRowsUncached(scope: Scope): Row[] {
  boot();
  const now = Date.now();
  const rows = db()
    .prepare(
      `WITH ranked AS (
         SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.product_id, o.store_id ORDER BY o.captured_at DESC, o.id DESC) AS rn,
                COUNT(*) OVER (PARTITION BY o.product_id, o.store_id) AS captures,
                LEAD(o.price) OVER (PARTITION BY o.product_id, o.store_id ORDER BY o.captured_at DESC, o.id DESC) AS prev_price,
                LEAD(o.captured_at) OVER (PARTITION BY o.product_id, o.store_id ORDER BY o.captured_at DESC, o.id DESC) AS prev_at
         FROM observations o JOIN products p ON p.id = o.product_id
         WHERE p.category = ? AND o.store_id IN (${inList(scope.storeIds)})
       )
       SELECT r.*, p.name, p.brand, b.company, p.segment, p.ean, p.size_value, p.size_unit, p.size_is_range, p.size_raw, p.url AS product_url, p.image_url,
              s.name AS store_name, s.retailer, s.banner, s.level, l.status AS listing_status,
              pr.type AS pr_type, pr.label AS pr_label, pr.offer_price AS pr_offer, pr.reference_price AS pr_ref, pr.reference_kind AS pr_ref_kind,
              pr.discount_pct AS pr_disc, pr.valid_from AS pr_from, pr.valid_to AS pr_to, pr.conditions AS pr_cond
       FROM ranked r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN brands b ON b.name = p.brand
       JOIN stores s ON s.id = r.store_id
       LEFT JOIN listings l ON l.product_id = r.product_id AND l.store_id = r.store_id
       LEFT JOIN promotions pr ON pr.observation_id = r.id
       WHERE r.rn = 1`,
    )
    .all(scope.category, ...scope.storeIds) as Record<string, unknown>[];

  return rows.map((r) => {
    const vt = validUntil((r.pr_to as string) ?? null);
    return {
      obsId: r.id as number,
      productId: r.product_id as string,
      name: r.name as string,
      brand: (r.brand as string) ?? null,
      company: (r.company as string) ?? (r.brand as string) ?? null,
      segment: (r.segment as string) ?? null,
      ean: (r.ean as string) ?? null,
      sizeValue: (r.size_value as number) ?? null,
      sizeUnit: (r.size_unit as string) ?? null,
      sizeIsRange: Boolean(r.size_is_range),
      sizeRaw: (r.size_raw as string) ?? null,
      productUrl: (r.product_url as string) ?? null,
      imageUrl: (r.image_url as string) ?? null,
      storeId: r.store_id as string,
      storeName: r.store_name as string,
      retailer: r.retailer as string,
      banner: r.banner as string,
      level: r.level as "store" | "chain",
      price: r.price as number,
      unitPrice: (r.unit_price as number) ?? null,
      unitBase: (r.unit_base as string) ?? null,
      offerPrice: (r.offer_price as number) ?? null,
      offerUnitPrice: (r.offer_unit_price as number) ?? null,
      regularPrice: (r.regular_price as number) ?? null,
      lowest30d: (r.lowest_30d as number) ?? null,
      promo: r.pr_type
        ? {
            type: r.pr_type as string,
            label: (r.pr_label as string) ?? null,
            offerPrice: r.pr_offer as number,
            referencePrice: (r.pr_ref as number) ?? null,
            referenceKind: (r.pr_ref_kind as string) ?? null,
            discountPct: (r.pr_disc as number) ?? null,
            validFrom: (r.pr_from as string) ?? null,
            validTo: (r.pr_to as string) ?? null,
            conditions: (r.pr_cond as string) ?? null,
            active: vt == null || vt >= now,
          }
        : null,
      previousPrice: (r.prev_price as number) ?? null,
      previousAt: (r.prev_at as string) ?? null,
      captures: r.captures as number,
      flags: JSON.parse((r.flags as string) || "[]"),
      sourceUrl: r.source_url as string,
      requestId: (r.request_id as string) ?? null,
      capturedAt: r.captured_at as string,
      origin: r.origin as string,
      listingStatus: (r.listing_status as string) ?? "listed",
    };
  });
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Company {
  name: string;
  brands: string[];
  products: number;
}

export function companies(rows: Row[]): Company[] {
  const m = new Map<string, { brands: Set<string>; products: Set<string> }>();
  for (const r of rows) {
    if (!r.company) continue;
    const e = m.get(r.company) ?? { brands: new Set(), products: new Set() };
    if (r.brand) e.brands.add(r.brand);
    e.products.add(r.productId);
    m.set(r.company, e);
  }
  return [...m.entries()]
    .map(([name, e]) => ({ name, brands: [...e.brands].sort(), products: e.products.size }))
    .sort((a, b) => b.products - a.products || a.name.localeCompare(b.name));
}

export interface SegmentPosition {
  segment: string;
  basis: string;
  ownProducts: number;
  competitorProducts: number;
  ownObs: number;
  competitorObs: number;
  ownMedian: number | null;
  competitorMedian: number | null;
  /** (own − competitor) / competitor; positive = own brand is pricier per kg. */
  gapPct: number | null;
  positioning: "premium" | "parity" | "value" | "no comparison";
  competitors: { company: string; median: number; n: number }[];
  ownBrands: string[];
}

/** Unit-price positioning of the selected company inside each comparison group where it has products. */
export function positioning(rows: Row[], company: string): SegmentPosition[] {
  const bySeg = new Map<string, Row[]>();
  for (const r of rows) if (r.segment) bySeg.set(r.segment, [...(bySeg.get(r.segment) ?? []), r]);
  const out: SegmentPosition[] = [];
  for (const [segment, rs] of bySeg) {
    const own = rs.filter((r) => r.company === company);
    if (!own.length) continue;
    const comp = rs.filter((r) => r.company !== company);
    const up = (xs: Row[]) => xs.map((r) => r.unitPrice).filter((x): x is number => x != null);
    const ownMedian = median(up(own));
    const competitorMedian = median(up(comp));
    const gapPct = ownMedian != null && competitorMedian != null ? (ownMedian - competitorMedian) / competitorMedian : null;
    const byCo = new Map<string, number[]>();
    for (const r of comp) if (r.unitPrice != null && r.company) byCo.set(r.company, [...(byCo.get(r.company) ?? []), r.unitPrice]);
    out.push({
      segment,
      basis: segmentBasis(segment),
      ownProducts: new Set(own.map((r) => r.productId)).size,
      competitorProducts: new Set(comp.map((r) => r.productId)).size,
      ownObs: up(own).length,
      competitorObs: up(comp).length,
      ownMedian,
      competitorMedian,
      gapPct,
      positioning: gapPct == null ? "no comparison" : gapPct > 0.05 ? "premium" : gapPct < -0.05 ? "value" : "parity",
      competitors: [...byCo.entries()].map(([c, xs]) => ({ company: c, median: median(xs)!, n: xs.length })).sort((a, b) => a.median - b.median),
      ownBrands: [...new Set(own.map((r) => r.brand).filter(Boolean) as string[])],
    });
  }
  return out.sort((a, b) => (a.positioning === "no comparison" ? 1 : 0) - (b.positioning === "no comparison" ? 1 : 0) || b.ownProducts - a.ownProducts);
}

export interface HistoryInfo {
  captures: number;
  firstCapture: string | null;
  lastCapture: string | null;
  pairsWithHistory: number;
  priceChanges: { productId: string; name: string; brand: string | null; storeName: string; from: number; to: number; at: string; prevAt: string; sourceUrl: string }[];
}

/** Observed price changes = consecutive observations of the same product at the same store with different prices. */
export function history(scope: Scope = DEFAULT_SCOPE): HistoryInfo {
  return cached("history", scope, () => historyUncached(scope));
}

function historyUncached(scope: Scope): HistoryInfo {
  boot();
  const d = db();
  const params = [scope.category, ...scope.storeIds];
  const base = `FROM observations o JOIN products p ON p.id = o.product_id WHERE p.category = ? AND o.store_id IN (${inList(scope.storeIds)})`;
  const agg = d.prepare(`SELECT COUNT(DISTINCT o.captured_at) AS caps, MIN(o.captured_at) AS first, MAX(o.captured_at) AS last ${base}`).get(...params) as {
    caps: number;
    first: string | null;
    last: string | null;
  };
  const pairs = d
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT o.product_id, o.store_id ${base} GROUP BY 1, 2 HAVING COUNT(DISTINCT o.captured_at) > 1)`)
    .get(...params) as { n: number };
  const changes = d
    .prepare(
      `WITH seq AS (
         SELECT o.product_id, o.store_id, o.price, o.captured_at, o.source_url,
                LAG(o.price) OVER w AS prev_price, LAG(o.captured_at) OVER w AS prev_at
         ${base} WINDOW w AS (PARTITION BY o.product_id, o.store_id ORDER BY o.captured_at, o.id)
       )
       SELECT seq.*, p.name, p.brand, s.name AS store_name FROM seq JOIN products p ON p.id = seq.product_id JOIN stores s ON s.id = seq.store_id
       WHERE prev_price IS NOT NULL AND ABS(prev_price - price) > 0.004 ORDER BY captured_at DESC`,
    )
    .all(...params) as Record<string, unknown>[];
  return {
    captures: agg.caps,
    firstCapture: agg.first,
    lastCapture: agg.last,
    pairsWithHistory: pairs.n,
    priceChanges: changes.map((c) => ({
      productId: c.product_id as string,
      name: c.name as string,
      brand: (c.brand as string) ?? null,
      storeName: c.store_name as string,
      from: c.prev_price as number,
      to: c.price as number,
      at: c.captured_at as string,
      prevAt: c.prev_at as string,
      sourceUrl: c.source_url as string,
    })),
  };
}

/** Price history for one product across all stores (for the detail drawer and trend chart). */
export function productHistory(productId: string) {
  boot();
  return db()
    .prepare(
      `SELECT o.id, o.store_id, s.name AS store_name, o.price, o.unit_price, o.promo_label, o.captured_at, o.source_url, o.origin, o.request_id
       FROM observations o JOIN stores s ON s.id = o.store_id WHERE o.product_id = ? ORDER BY o.captured_at`,
    )
    .all(productId) as { id: number; store_id: string; store_name: string; price: number; unit_price: number | null; promo_label: string | null; captured_at: string; source_url: string; origin: string; request_id: string | null }[];
}

export interface StoreSpread {
  productId: string;
  name: string;
  brand: string | null;
  company: string | null;
  stores: number;
  min: number;
  max: number;
  modal: number;
  outliers: { storeName: string; price: number; label: string | null; sourceUrl: string }[];
}

/**
 * Store-level differences inside S Group: the same product's shelf price across every imported
 * S Group store (each priced from that store's own campaign page). Real per-store variation only.
 */
export function sGroupSpread(category = DEMO_CATEGORY): StoreSpread[] {
  boot();
  const rows = db()
    .prepare(
      `WITH latest AS (
         SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.product_id, o.store_id ORDER BY o.captured_at DESC) rn
         FROM observations o JOIN stores s ON s.id = o.store_id WHERE s.retailer = 'S Group' AND ${AREA_SQL}
       )
       SELECT l.product_id, p.name, p.brand, b.company, l.price, l.promo_label, l.source_url, s.name AS store_name
       FROM latest l JOIN products p ON p.id = l.product_id LEFT JOIN brands b ON b.name = p.brand JOIN stores s ON s.id = l.store_id
       WHERE l.rn = 1 AND p.category = ?`,
    )
    .all(category) as { product_id: string; name: string; brand: string | null; company: string | null; price: number; promo_label: string | null; source_url: string; store_name: string }[];
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.product_id, [...(by.get(r.product_id) ?? []), r]);
  const out: StoreSpread[] = [];
  for (const [productId, rs] of by) {
    if (rs.length < 3) continue;
    const counts = new Map<number, number>();
    for (const r of rs) counts.set(r.price, (counts.get(r.price) ?? 0) + 1);
    const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const prices = rs.map((r) => r.price);
    out.push({
      productId,
      name: rs[0].name,
      brand: rs[0].brand,
      company: rs[0].company ?? rs[0].brand,
      stores: rs.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      modal,
      outliers: rs.filter((r) => r.price !== modal).map((r) => ({ storeName: r.store_name, price: r.price, label: r.promo_label, sourceUrl: r.source_url })),
    });
  }
  return out.sort((a, b) => b.max - b.min - (a.max - a.min) || b.stores - a.stores);
}

export interface Coverage {
  stores: { id: string; name: string; retailer: string; banner: string; level: string; city: string | null; address: string | null; priceNote: string | null; products: number; observations: number; lastCapture: string | null; inScope: boolean }[];
  totals: { products: number; categoryProducts: number; observations: number; stores: number; promotions: number; imports: { source: string; finished_at: string; stats: string }[] };
  flags: { flag: QualityFlag; text: string; products: number }[];
}

export function coverage(scope: Scope = DEFAULT_SCOPE): Coverage {
  boot();
  const d = db();
  const stores = d
    .prepare(
      `SELECT s.*, COUNT(DISTINCT o.product_id) AS products, COUNT(o.id) AS observations, MAX(o.captured_at) AS last_capture
       FROM stores s JOIN observations o ON o.store_id = s.id JOIN products p ON p.id = o.product_id AND p.category = ?
       WHERE ${AREA_SQL}
       GROUP BY s.id ORDER BY products DESC, s.name`,
    )
    .all(scope.category) as Record<string, unknown>[];
  const flagRows = d
    .prepare(
      `SELECT DISTINCT o.product_id, o.flags FROM observations o JOIN products p ON p.id = o.product_id
       WHERE p.category = ? AND o.store_id IN (${inList(scope.storeIds)})`,
    )
    .all(scope.category, ...scope.storeIds) as { product_id: string; flags: string }[];
  const fc = new Map<QualityFlag, Set<string>>();
  for (const r of flagRows) for (const f of JSON.parse(r.flags) as QualityFlag[]) fc.set(f, (fc.get(f) ?? new Set()).add(r.product_id));
  const one = (sql: string, ...p: (string | number)[]) => (d.prepare(sql).get(...p) as { n: number }).n;
  return {
    stores: stores.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      retailer: s.retailer as string,
      banner: s.banner as string,
      level: s.level as string,
      city: (s.city as string) ?? null,
      address: (s.address as string) ?? null,
      priceNote: (s.price_note as string) ?? null,
      products: s.products as number,
      observations: s.observations as number,
      lastCapture: (s.last_capture as string) ?? null,
      inScope: scope.storeIds.includes(s.id as string),
    })),
    totals: {
      products: one("SELECT COUNT(*) AS n FROM products"),
      categoryProducts: one(`SELECT COUNT(DISTINCT o.product_id) AS n FROM observations o JOIN products p ON p.id = o.product_id JOIN stores s ON s.id = o.store_id WHERE p.category = ? AND ${AREA_SQL}`, scope.category),
      observations: one("SELECT COUNT(*) AS n FROM observations"),
      stores: one(`SELECT COUNT(DISTINCT s.id) AS n FROM stores s JOIN observations o ON o.store_id = s.id WHERE ${AREA_SQL}`),
      promotions: one("SELECT COUNT(*) AS n FROM promotions"),
      imports: d.prepare("SELECT source, finished_at, stats FROM imports ORDER BY id DESC LIMIT 5").all() as { source: string; finished_at: string; stats: string }[],
    },
    flags: [...fc.entries()].map(([flag, s]) => ({ flag, text: FLAG_TEXT[flag], products: s.size })).sort((a, b) => b.products - a.products),
  };
}

export interface AlertRow {
  id: number;
  kind: string;
  productId: string | null;
  storeId: string | null;
  storeName: string | null;
  brand: string | null;
  company: string | null;
  segment: string | null;
  title: string;
  why: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  magnitude: number | null;
  priority: number;
  sourceUrl: string | null;
  origin: string;
  createdAt: string;
  observedAt: string | null;
  read: boolean;
}

export function listAlerts(limit = 50): AlertRow[] {
  boot();
  return (
    db()
      .prepare(
        `SELECT a.*, s.name AS store_name, b.company FROM alerts a LEFT JOIN stores s ON s.id = a.store_id LEFT JOIN brands b ON b.name = a.brand
         ORDER BY a.created_at DESC, a.priority DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[]
  ).map((a) => ({
    id: a.id as number,
    kind: a.kind as string,
    productId: (a.product_id as string) ?? null,
    storeId: (a.store_id as string) ?? null,
    storeName: (a.store_name as string) ?? null,
    brand: (a.brand as string) ?? null,
    company: (a.company as string) ?? (a.brand as string) ?? null,
    segment: (a.segment as string) ?? null,
    title: a.title as string,
    why: (a.why as string) ?? null,
    before: a.before ? JSON.parse(a.before as string) : null,
    after: a.after ? JSON.parse(a.after as string) : null,
    magnitude: (a.magnitude as number) ?? null,
    priority: a.priority as number,
    sourceUrl: (a.source_url as string) ?? null,
    origin: a.origin as string,
    createdAt: a.created_at as string,
    observedAt: (a.observed_at as string) ?? null,
    read: Boolean(a.read),
  }));
}

export interface CrossRetailer {
  ean: string;
  name: string;
  brand: string | null;
  company: string | null;
  banners: { banner: string; level: string; min: number; max: number; stores: number; promoLabel: string | null; sourceUrl: string; capturedAt: string }[];
}

/**
 * The same product (same EAN) priced by more than one retailer, across every imported store scope.
 * Per banner: price range and number of stores, from each store's latest observation.
 */
export function crossRetailer(category = DEMO_CATEGORY): CrossRetailer[] {
  boot();
  const rows = db()
    .prepare(
      `WITH latest AS (
         SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.product_id, o.store_id ORDER BY o.captured_at DESC) rn FROM observations o
       )
       SELECT p.ean, p.name, p.brand, b.company, s.banner, s.retailer, s.level, l.price, l.promo_label, l.source_url, l.captured_at
       FROM latest l JOIN products p ON p.id = l.product_id LEFT JOIN brands b ON b.name = p.brand JOIN stores s ON s.id = l.store_id
       WHERE l.rn = 1 AND p.category = ? AND p.ean IS NOT NULL AND ${AREA_SQL}`,
    )
    .all(category) as { ean: string; name: string; brand: string | null; company: string | null; banner: string; retailer: string; level: string; price: number; promo_label: string | null; source_url: string; captured_at: string }[];
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.ean, [...(by.get(r.ean) ?? []), r]);
  const out: CrossRetailer[] = [];
  for (const [ean, rs] of by) {
    if (new Set(rs.map((r) => r.retailer)).size < 2) continue;
    const banners = new Map<string, typeof rs>();
    for (const r of rs) banners.set(r.banner, [...(banners.get(r.banner) ?? []), r]);
    out.push({
      ean,
      name: rs.find((r) => r.retailer === "S Group")?.name ?? rs[0].name,
      brand: rs[0].brand,
      company: rs[0].company ?? rs[0].brand,
      banners: [...banners.entries()]
        .map(([banner, xs]) => ({
          banner,
          level: xs[0].level,
          min: Math.min(...xs.map((x) => x.price)),
          max: Math.max(...xs.map((x) => x.price)),
          stores: xs.length,
          promoLabel: xs[0].promo_label,
          sourceUrl: xs[0].source_url,
          capturedAt: xs[0].captured_at,
        }))
        .sort((a, b) => a.min - b.min),
    });
  }
  return out;
}

// ------------------------------------------------------------------ all-store analytics

export interface StoreObs {
  productId: string;
  ean: string | null;
  name: string;
  brand: string | null;
  company: string | null;
  segment: string | null;
  storeId: string;
  storeName: string;
  retailer: string;
  banner: string;
  city: string | null;
  price: number;
  promoLabel: string | null;
  sourceUrl: string;
}

const g = globalThis as unknown as { __siAll?: { key: string; rows: StoreObs[] } };

/** Latest shelf price of every category product in every store with store-level prices. Cached until new observations arrive. */
export function allStoreLatest(category = DEMO_CATEGORY): StoreObs[] {
  boot();
  const key = `${category}:${(db().prepare("SELECT MAX(id) AS m FROM observations").get() as { m: number }).m}`;
  if (g.__siAll?.key === key) return g.__siAll.rows;
  const rows = (
    db()
      .prepare(
        `WITH latest AS (
           SELECT o.product_id, o.store_id, o.price, o.promo_label, o.source_url,
                  ROW_NUMBER() OVER (PARTITION BY o.product_id, o.store_id ORDER BY o.captured_at DESC, o.id DESC) rn
           FROM observations o JOIN products p ON p.id = o.product_id JOIN stores s ON s.id = o.store_id
           WHERE p.category = ? AND ${AREA_SQL}
         )
         SELECT l.*, p.ean, p.name, p.brand, b.company, p.segment, s.name AS store_name, s.retailer, s.banner, s.city
         FROM latest l JOIN products p ON p.id = l.product_id LEFT JOIN brands b ON b.name = p.brand JOIN stores s ON s.id = l.store_id
         WHERE l.rn = 1`,
      )
      .all(category) as Record<string, unknown>[]
  ).map((r) => ({
    productId: r.product_id as string,
    ean: (r.ean as string) ?? null,
    name: r.name as string,
    brand: (r.brand as string) ?? null,
    company: (r.company as string) ?? (r.brand as string) ?? null,
    segment: (r.segment as string) ?? null,
    storeId: r.store_id as string,
    storeName: r.store_name as string,
    retailer: r.retailer as string,
    banner: r.banner as string,
    city: (r.city as string) ?? null,
    price: r.price as number,
    promoLabel: (r.promo_label as string) ?? null,
    sourceUrl: r.source_url as string,
  }));
  g.__siAll = { key, rows };
  return rows;
}

const itemKey = (r: StoreObs) => r.ean ?? r.productId;

export interface StoreIndex {
  storeId: string;
  name: string;
  banner: string;
  retailer: string;
  city: string | null;
  index: number; // 100 = median store for the same products
  products: number;
}

/**
 * Store price index: for each product, every store's shelf price divided by the median across all
 * stores that list it (matched by EAN across retailers). A store's index is the median of those ratios
 * × 100. Products listed in fewer than 5 stores and stores with fewer than 20 products are left out.
 */
export function storeIndex(category = DEMO_CATEGORY, filter?: (r: StoreObs) => boolean): StoreIndex[] {
  const rows = filter ? allStoreLatest(category).filter(filter) : allStoreLatest(category);
  const byItem = new Map<string, number[]>();
  for (const r of rows) byItem.set(itemKey(r), [...(byItem.get(itemKey(r)) ?? []), r.price]);
  const med = new Map<string, number>();
  for (const [k, xs] of byItem) if (xs.length >= 5) med.set(k, median(xs)!);
  const byStore = new Map<string, { r: StoreObs; ratios: number[] }>();
  for (const r of rows) {
    const m = med.get(itemKey(r));
    if (!m) continue;
    const e = byStore.get(r.storeId) ?? { r, ratios: [] };
    e.ratios.push(r.price / m);
    byStore.set(r.storeId, e);
  }
  return [...byStore.values()]
    .filter((e) => e.ratios.length >= 20)
    .map((e) => ({ storeId: e.r.storeId, name: e.r.storeName, banner: e.r.banner, retailer: e.r.retailer, city: e.r.city, index: Math.round(median(e.ratios)! * 1000) / 10, products: e.ratios.length }))
    .sort((a, b) => a.index - b.index);
}

export interface RetailerGap {
  company: string;
  products: number;
  gap: number; // median of (Kesko median / S Group median − 1) over identical products
  kesko: number;
  sGroup: number;
}

/** Identical products (same EAN) priced in both K and S Group stores: median price gap per company. */
export function retailerGap(category = DEMO_CATEGORY, filter?: (r: StoreObs) => boolean): { byCompany: RetailerGap[]; overall: number | null; products: number } {
  const rows = allStoreLatest(category).filter((r) => r.ean && (!filter || filter(r)));
  const by = new Map<string, { k: number[]; s: number[]; company: string }>();
  for (const r of rows) {
    if (r.retailer !== "Kesko" && r.retailer !== "S Group") continue;
    const e = by.get(r.ean!) ?? { k: [], s: [], company: r.company ?? "Other" };
    (r.retailer === "Kesko" ? e.k : e.s).push(r.price);
    by.set(r.ean!, e);
  }
  const pairs = [...by.values()].filter((e) => e.k.length && e.s.length).map((e) => ({ company: e.company, k: median(e.k)!, s: median(e.s)!, gap: median(e.k)! / median(e.s)! - 1 }));
  const byCo = new Map<string, typeof pairs>();
  for (const p of pairs) byCo.set(p.company, [...(byCo.get(p.company) ?? []), p]);
  return {
    overall: pairs.length ? median(pairs.map((p) => p.gap)) : null,
    products: pairs.length,
    byCompany: [...byCo.entries()]
      .filter(([, ps]) => ps.length >= 3)
      .map(([company, ps]) => ({ company, products: ps.length, gap: median(ps.map((p) => p.gap))!, kesko: median(ps.map((p) => p.k))!, sGroup: median(ps.map((p) => p.s))! }))
      .sort((a, b) => b.products - a.products),
  };
}

/** Same product, same chain, different price in some stores. Generalises the S Group view to every chain. */
export function storeSpread(category = DEMO_CATEGORY, limit = 8, filter?: (r: StoreObs) => boolean): (StoreSpread & { retailer: string })[] {
  const rows = filter ? allStoreLatest(category).filter(filter) : allStoreLatest(category);
  const by = new Map<string, StoreObs[]>();
  for (const r of rows) by.set(`${r.retailer}|${r.productId}`, [...(by.get(`${r.retailer}|${r.productId}`) ?? []), r]);
  const out: (StoreSpread & { retailer: string })[] = [];
  for (const rs of by.values()) {
    if (rs.length < 5) continue;
    const counts = new Map<number, number>();
    for (const r of rs) counts.set(r.price, (counts.get(r.price) ?? 0) + 1);
    const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const prices = rs.map((r) => r.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) continue;
    out.push({
      productId: rs[0].productId,
      retailer: rs[0].retailer,
      name: rs[0].name,
      brand: rs[0].brand,
      company: rs[0].company,
      stores: rs.length,
      min,
      max,
      modal,
      outliers: rs
        .filter((r) => r.price !== modal)
        .sort((a, b) => a.price - b.price)
        .slice(0, 4)
        .map((r) => ({ storeName: r.storeName, price: r.price, label: r.promoLabel, sourceUrl: r.sourceUrl })),
    });
  }
  return out.sort((a, b) => (b.max - b.min) / b.modal - (a.max - a.min) / a.modal).slice(0, limit);
}
