import fs from "node:fs";
import path from "node:path";
import { db, nowIso } from "./db";
import { brandOf, classify, companyOf, scopeInfo } from "./taxonomy";
import { normalizePrice, promotionOf, resolveSize } from "./normalize";
import { insertObservation, rebuildListings } from "./importer";
import { kruokaStoreHeader, parseKruokaCategory, parseLidlCategory, parseSkaupatCategory, parseWoltCategory, type CategoryListing } from "./parsers/categories";

/**
 * Imports a category-page fetch run (data/raw/<run>/pages-*.jsonl, written by scripts/fetch-confectionery.ts).
 * Every page is kept as captured; this step parses it, checks the page priced the intended store, and
 * appends observations. Idempotent: re-running adds nothing new.
 */

interface Captured {
  itemId: string;
  url: string;
  site: "k-ruoka" | "s-kaupat" | "lidl" | "wolt";
  storeId: string;
  category: string;
  page: number;
  status: "ok" | "error";
  markdown: string | null;
  requestId: string | null;
  capturedAt: string;
}

export interface CategoryImportStats {
  run: string;
  pages: number;
  pagesOk: number;
  pagesSkipped: Record<string, number>;
  stores: number;
  listings: number;
  newProducts: number;
  observationsAdded: number;
  promotions: number;
  bySite: Record<string, { stores: number; listings: number }>;
}

function productCount(c: Captured): number {
  if (c.status !== "ok" || !c.markdown) return -1;
  return parse(c.site, c.markdown).length;
}

function parse(site: Captured["site"], md: string): CategoryListing[] {
  return site === "k-ruoka" ? parseKruokaCategory(md) : site === "s-kaupat" ? parseSkaupatCategory(md) : site === "wolt" ? parseWoltCategory(md) : parseLidlCategory(md);
}

