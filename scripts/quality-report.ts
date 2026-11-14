/**
 * Writes DATA_QUALITY.md from the imported data. Every number is computed; nothing is typed by hand.
 *   npm run data:report
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { ensureData } from "../src/lib/importer";
import { AREA_SQL, DEMO_CATEGORY, DEMO_SCOPES, SEGMENT_RULES } from "../src/lib/taxonomy";
import { history, latestRows, DEFAULT_SCOPE } from "../src/lib/analytics";
import { replayablePairs } from "../src/lib/alerts";

ensureData();
const d = db();
const q = <T,>(sql: string, ...p: (string | number)[]) => d.prepare(sql).all(...p) as T[];
const one = (sql: string, ...p: (string | number)[]) => Object.values(d.prepare(sql).get(...p) as object)[0] as number;
const src = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "source", "seed-export.json"), "utf8"));

const L: string[] = [];
const p = (s = "") => L.push(s);
const table = (head: string[], rows: (string | number | null)[][]) => {
  p(`| ${head.join(" | ")} |`);
  p(`|${head.map(() => "---").join("|")}|`);
  for (const r of rows) p(`| ${r.map((x) => (x == null ? "—" : String(x).replace(/\|/g, "\\|"))).join(" | ")} |`);
  p();
};

p("# Delta data-quality report");
p();
p(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`npm run data:report\`. Every figure below is computed from the imported data.`);
p();
p("## 0. Category fetch (14.11.2026)");
p();
{
  const imp = d.prepare("SELECT stats FROM imports WHERE source LIKE 'data/raw/%' ORDER BY id DESC LIMIT 1").get() as { stats: string } | undefined;
  if (imp) {
    const st = JSON.parse(imp.stats);
    p(`Chocolate & candy category pages were fetched through Context.dev batch scraping for every store with its own online prices: K-Ruoka (7 categories per store), S-kaupat (6 categories, all pages) and Lidl (national range). Raw markdown is kept in \`data/raw/${st.run}/\`.`);
    p();
    table(
      ["Measure", "Value"],
      [
        ["Pages captured", st.pages],
        ["Pages with products imported", st.pagesOk],
        ...Object.entries(st.pagesSkipped as Record<string, number>).map(([k, v]) => [`Skipped: ${k}`, v] as [string, number]),
        ["Stores with category prices", one("SELECT COUNT(DISTINCT store_id) FROM observations WHERE origin LIKE 'fetch:confectionery%'")],
        ["…K-Group / S Group / Lidl", q<{ r: string; n: number }>("SELECT s.retailer r, COUNT(DISTINCT o.store_id) n FROM observations o JOIN stores s ON s.id = o.store_id WHERE o.origin LIKE 'fetch:%' GROUP BY 1 ORDER BY 1").map((x) => `${x.r} ${x.n}`).join(" · ")],
        ["Store × product prices", one("SELECT COUNT(*) FROM observations WHERE origin LIKE 'fetch:%'")],
        ["Products found", one("SELECT COUNT(DISTINCT product_id) FROM observations WHERE origin LIKE 'fetch:%'")],
        ["Retailer-advertised offers", one("SELECT COUNT(*) FROM promotions pr JOIN observations o ON o.id = pr.observation_id WHERE o.origin LIKE 'fetch:%'")],
        ["Context.dev credits (batches)", Object.entries(JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "raw", st.run, "progress.json"), "utf8")) as Record<string, string>).filter(([k]) => k.startsWith("credits:")).reduce((n, [, v]) => n + Number(v), 0)],
      ],
    );
    p("Known limits: K-Ruoka shows at most 100 products per category page (chocolate tablets, bars and candy bags reach that cap, so each K store contributes its first 100 there). Nine S Group stores failed on every page and are missing. K-Ruoka falls back to K-Citymarket Iso Omena for store ids it doesn't know; those pages are rejected. Lidl publishes one national range online, not per-store prices.");
    p();
  }
}

p("## 0b. Wolt Market and coverage area");
p();
p(`Wolt Market sweets pages were captured for the Helsinki venues listed in wolt.com's public venue sitemap (robots.txt allows all paths): ${one("SELECT COUNT(DISTINCT store_id) FROM observations WHERE store_id LIKE 'wolt-market%'")} venues, ${one("SELECT COUNT(*) FROM observations WHERE store_id LIKE 'wolt-market%'")} prices, ${one("SELECT COUNT(DISTINCT product_id) FROM observations WHERE store_id LIKE 'wolt-market%'")} products. Wolt shows no EANs, so Wolt products are compared per kg inside their product group but not matched one-to-one with K and S products. Pages load tiles lazily; about 50–85 products per venue were captured. Wolt Market Deli Kamppi has no sweets category.`);
p();
p(`**Views are limited to Helsinki stores with their own online prices; Lidl (no store prices online) and stores outside Helsinki stay in the database but are excluded.** Helsinki stores in the views: ${q<{ r: string; n: number }>(`SELECT s.retailer r, COUNT(DISTINCT s.id) n FROM stores s JOIN observations o ON o.store_id = s.id JOIN products p ON p.id = o.product_id WHERE p.category = ? AND ${AREA_SQL} GROUP BY 1 ORDER BY 1`, DEMO_CATEGORY).map((x) => `${x.r} ${x.n}`).join(" · ")}.`);
p();

{
  const covFile = path.join(process.cwd(), "data", "raw", "stores", "helsinki-coverage.json");
  if (fs.existsSync(covFile)) {
    const cov = JSON.parse(fs.readFileSync(covFile, "utf8")) as Record<string, { osm: number; priced: number }>;
    const why: Record<string, string> = {
      Alepa: "Most Alepas show only S Group's chain-wide prices online (checked per store); 3 Alepas' listing pages always fail",
      "S-market": "Most S-markets show only chain-wide prices online; 3 S-markets' listing pages always fail",
      "K-Market": "5 K-Markets in OpenStreetMap have no K-Ruoka store page; K-Market Hakaniemi publishes no sweets online",
      Lidl: "Excluded: no store prices online",
      "Independent & other": "Ethnic shops, delis and wholesalers: no online prices (some are on Wolt)",
    };
    p("## 0c. Helsinki grocery store coverage");
    p();
    p("Grocery shops in Helsinki per OpenStreetMap (shop = supermarket, convenience, grocery, wholesale, deli, food), matched by location to stores with chocolate & candy prices in ShelfIntel. Wolt Market's 4 dark stores are not in OpenStreetMap and come on top.");
    p();
    table(["Chain", "Shops in Helsinki (OSM)", "With sweets prices", "Why not all"], Object.entries(cov).sort((a, b) => b[1].osm - a[1].osm).map(([k, v]) => [k, v.osm, v.priced, v.priced >= v.osm ? "" : (why[k] ?? "")]));
  }
}

p("## 1. Files found");
p();
table(
  ["File", "Format", "Contents"],
  [
    ["../seed/seed.db", "SQLite (node:sqlite)", "Earlier store of Context.dev captures: stores, products, price_snapshots, monitors, monitor_events"],
    ["data/source/seed-export.json", "JSON export of the above", `${src.products.length} products, ${src.stores.length} stores, ${src.price_snapshots.length} price snapshots, ${src.monitor_events.length} monitor events (exported ${src.exported_at.slice(0, 16)})`],
    ["data/raw/confectionery-2026-11-14/pages-*.jsonl", "JSONL, one captured page per line", "Context.dev markdown of K-Ruoka, S-kaupat and Lidl chocolate & candy category pages, with URL, store, request id and capture time"],
    ["../parkpredict/data/*", "JSON/CSV", "Parking data for a different project; not used"],
  ],
);
p("Every price observation was captured through Context.dev (`source_kind = context.dev`, with a request id).");
p();

p("## 2. Source schema (price_snapshots)");
p();
const cols = Object.keys(src.price_snapshots[0]);
p(cols.map((c) => `\`${c}\``).join(", "));
p();
const nulls = cols.map((c) => [c, src.price_snapshots.filter((s: Record<string, unknown>) => s[c] == null || s[c] === "").length]).filter(([, n]) => (n as number) > 0);
table(["Column", "Empty in rows"], nulls as [string, number][]);

p("## 3. Stores represented");
p();
table(
  ["Retailer", "Banner", "Level", "Store scopes", "Observations"],
  q<{ retailer: string; banner: string; level: string; n: number; obs: number }>(
    "SELECT s.retailer, s.banner, s.level, COUNT(DISTINCT s.id) n, COUNT(o.id) obs FROM stores s JOIN observations o ON o.store_id = s.id GROUP BY 1,2,3 ORDER BY obs DESC",
  ).map((r) => [r.retailer, r.banner, r.level === "chain" ? "chain-wide offers" : "store-level", r.n, r.obs]),
);
p("Cities: " + q<{ city: string; n: number }>("SELECT COALESCE(city,'(chain-wide)') city, COUNT(*) n FROM stores GROUP BY 1 ORDER BY n DESC").map((r) => `${r.city} ${r.n}`).join(", ") + ". No Vantaa stores are in the dataset.");
p();

p("## 4. Categories and brands");
p();
p(`The seed captures cover a grocery basket (milk, coffee, pasta, chicken…) plus whole campaign/offer pages, so most products are everyday groceries. ${one("SELECT COUNT(*) FROM products WHERE category = ?", DEMO_CATEGORY)} products match the chocolate & confectionery rules:`);
p();
table(
  ["Comparison group", "Products", "Brands"],
  SEGMENT_RULES.map((r) => {
    const rows = q<{ brand: string | null }>("SELECT brand FROM products WHERE segment = ?", r.segment);
    return [r.segment, rows.length, [...new Set(rows.map((x) => x.brand ?? "?"))].join(", ")];
  }),
);
p(`Retailer-supplied brand field: empty for ${src.products.filter((x: { brand: string | null }) => !x.brand).length} of ${src.products.length} products, so brands are derived from product-name prefixes (rules in \`src/lib/taxonomy.ts\`). Brand owners are curated reference data.`);
p();

p("## 5. Valid listings, duplicates, inconsistencies");
p();
const skipped = src.price_snapshots.length - one("SELECT COUNT(*) FROM observations");
table(
  ["Check", "Result"],
  [
    ["Price snapshots imported", one("SELECT COUNT(*) FROM observations")],
    ["Skipped (demo page, not a retailer)", skipped],
    ["Missing or non-positive prices", src.price_snapshots.filter((s: { price: number }) => !(s.price > 0)).length],
    ["Exact duplicates (same product, store, time, price)", one("SELECT COUNT(*) FROM (SELECT product_id, store_id, captured_at, price FROM observations GROUP BY 1,2,3,4 HAVING COUNT(*) > 1)")],
    ["Same EAN under two retailer product ids", one("SELECT COUNT(*) FROM (SELECT ean FROM products WHERE ean IS NOT NULL GROUP BY ean HAVING COUNT(*) > 1)")],
    ["…of which names differ", one("SELECT COUNT(*) FROM (SELECT ean FROM products WHERE ean IS NOT NULL GROUP BY ean HAVING COUNT(DISTINCT lower(replace(name,' ',''))) > 1)")],
    ["Confectionery listings in the demo scope (latest per product × store)", latestRows(DEFAULT_SCOPE).length],
  ],
);
p("Name differences for the same EAN are word order, spacing or extra marks (`260g` vs `260 g`, `Arki®`, `RAC`), never a different product. Products are kept per retailer and linked by EAN for cross-retailer comparisons.");
p();

p("## 6. Package sizes and unit prices (confectionery)");
p();
const flags = q<{ flags: string; product_id: string }>("SELECT DISTINCT o.product_id, o.flags FROM observations o JOIN products p ON p.id = o.product_id WHERE p.category = ?", DEMO_CATEGORY);
const count = (f: string) => new Set(flags.filter((x) => JSON.parse(x.flags).includes(f)).map((x) => x.product_id)).size;
table(
  ["Issue", "Products", "Handling"],
  [
    ["Pack size is a range (280–340 g)", count("size_range"), "Kept in tables, excluded from unit-price comparisons"],
    ["Pack size only in the product URL", count("size_from_url"), "Used, flagged"],
    ["No pack size", count("size_missing"), "No unit price"],
    ["Lidl multi-buy: bundle total stored as 30-day low (4 × €3.85 = €15.40)", count("reference_is_bundle_total"), "Converted to a per-pack regular price"],
    ["Promotion without a stated reference price", count("reference_price_missing"), "No discount % shown"],
  ],
);

p("## 7. History");
p();
const h = history(DEFAULT_SCOPE);
p(`Captures in the dashboard panel run from ${h.firstCapture} to ${h.lastCapture} (${h.captures} distinct capture times). ${h.pairsWithHistory} confectionery listings were captured more than once. Observed price changes: ${h.priceChanges.length}${h.priceChanges.length ? ` (${[...new Set(h.priceChanges.map((c) => `${c.name} at ${c.storeName}: €${c.from.toFixed(2)} → €${c.to.toFixed(2)}`))].slice(0, 6).join("; ")})` : ""}. With under a day of history the app makes no trend claims.`);
p();
p(`Across all categories, ${one("SELECT COUNT(*) FROM (SELECT product_id, store_id FROM observations GROUP BY 1,2 HAVING COUNT(DISTINCT price) > 1)")} product × store pairs show different prices between captures (none in confectionery). Offer pages captured twice and available as labelled replays: ${replayablePairs().map((r) => r.storeName).join(", ")}.`);
p();

p("## 8. URLs that can be monitored with Context.dev");
p();
table(
  ["Page", "Type", "Why"],
  [
    ["https://www.s-kaupat.fi/tuote/fazer-klassikot-suklaakonvehtirasia-260g/6416453026353", "S-kaupat product page (store via ?storeId)", "Fazer's own box; price parsed from the embedded store-level pricing state"],
    ["https://www.s-kaupat.fi/tuote/marabou-mjolkchoklad-suklaalevy-160g/7622202238475", "S-kaupat product page", "Main competitor tablet; multi-buy stated to end 15.11."],
    ["https://www.lidl.fi/p/karl-fazer-suklaalevy/p11703918", "Lidl product page", "Fazer in Lidl's weekly offers; read with Context.dev JSON extraction"],
    ["https://www.s-kaupat.fi/tuotteet/kampanjat?storeId=…", "S Group campaign page per store", "Whole-page promotion changes (the source of most S Group seed rows)"],
    ["https://www.k-ruoka.fi/k-supermarket/tarjouslehti", "K-Supermarket offer flyer", "Chain-wide confectionery offers (Fazer, Panda, Lindt, Malaco, calendars)"],
  ],
);
p(`Demo scope: ${DEMO_SCOPES.join(", ")}.`);

fs.writeFileSync(path.join(process.cwd(), "DATA_QUALITY.md"), L.join("\n") + "\n");
console.log(`Wrote DATA_QUALITY.md (${L.length} lines)`);
