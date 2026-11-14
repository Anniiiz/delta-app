import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Single-file SQLite store (Node's built-in node:sqlite, no native dependencies).
 * Tables map one-to-one to Postgres tables, so the same model moves to Supabase for a hosted deployment.
 */
const DB_PATH = process.env.SHELFINTEL_DB ?? path.join(process.cwd(), "data", "shelfintel.db");

const g = globalThis as unknown as { __sidb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__sidb) return g.__sidb;
  if (DB_PATH !== ":memory:") fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  migrate(d);
  g.__sidb = d;
  return d;
}

export const nowIso = () => new Date().toISOString();

function migrate(d: DatabaseSync) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS brands (
    name TEXT PRIMARY KEY,
    manufacturer TEXT,              -- curated reference data, null when unknown
    company TEXT NOT NULL           -- manufacturer, or the brand itself
  );

  CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,            -- store id, or 'chain:<banner>' for chain-wide offer feeds
    retailer TEXT NOT NULL,         -- 'S Group' | 'Kesko' | 'Lidl'
    banner TEXT NOT NULL,           -- 'Prisma' | 'S-market' | 'K-Supermarket' | ...
    name TEXT NOT NULL,
    level TEXT NOT NULL,            -- 'store' (prices for one location) | 'chain' (chain-wide offers)
    address TEXT,
    city TEXT,
    lat REAL,
    lon REAL,
    price_note TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,            -- '<retailer>:<ean or sku>' as captured
    name TEXT NOT NULL,
    brand TEXT REFERENCES brands(name),
    brand_source TEXT,              -- 'name' | 'retailer'
    category TEXT NOT NULL,
    segment TEXT,                   -- comparison group
    segment_rule TEXT,
    ean TEXT,
    size_value REAL,
    size_unit TEXT,
    size_source TEXT,
    size_is_range INTEGER NOT NULL DEFAULT 0,
    size_raw TEXT,
    url TEXT,
    image_url TEXT,
    raw TEXT NOT NULL               -- original product record as exported
  );
  CREATE INDEX IF NOT EXISTS idx_products_segment ON products(category, segment);

  -- One row per product listed at a store scope; first/last seen across observations.
  CREATE TABLE IF NOT EXISTS listings (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id TEXT NOT NULL REFERENCES stores(id),
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'listed',   -- 'listed' | 'left_offer_page' (missing from a later capture of the same offer page)
    PRIMARY KEY (product_id, store_id)
  );

  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL UNIQUE,         -- dedupe key, e.g. 'seed:1234' or 'monitor:<event>:<product>'
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id TEXT NOT NULL REFERENCES stores(id),
    price REAL NOT NULL,
    regular_price REAL,
    lowest_30d REAL,
    unit_price REAL,                          -- computed €/kg, €/l or €/pcs (null when not comparable)
    unit_base TEXT,
    offer_price REAL,
    offer_unit_price REAL,
    stated_unit_price REAL,
    stated_unit TEXT,
    promo_kind TEXT,
    promo_label TEXT,
    promo_valid_from TEXT,
    promo_valid_to TEXT,
    loyalty TEXT,
    multibuy_qty INTEGER,
    multibuy_price REAL,
    flags TEXT NOT NULL DEFAULT '[]',
    source_url TEXT NOT NULL,
    source_kind TEXT NOT NULL,               -- 'context.dev' (all imported rows)
    origin TEXT NOT NULL,                    -- 'import:seed' | 'monitor' | 'replay'
    request_id TEXT,
    captured_at TEXT NOT NULL,
    raw TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_obs_ps ON observations(product_id, store_id, captured_at);

  CREATE TABLE IF NOT EXISTS promotions (
    observation_id INTEGER PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    type TEXT NOT NULL,                      -- campaign | multibuy | loyalty
    label TEXT,
    offer_price REAL NOT NULL,
    reference_price REAL,
    reference_kind TEXT,                     -- regular | lowest_30d
    discount_pct REAL,
    valid_from TEXT,
    valid_to TEXT,
    loyalty TEXT,
    conditions TEXT,
    source_url TEXT NOT NULL,
    captured_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,                     -- Context.dev mon_ id
    name TEXT NOT NULL,
    target_url TEXT NOT NULL,
    kind TEXT NOT NULL,                      -- 'skaupat_product' | 'generic_product'
    product_id TEXT,
    store_id TEXT,
    route_key TEXT,
    webhook_url TEXT,
    webhook_secret TEXT,
    status TEXT,
    schedule_minutes INTEGER,
    last_run_at TEXT,
    last_change_at TEXT,
    origin TEXT NOT NULL DEFAULT 'shelfintel',  -- 'shelfintel' | 'seed' (history imported read-only)
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS monitor_events (
    id TEXT PRIMARY KEY,                     -- X-Context-Id / poll:<change id>; dedupe key
    monitor_id TEXT,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | processed | ignored | error
    outcome TEXT,
    origin TEXT NOT NULL DEFAULT 'shelfintel',
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,          -- price_decrease | price_increase | promo_started | promo_ended | not_shown | position_changed
    product_id TEXT,
    store_id TEXT,
    brand TEXT,
    segment TEXT,
    title TEXT NOT NULL,
    why TEXT,
    before TEXT,                 -- JSON: previous observation summary
    after TEXT,                  -- JSON: updated observation summary
    magnitude REAL,              -- relative change, e.g. -0.12
    priority INTEGER NOT NULL DEFAULT 0,
    source_url TEXT,
    origin TEXT NOT NULL,        -- 'monitor' | 'replay'
    event_id TEXT,
    created_at TEXT NOT NULL,
    observed_at TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    UNIQUE(kind, product_id, store_id, observed_at, origin)
  );

  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    stats TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    op TEXT NOT NULL,
    url TEXT,
    credits REAL,
    credits_remaining REAL,
    request_id TEXT,
    ok INTEGER NOT NULL DEFAULT 1,
    error TEXT
  );
  `);
  // Request timing for the latency figures (added after the first release, so migrate existing files).
  const cols = d.prepare("PRAGMA table_info(api_usage)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "duration_ms")) d.exec("ALTER TABLE api_usage ADD COLUMN duration_ms REAL");
}

export function getSetting<T>(key: string, fallback: T): T {
  const r = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!r) return fallback;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  db().prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
