import fs from "node:fs";
import path from "node:path";
import { db, nowIso } from "./db";
import { brandOf, classify, companyOf, scopeInfo } from "./taxonomy";
import { normalizePrice, promotionOf, resolveSize, type RawSnapshot } from "./normalize";

/**
 * Imports the seed export (real Context.dev captures of S-kaupat, K-Ruoka and Lidl pages) into
 * Delta's normalised model. Idempotent: every snapshot has a stable source key, so re-running the
 * import adds only new observations and never overwrites history.
 */

export const DEFAULT_EXPORT = path.join(process.cwd(), "data", "source", "seed-export.json");

interface ExportFile {
  format: string;
  exported_at: string;
  stores: Record<string, unknown>[];
  products: Record<string, unknown>[];
  price_snapshots: (RawSnapshot & { id: number; product_id: string; store_scope: string; source_url: string; source_kind: string; request_id: string | null; captured_at: string; is_sample: number })[];
  monitors: Record<string, unknown>[];
  monitor_events: Record<string, unknown>[];
}

export interface ImportStats {
  source: string;
  exportedAt: string;
  products: number;
  productsSkipped: { id: string; reason: string }[];
  stores: number;
  observationsInFile: number;
  observationsAdded: number;
  observationsSkipped: { id: number; reason: string }[];
  promotions: number;
  monitorEvents: number;
}

const CHAIN_NAMES: Record<string, string> = {
  "chain:lidl": "Lidl Finland · weekly offers",
  "chain:k-supermarket": "K-Supermarket · chain-wide offers",
  "chain:k-market": "K-Market · chain-wide offers",
  "chain:k-citymarket": "K-Citymarket · chain-wide offers",
};
const CHAIN_NOTES: Record<string, string> = {
  "chain:lidl": "National Lidl Finland weekly offer pages (lidl.fi). Offer items only, valid in every Lidl store.",
  "chain:k-supermarket": "K-Supermarket offer flyer (k-ruoka.fi/k-supermarket/tarjouslehti). Chain-wide offers, not a single store's shelf.",
  "chain:k-market": "K-Market offer flyer (k-ruoka.fi/k-market/tarjouslehti). Chain-wide offers, not a single store's shelf.",
};

function cityOf(address: unknown): string | null {
  const a = String(address ?? "");
  const m = a.match(/\b(Helsinki|Espoo|Vantaa|Kauniainen)\b/);
  return m ? m[1] : null;
}

