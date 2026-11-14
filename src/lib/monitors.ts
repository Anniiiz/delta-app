import crypto from "node:crypto";
import { contextClient, hasContextKey, logUsage, scrape } from "./contextdev";
import { db, getSetting, nowIso, setSetting } from "./db";
import { emit } from "./events";
import { insertObservation, rebuildListings } from "./importer";
import { normalizePrice, promotionOf, resolveSize, type RawSnapshot } from "./normalize";
import { parseSkaupatProductHtml } from "./parsers/skaupat";
import { diffObservations, positionShifts, saveAlerts, type ObsLite } from "./alerts";
import { latestRows, DEFAULT_SCOPE } from "./analytics";

/**
 * Context.dev monitoring for Delta.
 *
 * Flow for every detected change (webhook or private polling):
 *   1. verify (HMAC signature for webhooks) and persist the event once (dedupe on its id)
 *   2. re-read the page fresh through Context.dev and extract structured price data
 *   3. normalise into a new observation and store it next to the history
 *   4. diff against the previous observation → alerts only for price / promotion / listing changes
 *   5. push a state event so open dashboards refresh
 * A change Context.dev reports on a page whose extracted price data is unchanged produces no alert.
 */

export type MonitorKind = "skaupat_product" | "generic_product";

export interface MonitorRow {
  id: string;
  name: string;
  target_url: string;
  kind: string;
  product_id: string | null;
  store_id: string | null;
  route_key: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  status: string | null;
  schedule_minutes: number | null;
  last_run_at: string | null;
  last_change_at: string | null;
  origin: string;
  created_at: string;
}

export const listMonitors = (origin?: string) =>
  db()
    .prepare(`SELECT * FROM monitors ${origin ? "WHERE origin = ?" : ""} ORDER BY created_at`)
    .all(...(origin ? [origin] : [])) as unknown as MonitorRow[];

export const publicBaseUrl = () => process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || null;
export const monitorMode = () => (process.env.MONITOR_MODE === "webhook" ? "webhook" : "poll");

const INSTRUCTIONS =
  "Report changes to this product's shelf price, campaign or offer price, multi-buy conditions, loyalty price, offer validity dates, or availability/listing status. " +
  "Ignore recommendations, delivery slots, navigation, cookie banners, reviews, images and layout changes.";

/** S-kaupat store ids for monitored S Group stores (from the storeId on their captured campaign pages). */
export function skaupatStoreId(storeId: string): string | null {
  if (storeId === "sok-prisma-kannelmaki") return "513971200";
  const r = db()
    .prepare("SELECT source_url FROM observations WHERE store_id = ? AND source_url LIKE '%storeId=%' LIMIT 1")
    .get(storeId) as { source_url: string } | undefined;
  return r?.source_url.match(/storeId=(\d+)/)?.[1] ?? null;
}

export interface Recommended {
  productId: string;
  storeId: string;
  name: string;
  url: string;
  kind: MonitorKind;
  reason: string;
}

/** A few real product pages from the dataset worth watching. Creating them costs credits, so it is a button, not automatic. */
export function recommendedMonitors(): Recommended[] {
  const pick = (productId: string, storeId: string, reason: string): Recommended | null => {
    const p = db().prepare("SELECT id, name, url FROM products WHERE id = ?").get(productId) as { id: string; name: string; url: string } | undefined;
    const s = db().prepare("SELECT name FROM stores WHERE id = ?").get(storeId) as { name: string } | undefined;
    if (!p?.url || !s) return null;
    const isS = p.url.includes("s-kaupat.fi/tuote/");
    const sid = isS ? skaupatStoreId(storeId) : null;
    // K-Ruoka product pages price the store named by ?kauppa= (taken from that store's captured category pages).
    const kauppa = p.url.includes("k-ruoka.fi")
      ? ((db().prepare("SELECT source_url FROM observations WHERE store_id = ? AND source_url LIKE '%kauppa=%' LIMIT 1").get(storeId) as { source_url: string } | undefined)?.source_url.match(/kauppa=([^&]+)/)?.[1] ?? null)
      : null;
    const url = isS && sid && storeId !== "sok-prisma-kannelmaki" ? `${p.url}?storeId=${sid}` : kauppa ? `${p.url}?kauppa=${kauppa}` : p.url;
    return { productId, storeId, name: `${p.name} · ${s.name}`, url, kind: isS ? "skaupat_product" : "generic_product", reason };
  };
  return [
    pick("sok:6416453026353", "sok-prisma-kannelmaki", "Fazer's own box: €5.95 at Prisma; was a €4.99 campaign at S Group on 13.11."),
    pick("kesko:6416453026353", "ksupermarket-kamppi", "Same Fazer box at K-Supermarket Kamppi: €5.99"),
    pick("sok:7622202238475", "alepa-kamppi", "Closest competitor tablet; its 5 for €10 multi-buy is stated to end on 15.11."),
  ].filter((x): x is Recommended => x != null && !listMonitors("shelfintel").some((m) => m.product_id === x.productId && m.store_id === x.storeId));
}

