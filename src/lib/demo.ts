import { db } from "./db";
import { ensureData } from "./importer";
import { creditBudget, creditsSpent, hasContextKey } from "./contextdev";
import { replayablePairs } from "./alerts";

/**
 * Live facts about the dataset and the monitoring pipeline for the Demo & Business Case page.
 * Read-only SQL over the same tables the rest of the app writes; nothing here is hard-coded.
 */

export interface DemoFacts {
  observations: number;
  origins: { origin: string; n: number; first: string; last: string; withRequestId: number }[];
  hosts: { host: string; n: number; pages: number }[];
  pageTypes: { product: number; offer: number; category: number; other: number };
  missingProvenance: number;
  withRequestId: number;
  flagged: number;
  firstCapture: string | null;
  latestCapture: string | null;
  captureTimes: number;
  captureDays: number;
  repeatPairs: number;
  priceChanges: number;
  products: number;
  productsWithEan: number;
  obsWithUnitPrice: number;
  eansAcrossRetailers: number;
  scopes: { store: number; chain: number };
  retailers: number;
  monitors: { origin: string; status: string | null; n: number; lastRun: string | null }[];
  liveMonitors: number;
  events: { origin: string; status: string; n: number }[];
  alerts: { origin: string; n: number }[];
  apiCalls: number;
  apiFailures: number;
  /** Timed fresh Context.dev page reads (scrape), in milliseconds. Empty until one has run. */
  scrapeMs: number[];
  creditsSpent: number;
  creditBudget: number;
  hasKey: boolean;
  replayPairs: number;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "other";
  }
};

/** Product page, offer / flyer / campaign page, category listing, or other, from the URL shape. */
function pageType(url: string): keyof DemoFacts["pageTypes"] {
  if (/\/tuote\//.test(url)) return "product";
  if (/tarjous|kampanja|lidl\.fi\/c\//.test(url)) return "offer";
  if (/\/tuotehaku\/|\/tuotteet\/|lidl\.fi\/h\/|\/items\//.test(url)) return "category";
  return "other";
}

export function demoFacts(): DemoFacts {
  ensureData();
  const d = db();
  const one = <T>(sql: string) => d.prepare(sql).get() as T;
  const all = <T>(sql: string) => d.prepare(sql).all() as T[];

  const origins = all<{ origin: string; n: number; first: string; last: string; withRequestId: number }>(
    "SELECT origin, COUNT(*) AS n, MIN(captured_at) AS first, MAX(captured_at) AS last, SUM(request_id IS NOT NULL AND request_id != '') AS withRequestId FROM observations GROUP BY origin ORDER BY n DESC",
  );
  const urls = all<{ source_url: string; n: number }>("SELECT source_url, COUNT(*) AS n FROM observations GROUP BY source_url");
  const hostMap = new Map<string, { n: number; pages: number }>();
  const pageTypes = { product: 0, offer: 0, category: 0, other: 0 };
  for (const u of urls) {
    const h = hostOf(u.source_url);
    const m = hostMap.get(h) ?? { n: 0, pages: 0 };
    m.n += u.n;
    m.pages += 1;
    hostMap.set(h, m);
    pageTypes[pageType(u.source_url)] += 1;
  }
  const agg = one<{ n: number; first: string | null; last: string | null; times: number; days: number; missing: number; rid: number; flagged: number; unit: number }>(
    `SELECT COUNT(*) AS n, MIN(captured_at) AS first, MAX(captured_at) AS last, COUNT(DISTINCT captured_at) AS times,
            COUNT(DISTINCT substr(captured_at, 1, 10)) AS days,
            SUM(source_url IS NULL OR source_url = '' OR captured_at IS NULL OR captured_at = '') AS missing,
            SUM(request_id IS NOT NULL AND request_id != '') AS rid,
            SUM(flags IS NOT NULL AND flags != '[]') AS flagged,
            SUM(unit_price IS NOT NULL) AS unit
       FROM observations`,
  );
  const repeat = one<{ n: number }>("SELECT COUNT(*) AS n FROM (SELECT 1 FROM observations GROUP BY product_id, store_id HAVING COUNT(DISTINCT captured_at) > 1)");
  const changes = one<{ n: number }>(
    `WITH seq AS (SELECT price, LAG(price) OVER (PARTITION BY product_id, store_id ORDER BY captured_at, id) AS prev FROM observations)
     SELECT COUNT(*) AS n FROM seq WHERE prev IS NOT NULL AND ABS(prev - price) > 0.004`,
  );
  const prod = one<{ n: number; ean: number }>("SELECT COUNT(*) AS n, SUM(ean IS NOT NULL AND ean != '') AS ean FROM products");
  const cross = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (SELECT p.ean FROM observations o JOIN products p ON p.id = o.product_id JOIN stores s ON s.id = o.store_id
      WHERE p.ean IS NOT NULL AND p.ean != '' GROUP BY p.ean HAVING COUNT(DISTINCT s.retailer) > 1)`,
  );
  const levels = all<{ level: string; n: number }>("SELECT level, COUNT(*) AS n FROM stores GROUP BY level");
  const retailers = one<{ n: number }>("SELECT COUNT(DISTINCT retailer) AS n FROM stores");
  const monitors = all<{ origin: string; status: string | null; n: number; lastRun: string | null }>(
    "SELECT origin, status, COUNT(*) AS n, MAX(last_run_at) AS lastRun FROM monitors GROUP BY origin, status ORDER BY origin, status",
  );
  const events = all<{ origin: string; status: string; n: number }>("SELECT origin, status, COUNT(*) AS n FROM monitor_events GROUP BY origin, status ORDER BY origin, status");
  const alerts = all<{ origin: string; n: number }>("SELECT origin, COUNT(*) AS n FROM alerts GROUP BY origin ORDER BY origin");
  const api = one<{ n: number; failed: number | null }>("SELECT COUNT(*) AS n, SUM(ok = 0) AS failed FROM api_usage");

  return {
    observations: agg.n,
    origins,
    hosts: [...hostMap.entries()].map(([host, v]) => ({ host, ...v })).sort((a, b) => b.n - a.n),
    pageTypes,
    missingProvenance: agg.missing ?? 0,
    withRequestId: agg.rid ?? 0,
    flagged: agg.flagged ?? 0,
    firstCapture: agg.first,
    latestCapture: agg.last,
    captureTimes: agg.times,
    captureDays: agg.days,
    repeatPairs: repeat.n,
    priceChanges: changes.n,
    products: prod.n,
    productsWithEan: prod.ean ?? 0,
    obsWithUnitPrice: agg.unit ?? 0,
    eansAcrossRetailers: cross.n,
    scopes: { store: levels.find((l) => l.level === "store")?.n ?? 0, chain: levels.find((l) => l.level === "chain")?.n ?? 0 },
    retailers: retailers.n,
    monitors,
    liveMonitors: monitors.filter((m) => m.origin === "shelfintel").reduce((n, m) => n + m.n, 0),
    events,
    alerts,
    apiCalls: api.n,
    apiFailures: api.failed ?? 0,
    scrapeMs: all<{ ms: number }>("SELECT duration_ms AS ms FROM api_usage WHERE op = 'scrape' AND ok = 1 AND duration_ms IS NOT NULL ORDER BY duration_ms").map((r) => r.ms),
    creditsSpent: creditsSpent(),
    creditBudget: creditBudget(),
    hasKey: hasContextKey(),
    replayPairs: replayablePairs().length,
  };
}