export function importExport(file = DEFAULT_EXPORT): ImportStats {
  if (!fs.existsSync(file)) throw new Error(`Export file not found: ${file}. Run "npm run data:export" first.`);
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as ExportFile;
  if (data.format !== "seed-export/v1") throw new Error(`Unsupported export format: ${data.format}`);
  const d = db();
  const startedAt = nowIso();
  const stats: ImportStats = {
    source: path.relative(process.cwd(), file),
    exportedAt: data.exported_at,
    products: 0,
    productsSkipped: [],
    stores: 0,
    observationsInFile: data.price_snapshots.length,
    observationsAdded: 0,
    observationsSkipped: [],
    promotions: 0,
    monitorEvents: 0,
  };

  d.exec("BEGIN");
  try {
    // ---------------------------------------------------------------- stores
    const storeRows = new Map(data.stores.map((s) => [String(s.id), s]));
    const scopes = new Set(data.price_snapshots.map((s) => s.store_scope));
    const upStore = d.prepare(
      `INSERT INTO stores(id, retailer, banner, name, level, address, city, lat, lon, price_note) VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET retailer=excluded.retailer, banner=excluded.banner, name=excluded.name, level=excluded.level,
         address=excluded.address, city=excluded.city, lat=excluded.lat, lon=excluded.lon, price_note=excluded.price_note`,
    );
    for (const scope of scopes) {
      const s = storeRows.get(scope);
      if (s?.is_demo || scope.startsWith("demo")) continue; // the demo page is not a retailer
      const info = scopeInfo(scope, s ? String(s.chain) : null);
      upStore.run(
        scope,
        info.retailer,
        info.banner,
        s ? String(s.name).replace(/\s+\(demo page\)$/, "") : CHAIN_NAMES[scope] ?? scope,
        info.level,
        (s?.address as string) ?? null,
        cityOf(s?.address),
        (s?.lat as number) ?? null,
        (s?.lon as number) ?? null,
        (s?.price_note as string) ?? CHAIN_NOTES[scope] ?? null,
      );
      stats.stores++;
    }

    // ---------------------------------------------------------------- brands and products
    const upBrand = d.prepare("INSERT INTO brands(name, manufacturer, company) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET manufacturer=excluded.manufacturer, company=excluded.company");
    const upProduct = d.prepare(
      `INSERT INTO products(id, name, brand, brand_source, category, segment, segment_rule, ean, size_value, size_unit, size_source, size_is_range, size_raw, url, image_url, raw)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, brand=excluded.brand, brand_source=excluded.brand_source, category=excluded.category,
         segment=excluded.segment, segment_rule=excluded.segment_rule, ean=excluded.ean, size_value=excluded.size_value, size_unit=excluded.size_unit,
         size_source=excluded.size_source, size_is_range=excluded.size_is_range, size_raw=excluded.size_raw, url=excluded.url,
         image_url=excluded.image_url, raw=excluded.raw`,
    );
    const sizes = new Map<string, ReturnType<typeof resolveSize>>();
    for (const p of data.products) {
      const id = String(p.id);
      if (p.chain === "demo" || p.is_sample) {
        stats.productsSkipped.push({ id, reason: p.chain === "demo" ? "demo page product (not a retailer)" : "sample data" });
        continue;
      }
      const name = String(p.name).trim();
      const b = brandOf(name, p.brand as string | null);
      if (b.brand) upBrand.run(b.brand, b.manufacturer, companyOf(b.brand, b.manufacturer));
      const c = classify(name);
      const size = resolveSize({ name, url: p.url as string, size_value: p.size_value as number | null, size_unit: p.size_unit as string | null });
      sizes.set(id, size);
      upProduct.run(
        id,
        name,
        b.brand,
        b.source,
        c.category,
        c.segment,
        c.rule,
        (p.ean as string) || null,
        size.value,
        size.unit,
        size.source,
        size.isRange ? 1 : 0,
        size.rawText,
        (p.url as string) ?? null,
        (p.image_url as string) ?? null,
        JSON.stringify(p),
      );
      stats.products++;
    }

    // ---------------------------------------------------------------- observations and promotions
    const known = new Set((d.prepare("SELECT id FROM products").all() as { id: string }[]).map((r) => r.id));
    const knownStores = new Set((d.prepare("SELECT id FROM stores").all() as { id: string }[]).map((r) => r.id));
    const insObs = d.prepare(
      `INSERT OR IGNORE INTO observations(source_key, product_id, store_id, price, regular_price, lowest_30d, unit_price, unit_base, offer_price, offer_unit_price,
        stated_unit_price, stated_unit, promo_kind, promo_label, promo_valid_from, promo_valid_to, loyalty, multibuy_qty, multibuy_price, flags,
        source_url, source_kind, origin, request_id, captured_at, raw)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insPromo = d.prepare(
      `INSERT OR IGNORE INTO promotions(observation_id, product_id, store_id, type, label, offer_price, reference_price, reference_kind, discount_pct,
        valid_from, valid_to, loyalty, conditions, source_url, captured_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const s of data.price_snapshots) {
      if (s.is_sample) {
        stats.observationsSkipped.push({ id: s.id, reason: "sample data" });
        continue;
      }
      if (!known.has(s.product_id) || !knownStores.has(s.store_scope)) {
        stats.observationsSkipped.push({ id: s.id, reason: !known.has(s.product_id) ? "product skipped (demo page)" : "store skipped (demo page)" });
        continue;
      }
      if (!Number.isFinite(s.price) || s.price <= 0) {
        stats.observationsSkipped.push({ id: s.id, reason: "missing or non-positive price" });
        continue;
      }
      if (!Number.isFinite(Date.parse(s.captured_at))) {
        stats.observationsSkipped.push({ id: s.id, reason: "invalid capture timestamp" });
        continue;
      }
      const n = normalizePrice(s, sizes.get(s.product_id)!);
      const r = insertObservation(
        {
          sourceKey: `seed:${s.id}`,
          productId: s.product_id,
          storeId: s.store_scope,
          raw: s,
          sourceUrl: s.source_url,
          sourceKind: s.source_kind,
          origin: "import:seed",
          requestId: s.request_id,
          capturedAt: s.captured_at,
        },
        n,
        insObs,
      );
      if (r == null) continue;
      stats.observationsAdded++;
      const promo = promotionOf(s);
      if (promo) {
        insPromo.run(r, s.product_id, s.store_scope, promo.type, promo.label, promo.offerPrice, promo.referencePrice, promo.referenceKind, promo.discountPct, promo.validFrom, promo.validTo, promo.loyalty, promo.conditions, s.source_url, s.captured_at);
        stats.promotions++;
      }
    }

    // ---------------------------------------------------------------- Seed monitor history (read-only evidence)
    const upMon = d.prepare(
      `INSERT INTO monitors(id, name, target_url, kind, product_id, status, schedule_minutes, last_run_at, last_change_at, origin, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,'seed',?) ON CONFLICT(id) DO NOTHING`,
    );
    for (const m of data.monitors) {
      if (m.purpose === "demo_shop") continue;
      upMon.run(String(m.id), String(m.name), String(m.target_url), String(m.purpose), (m.product_id as string) ?? null, "imported", (m.schedule_minutes as number) ?? null, (m.last_run_at as string) ?? null, (m.last_change_at as string) ?? null, String(m.created_at));
    }
    const monIds = new Set(data.monitors.filter((m) => m.purpose !== "demo_shop").map((m) => String(m.id)));
    const insEv = d.prepare(
      "INSERT OR IGNORE INTO monitor_events(id, monitor_id, event, payload, received_at, processed_at, status, origin) VALUES(?,?,?,?,?,?,?,'seed')",
    );
    for (const e of data.monitor_events) {
      if (!monIds.has(String(e.monitor_id))) continue;
      const r = insEv.run(String(e.id), String(e.monitor_id), String(e.event), String(e.payload), String(e.received_at), (e.processed_at as string) ?? null, String(e.status));
      stats.monitorEvents += Number(r.changes);
    }

    rebuildListings();
    d.prepare("INSERT INTO imports(source, started_at, finished_at, stats) VALUES(?,?,?,?)").run(stats.source, startedAt, nowIso(), JSON.stringify({ ...stats, observationsSkipped: stats.observationsSkipped.length }));
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return stats;
}

export interface ObservationInput {
  sourceKey: string;
  productId: string;
  storeId: string;
  raw: RawSnapshot;
  sourceUrl: string;
  sourceKind: string;
  origin: string;
  requestId: string | null;
  capturedAt: string;
}

/** Inserts one normalised observation. Returns its id, or null if this source key was already stored. */
export function insertObservation(o: ObservationInput, n: ReturnType<typeof normalizePrice>, stmt = prepInsert()): number | null {
  const s = o.raw;
  const r = stmt.run(
    o.sourceKey,
    o.productId,
    o.storeId,
    s.price,
    s.regular_price,
    s.lowest_30d,
    n.unitPrice,
    n.unitBase,
    n.offerPrice,
    n.offerUnitPrice,
    s.unit_price,
    s.unit_price_unit,
    s.promo_kind,
    s.promo_label,
    s.promo_valid_from,
    s.promo_valid_to,
    s.loyalty,
    s.multibuy_qty,
    s.multibuy_price,
    JSON.stringify(n.flags),
    o.sourceUrl,
    o.sourceKind,
    o.origin,
    o.requestId,
    o.capturedAt,
    JSON.stringify(s),
  );
  return r.changes ? Number(r.lastInsertRowid) : null;
}

function prepInsert() {
  return db().prepare(
    `INSERT OR IGNORE INTO observations(source_key, product_id, store_id, price, regular_price, lowest_30d, unit_price, unit_base, offer_price, offer_unit_price,
      stated_unit_price, stated_unit, promo_kind, promo_label, promo_valid_from, promo_valid_to, loyalty, multibuy_qty, multibuy_price, flags,
      source_url, source_kind, origin, request_id, captured_at, raw)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
}

/**
 * Listings: first and last time a product was seen at a store scope. A product is "left_offer_page" when
 * a later capture of the same offer page (a store's campaign page, a weekly flyer) no longer contained it.
 * That means the retailer stopped showing the offer online; it says nothing about the physical shelf.
 * Search-result pages are excluded: missing from a later search is not evidence of anything.
 */
export function rebuildListings() {
  const d = db();
  d.exec(`
    DELETE FROM listings;
    INSERT INTO listings(product_id, store_id, first_seen, last_seen)
      SELECT product_id, store_id, MIN(captured_at), MAX(captured_at) FROM observations GROUP BY product_id, store_id;
    WITH pages AS (
      SELECT store_id, source_url, MAX(captured_at) AS latest, COUNT(DISTINCT captured_at) AS captures
      FROM observations
      WHERE source_url LIKE '%kampanjat%' OR source_url LIKE '%tarjous%' OR source_url LIKE '%lidl.fi/c/%'
      GROUP BY store_id, source_url
      HAVING COUNT(DISTINCT product_id) > 1 AND COUNT(DISTINCT captured_at) > 1
    ), last_on_page AS (
      SELECT o.product_id, o.store_id, o.source_url, MAX(o.captured_at) AS seen
      FROM observations o JOIN pages p ON p.store_id = o.store_id AND p.source_url = o.source_url
      GROUP BY o.product_id, o.store_id, o.source_url
    )
    UPDATE listings SET status = 'left_offer_page'
    WHERE EXISTS (
      SELECT 1 FROM last_on_page l JOIN pages p ON p.store_id = l.store_id AND p.source_url = l.source_url
      WHERE l.product_id = listings.product_id AND l.store_id = listings.store_id AND l.seen < p.latest
        AND listings.last_seen = l.seen
    );
  `);
}

/** Imports the bundled export once, when the database is empty (first run of the app). */
export function ensureData() {
  const n = (db().prepare("SELECT COUNT(*) AS n FROM observations").get() as { n: number }).n;
  if (n === 0 && fs.existsSync(DEFAULT_EXPORT)) importExport(DEFAULT_EXPORT);
}