export async function createMonitor(r: Recommended, scheduleMinutes = 360): Promise<MonitorRow> {
  const routeKey = crypto.randomBytes(9).toString("base64url");
  const base = publicBaseUrl();
  const webhookUrl = monitorMode() === "webhook" && base ? `${base}/api/webhooks/context/${routeKey}` : null;
  if (monitorMode() === "webhook" && !webhookUrl?.startsWith("https://")) throw new Error("Webhook mode needs PUBLIC_BASE_URL set to a public https URL (e.g. a Cloudflare tunnel).");
  const schedule =
    scheduleMinutes % 60 === 0 ? { type: "interval", frequency: scheduleMinutes / 60, unit: "hours" } : { type: "interval", frequency: Math.max(10, scheduleMinutes), unit: "minutes" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = await contextClient().monitors.create({
    name: `Delta: ${r.name}`.slice(0, 120),
    target: { type: "page", url: r.url, instructions: INSTRUCTIONS },
    schedule,
    ...(webhookUrl ? { webhook: { url: webhookUrl, events: ["change.detected", "run.completed"], retry: {} } } : {}),
    tags: ["shelfintel", r.kind],
  } as never);
  logUsage({ op: "monitor.create", url: r.url, requestId: m.id });
  db()
    .prepare(
      `INSERT INTO monitors(id, name, target_url, kind, product_id, store_id, route_key, webhook_url, webhook_secret, status, schedule_minutes, origin, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'shelfintel',?)`,
    )
    .run(m.id, r.name, r.url, r.kind, r.productId, r.storeId, routeKey, webhookUrl, m.webhook?.secret ?? null, m.status ?? "active", scheduleMinutes, nowIso());
  emit("state", { reason: "monitor_created" });
  return listMonitors().find((x) => x.id === m.id)!;
}

export async function runMonitorNow(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await contextClient().monitors.run(id);
  logUsage({ op: "monitor.run", url: id, requestId: r.run_id });
  return r;
}

export async function deleteMonitor(id: string) {
  await contextClient().monitors.delete(id);
  db().prepare("DELETE FROM monitors WHERE id = ? AND origin = 'shelfintel'").run(id);
  emit("state", { reason: "monitor_deleted" });
}

// ------------------------------------------------------------------ webhook verification

/** HMAC-SHA256 over `${t}.${rawBody}`, header `t=<unix>,v1=<hex>`, 5-minute tolerance (Context.dev docs). */
export function verifySignature(rawBody: Buffer, header: string, secret: string, nowSec = Date.now() / 1000): boolean {
  if (!secret || !header) return false;
  const parts: Record<string, string> = Object.create(null);
  for (const part of header.split(",")) {
    const pair = part.trim().split("=");
    if (pair.length !== 2 || Object.hasOwn(parts, pair[0])) return false;
    parts[pair[0]] = pair[1];
  }
  if (!/^[0-9]{1,12}$/.test(parts.t ?? "") || !/^[a-f0-9]{64}$/i.test(parts.v1 ?? "")) return false;
  if (Math.abs(nowSec - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.`).update(rawBody).digest();
  const actual = Buffer.from(parts.v1, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export const monitorByRoute = (routeKey: string) =>
  (db().prepare("SELECT * FROM monitors WHERE route_key = ? AND origin = 'shelfintel'").get(routeKey) as unknown as MonitorRow | undefined) ?? null;

export function persistEventOnce(ev: { id: string; event: string }, monitorId: string, raw: string): boolean {
  return db().prepare("INSERT OR IGNORE INTO monitor_events(id, monitor_id, event, payload, received_at) VALUES(?,?,?,?,?)").run(ev.id, monitorId, ev.event, raw, nowIso()).changes > 0;
}

// ------------------------------------------------------------------ fresh extraction

const PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    product_name: { type: ["string", "null"] },
    shelf_price_eur: { type: ["number", "null"], description: "Price of one pack as shown, in euros" },
    regular_price_eur: { type: ["number", "null"], description: "Regular price, only if the page states one" },
    offer_text: { type: ["string", "null"], description: "Offer conditions as written, e.g. '4 for 10 €' or 'Plussa price'" },
    multibuy_qty: { type: ["integer", "null"] },
    multibuy_total_eur: { type: ["number", "null"] },
    offer_valid_until: { type: ["string", "null"], description: "ISO date the offer ends, if stated" },
    available_online: { type: ["boolean", "null"] },
  },
};

/** Re-reads the monitored page fresh and returns a raw snapshot in the same shape as the imported data. */
async function extractFresh(m: MonitorRow): Promise<{ raw: RawSnapshot; requestId: string | null; capturedAt: string } | { listed: false; requestId: string | null; capturedAt: string }> {
  if (m.kind === "skaupat_product") {
    const res = await scrape({ url: m.target_url, html: true, waitForMs: 1500, maxAgeMs: 0 });
    const p = res.html ? parseSkaupatProductHtml(res.html, m.target_url) : null;
    if (!p) return { listed: false, requestId: res.requestId, capturedAt: res.capturedAt };
    const campaign = p.campaignPrice != null && p.regularPrice != null && p.campaignPrice < p.regularPrice;
    return {
      requestId: res.requestId,
      capturedAt: res.capturedAt,
      raw: {
        price: p.currentPrice,
        regular_price: p.regularPrice,
        lowest_30d: p.lowest30DayPrice,
        unit_price: p.comparisonPrice,
        unit_price_unit: p.comparisonUnit,
        promo_kind: campaign ? "campaign" : null,
        promo_label: campaign ? `Campaign €${p.campaignPrice!.toFixed(2)}` : null,
        promo_valid_from: null,
        promo_valid_to: campaign ? p.campaignValidUntil : null,
        loyalty: null,
        multibuy_qty: null,
        multibuy_price: null,
      },
    };
  }
  const res = await scrape({ url: m.target_url, json: { schema: PRODUCT_SCHEMA, instructions: "Extract the price and offer of the single product on this page. Use null for anything not stated." }, maxAgeMs: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = res.json ?? {};
  if (j.available_online === false || j.shelf_price_eur == null) return { listed: false, requestId: res.requestId, capturedAt: res.capturedAt };
  const mb = j.multibuy_qty && j.multibuy_total_eur ? { q: j.multibuy_qty, t: j.multibuy_total_eur } : null;
  return {
    requestId: res.requestId,
    capturedAt: res.capturedAt,
    raw: {
      price: j.shelf_price_eur,
      regular_price: j.regular_price_eur ?? null,
      lowest_30d: null,
      unit_price: null,
      unit_price_unit: null,
      promo_kind: mb ? "multibuy" : j.offer_text ? "campaign" : null,
      promo_label: mb ? `${mb.q} for €${Number(mb.t).toFixed(2)}` : j.offer_text ?? null,
      promo_valid_from: null,
      promo_valid_to: j.offer_valid_until ?? null,
      loyalty: null,
      multibuy_qty: mb?.q ?? null,
      multibuy_price: mb?.t ?? null,
    },
  };
}

function previousObs(productId: string, storeId: string): ObsLite | null {
  const r = db()
    .prepare("SELECT price, unit_price, promo_kind, promo_label, promo_valid_to, captured_at, source_url FROM observations WHERE product_id = ? AND store_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1")
    .get(productId, storeId) as Record<string, unknown> | undefined;
  return r
    ? { price: r.price as number, unitPrice: (r.unit_price as number) ?? null, promoKind: (r.promo_kind as string) ?? null, promoLabel: (r.promo_label as string) ?? null, validTo: (r.promo_valid_to as string) ?? null, capturedAt: r.captured_at as string, sourceUrl: r.source_url as string }
    : null;
}

const processing = new Set<string>();

export async function processEvent(eventId: string) {
  if (processing.has(eventId)) return;
  processing.add(eventId);
  const d = db();
  try {
    const row = d.prepare("SELECT * FROM monitor_events WHERE id = ?").get(eventId) as { monitor_id: string; event: string; payload: string; status: string } | undefined;
    if (!row || row.status !== "pending") return;
    const ev = JSON.parse(row.payload);
    const mon = listMonitors("shelfintel").find((m) => m.id === row.monitor_id);
    if (!mon || !mon.product_id || !mon.store_id) throw new Error("Unknown monitor");
    const change = ev.data?.change;
    const run = ev.data?.run;
    d.prepare("UPDATE monitors SET last_run_at = ?, status = 'active' WHERE id = ?").run(run?.completed_at ?? ev.created_at ?? nowIso(), mon.id);
    if (ev.event === "run.completed") {
      d.prepare("UPDATE monitor_events SET status = ?, processed_at = ?, outcome = ? WHERE id = ?").run(
        change ? "ignored" : "processed",
        nowIso(),
        JSON.stringify({ note: change ? "Handled by change.detected" : run?.baseline_created ? "Baseline captured" : "Checked: no relevant change" }),
        eventId,
      );
      emit("state", { reason: "monitor_check" });
      return;
    }
    d.prepare("UPDATE monitors SET last_change_at = ? WHERE id = ?").run(change?.detected_at ?? nowIso(), mon.id);

    // Never trust the page diff alone: re-extract structured prices and compare.
    const before = previousObs(mon.product_id, mon.store_id);
    const rowsBefore = latestRows(DEFAULT_SCOPE);
    const fresh = await extractFresh(mon);
    const product = d.prepare("SELECT * FROM products WHERE id = ?").get(mon.product_id) as Record<string, unknown>;
    const store = d.prepare("SELECT name FROM stores WHERE id = ?").get(mon.store_id) as { name: string };
    const ctx = { productId: mon.product_id, name: product.name as string, brand: (product.brand as string) ?? null, segment: (product.segment as string) ?? null, category: product.category as string, storeId: mon.store_id, storeName: store.name };
    let after: ObsLite | null = null;
    if ("raw" in fresh) {
      const size = resolveSize({ name: product.name as string, url: product.url as string, size_value: product.size_value as number | null, size_unit: product.size_unit as string | null });
      const obsId = insertObservation(
        { sourceKey: `monitor:${eventId}`, productId: mon.product_id, storeId: mon.store_id, raw: fresh.raw, sourceUrl: mon.target_url, sourceKind: "context.dev", origin: "monitor", requestId: fresh.requestId, capturedAt: fresh.capturedAt },
        normalizePrice(fresh.raw, size),
      );
      const promo = promotionOf(fresh.raw);
      if (obsId && promo)
        d.prepare(
          `INSERT OR IGNORE INTO promotions(observation_id, product_id, store_id, type, label, offer_price, reference_price, reference_kind, discount_pct, valid_from, valid_to, loyalty, conditions, source_url, captured_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(obsId, mon.product_id, mon.store_id, promo.type, promo.label, promo.offerPrice, promo.referencePrice, promo.referenceKind, promo.discountPct, promo.validFrom, promo.validTo, promo.loyalty, promo.conditions, mon.target_url, fresh.capturedAt);
      after = previousObs(mon.product_id, mon.store_id);
      rebuildListings();
    }
    const rowsAfter = latestRows(DEFAULT_SCOPE);
    const drafts = [...diffObservations(ctx, before, after, rowsAfter), ...positionShifts(rowsBefore, rowsAfter, fresh.capturedAt, mon.target_url)];
    const saved = saveAlerts(drafts, "monitor", eventId);
    d.prepare("UPDATE monitor_events SET status = 'processed', processed_at = ?, outcome = ? WHERE id = ?").run(
      nowIso(),
      JSON.stringify({ summary: change?.summary ?? change?.title ?? null, alerts: saved, verdict: drafts.length ? "relevant" : "page changed, prices unchanged: no alert" }),
      eventId,
    );
    emit("state", { reason: "monitor_change" });
  } catch (e) {
    d.prepare("UPDATE monitor_events SET status = 'error', error = ?, processed_at = ? WHERE id = ?").run(e instanceof Error ? e.message : String(e), nowIso(), eventId);
    emit("state", { reason: "monitor_error" });
  } finally {
    processing.delete(eventId);
  }
}

/** Private mode: ask Context.dev for changes on our monitors (management API, no credits) and run them through the same pipeline. */
export async function pollChanges(): Promise<number> {
  if (!hasContextKey()) return 0;
  const ours = new Map(listMonitors("shelfintel").map((m) => [m.id, m]));
  if (!ours.size) return 0;
  const since = getSetting<string | null>("poll_since", null) ?? new Date(Date.now() - 3600_000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await contextClient().monitors.listAccountChanges({ since, limit: 50, tag: "shelfintel" } as never);
  let n = 0;
  let newest = since;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const change of [...(res.data ?? [])].reverse() as any[]) {
    if (!ours.has(change.monitor_id)) continue;
    if (change.detected_at > newest) newest = change.detected_at;
    const ev = { id: `poll:${change.id}`, event: "change.detected", created_at: change.detected_at, data: { change } };
    if (persistEventOnce(ev, change.monitor_id, JSON.stringify(ev))) {
      await processEvent(ev.id);
      n++;
    }
  }
  for (const m of ours.values()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await contextClient().monitors.retrieve(m.id);
      db().prepare("UPDATE monitors SET status = ?, last_run_at = ?, last_change_at = COALESCE(?, last_change_at) WHERE id = ?").run(r.status ?? null, r.last_run_at ?? null, r.last_change_at ?? null, m.id);
    } catch {
      /* keep last known status */
    }
  }
  setSetting("poll_since", newest);
  setSetting("last_poll", nowIso());
  emit("state", { reason: "poll" });
  return n;
}

const g = globalThis as unknown as { __sipoll?: ReturnType<typeof setInterval> };
export function startPoller(intervalMs = 60_000) {
  if (g.__sipoll || !hasContextKey()) return;
  g.__sipoll = setInterval(() => pollChanges().catch((e) => console.error("[shelfintel] poll failed:", e instanceof Error ? e.message : e)), intervalMs);
}