const WOLT_NAMES: Record<string, string> = {
  "wolt-market-kamppi": "Wolt Market Kamppi",
  "wolt-market-deli-kamppi": "Wolt Market Deli Kamppi",
  "wolt-market-hertsi": "Wolt Market Hertsi",
  "wolt-market-kunkku": "Wolt Market Kunkku",
  "wolt-market-vallila": "Wolt Market Vallila",
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function importCategoryRun(run: string): CategoryImportStats {
  const dir = path.join(process.cwd(), "data", "raw", run);
  const files = fs.readdirSync(dir).filter((f) => /^pages-.*\.jsonl$/.test(f));
  // One entry per page; a successful retry replaces an earlier failure.
  const byItem = new Map<string, Captured>();
  for (const f of files.sort())
    for (const l of fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").filter(Boolean)) {
      const c = JSON.parse(l) as Captured;
      const prev = byItem.get(c.itemId);
      if (!prev || productCount(c) > productCount(prev)) byItem.set(c.itemId, c);
    }
  const pages = [...byItem.values()];
  const exp = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "source", "seed-export.json"), "utf8"));
  const storeMeta = new Map<string, Record<string, unknown>>(exp.stores.map((s: Record<string, unknown>) => [String(s.id), s]));
  // Stores added by this run (not in the seed list) bring their own name, address and location.
  const extra = path.join(dir, "stores.json");
  if (fs.existsSync(extra))
    for (const x of JSON.parse(fs.readFileSync(extra, "utf8")) as Record<string, unknown>[])
      storeMeta.set(String(x.scope), { id: x.scope, name: x.name, address: x.address, lat: x.lat, lon: x.lon, city: x.city, chain: x.chain });

  const d = db();
  const st: CategoryImportStats = { run, pages: pages.length, pagesOk: 0, pagesSkipped: {}, stores: 0, listings: 0, newProducts: 0, observationsAdded: 0, promotions: 0, bySite: {} };
  const skip = (why: string) => (st.pagesSkipped[why] = (st.pagesSkipped[why] ?? 0) + 1);

  const upStore = d.prepare(
    `INSERT INTO stores(id, retailer, banner, name, level, address, city, lat, lon, price_note) VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET price_note = COALESCE(stores.price_note, excluded.price_note)`,
  );
  const upBrand = d.prepare("INSERT INTO brands(name, manufacturer, company) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET manufacturer = excluded.manufacturer, company = excluded.company");
  const getProduct = d.prepare("SELECT id, category FROM products WHERE id = ?");
  const insProduct = d.prepare(
    `INSERT INTO products(id, name, brand, brand_source, category, segment, segment_rule, ean, size_value, size_unit, size_source, size_is_range, size_raw, url, image_url, raw)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const promoteProduct = d.prepare("UPDATE products SET category = ?, segment = ?, segment_rule = ? WHERE id = ? AND category = 'Uncategorised'");
  const insPromo = d.prepare(
    `INSERT OR IGNORE INTO promotions(observation_id, product_id, store_id, type, label, offer_price, reference_price, reference_kind, discount_pct, valid_from, valid_to, loyalty, conditions, source_url, captured_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const storesSeen = new Map<string, Set<string>>();

  d.exec("BEGIN");
  try {
    for (const p of pages) {
      if (p.status !== "ok" || !p.markdown) {
        skip("fetch failed");
        continue;
      }
      const meta = storeMeta.get(p.storeId);
      let listings: CategoryListing[];
      if (p.site === "k-ruoka") {
        // The page header names the store whose prices are shown; it must match the requested store.
        // K-Ruoka falls back to its default store (K-Citymarket Iso Omena) for unknown store ids, and
        // some stores trade under another name there ("Pasaati" = Itä-Pasila), so the check is: the page
        // must name a store, and only the Iso Omena page may show "Iso Omena".
        const header = kruokaStoreHeader(p.markdown);
        if (!header || !meta || (norm(header) === "iso omena" && p.storeId !== "kesko-kcm-iso-omena")) {
          skip(header ? "K-Ruoka fell back to its default store" : "K-Ruoka error page");
          continue;
        }
        listings = parseKruokaCategory(p.markdown);
      } else listings = parse(p.site, p.markdown);
      if (!listings.length) {
        skip("no products on page");
        continue;
      }
      st.pagesOk++;

      if (!d.prepare("SELECT 1 FROM stores WHERE id = ?").get(p.storeId)) {
        const info = scopeInfo(p.storeId, meta ? String(meta.chain) : null);
        const addr = (meta?.address as string) ?? null;
        const city = p.site === "wolt" ? "Helsinki" : ((meta?.city as string) ?? addr?.match(/\b(Helsinki|Espoo|Vantaa|Kauniainen)\b/)?.[1] ?? null);
        upStore.run(p.storeId, info.retailer, info.banner, meta ? String(meta.name) : (WOLT_NAMES[p.storeId] ?? p.storeId), info.level, addr, city, (meta?.lat as number) ?? null, (meta?.lon as number) ?? null, null);
      }
      const notes: Record<string, string> = {
        "k-ruoka": "Store-level prices from this store's K-Ruoka category pages",
        "s-kaupat": "Store-level prices from this store's S-kaupat category pages",
        lidl: "Lidl Finland national online range and weekly offers (lidl.fi)",
        wolt: "Venue prices from this Wolt Market's wolt.com category pages (delivery store; no EANs shown)",
      };
      d.prepare("UPDATE stores SET price_note = ? WHERE id = ? AND (price_note IS NULL OR price_note NOT LIKE '%category pages%')").run(notes[p.site], p.storeId);

      const prefix = p.site === "k-ruoka" ? "kesko" : p.site === "s-kaupat" ? "sok" : p.site === "wolt" ? "wolt" : "lidl";
      for (const l of listings) {
        const pid = `${prefix}:${l.sku}`;
        const c = classify(l.name, p.category);
        const existing = getProduct.get(pid) as { id: string; category: string } | undefined;
        if (!existing) {
          const b = brandOf(l.name, l.brand);
          if (b.brand) upBrand.run(b.brand, b.manufacturer, companyOf(b.brand, b.manufacturer));
          const size = resolveSize({ name: l.name, url: l.url });
          insProduct.run(pid, l.name, b.brand, b.source, c.category, c.segment, c.rule, l.ean, size.value, size.unit, size.source, size.isRange ? 1 : 0, size.rawText, l.url || p.url, null, JSON.stringify({ source: p.site, category: p.category, url: l.url }));
          st.newProducts++;
        } else if (existing.category === "Uncategorised" && c.segment) promoteProduct.run(c.category, c.segment, c.rule, pid);

        const prod = d.prepare("SELECT name, url, size_value, size_unit FROM products WHERE id = ?").get(pid) as { name: string; url: string; size_value: number | null; size_unit: string | null };
        const size = resolveSize({ name: prod.name, url: prod.url, size_value: prod.size_value, size_unit: prod.size_unit });
        const obsId = insertObservation(
          { sourceKey: `cat:${run}:${p.storeId}:${pid}`, productId: pid, storeId: p.storeId, raw: l.snapshot, sourceUrl: p.url, sourceKind: "context.dev", origin: `fetch:${run}`, requestId: p.requestId, capturedAt: p.capturedAt },
          normalizePrice(l.snapshot, size),
        );
        st.listings++;
        if (obsId == null) continue;
        st.observationsAdded++;
        (storesSeen.get(p.site) ?? storesSeen.set(p.site, new Set()).get(p.site)!).add(p.storeId);
        st.bySite[p.site] = { stores: 0, listings: (st.bySite[p.site]?.listings ?? 0) + 1 };
        const promo = promotionOf(l.snapshot);
        if (promo) {
          insPromo.run(obsId, pid, p.storeId, promo.type, promo.label, promo.offerPrice, promo.referencePrice, promo.referenceKind, promo.discountPct, promo.validFrom, promo.validTo, promo.loyalty, promo.conditions, p.url, p.capturedAt);
          st.promotions++;
        }
      }
    }
    for (const [site, set] of storesSeen) st.bySite[site].stores = set.size;
    st.stores = [...storesSeen.values()].reduce((n, x) => n + x.size, 0);
    rebuildListings();
    d.prepare("INSERT INTO imports(source, started_at, finished_at, stats) VALUES(?,?,?,?)").run(`data/raw/${run}`, nowIso(), nowIso(), JSON.stringify(st));
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return st;
}
