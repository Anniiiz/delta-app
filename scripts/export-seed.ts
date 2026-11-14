/**
 * Copies the real retailer data that an earlier capture run collected through Context.dev into Delta.
 *
 *   npm run data:export            # reads ../seed/seed.db (read-only)
 *   npm run data:export -- <path>  # another capture database
 *
 * Writes data/source/seed-export.json. Nothing is fetched from the web and nothing is invented:
 * every row is copied as stored, including its source URL, Context.dev request id and capture time.
 * Webhook signing secrets are never exported.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const src = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "..", "..", "seed", "seed.db"));
const out = path.join(import.meta.dirname, "..", "data", "source", "seed-export.json");
if (!fs.existsSync(src)) {
  console.error(`Seed database not found: ${src}`);
  process.exit(1);
}

const db = new DatabaseSync(src, { readOnly: true });
const all = (sql: string) => db.prepare(sql).all();

const payload = {
  format: "seed-export/v1",
  exported_at: new Date().toISOString(),
  source_database: path.relative(path.join(import.meta.dirname, ".."), src),
  stores: all("SELECT * FROM stores ORDER BY id"),
  products: all("SELECT * FROM products ORDER BY id"),
  price_snapshots: all("SELECT * FROM price_snapshots ORDER BY id"),
  monitors: all("SELECT id, name, target_url, purpose, product_id, status, last_run_at, last_change_at, created_at, schedule_minutes FROM monitors ORDER BY created_at"),
  monitor_events: all("SELECT id, monitor_id, event, payload, received_at, processed_at, status FROM monitor_events ORDER BY received_at"),
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload));
console.log(
  `Exported ${payload.products.length} products, ${payload.stores.length} stores, ${payload.price_snapshots.length} price snapshots, ` +
    `${payload.monitor_events.length} monitor events → ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`,
);
