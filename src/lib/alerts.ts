import { db, nowIso } from "./db";
import { latestRows, median, positioning, companies, DEFAULT_SCOPE, type Row } from "./analytics";
import { DEMO_CATEGORY, DEMO_SCOPES, segmentBasis } from "./taxonomy";
import { emit } from "./events";

/**
 * Change → alert engine. Compares an updated observation with the previous one for the same product at
 * the same store and creates alerts only for commercially relevant differences:
 * shelf price moves, verified promotions starting or ending, offers no longer shown, and shifts in a
 * company's relative price position. Everything else (layout, copy, images) never reaches this code,
 * because alerts are built from re-extracted structured prices, not from page diffs.
 */

export type AlertKind = "price_decrease" | "price_increase" | "promo_started" | "promo_ended" | "left_offer_page" | "position_changed";

export interface ObsLite {
  price: number;
  unitPrice: number | null;
  promoKind: string | null;
  promoLabel: string | null;
  validTo: string | null;
  capturedAt: string;
  sourceUrl: string;
}

interface ProductCtx {
  productId: string;
  name: string;
  brand: string | null;
  segment: string | null;
  category: string;
  storeId: string;
  storeName: string;
}

export interface AlertDraft {
  kind: AlertKind;
  ctx: ProductCtx;
  title: string;
  why: string;
  before: ObsLite | null;
  after: ObsLite | null;
  magnitude: number | null;
  priority: number;
  observedAt: string;
  sourceUrl: string;
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : `€${n.toFixed(2)}`);
const pct = (x: number) => `${x > 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

function segmentMedian(rows: Row[], segment: string | null, excludeProduct?: string) {
  if (!segment) return null;
  const xs = rows.filter((r) => r.segment === segment && r.productId !== excludeProduct && r.unitPrice != null).map((r) => r.unitPrice!);
  return xs.length ? { median: median(xs)!, n: xs.length } : null;
}

function relevance(ctx: ProductCtx) {
  let p = 0;
  if (ctx.category === DEMO_CATEGORY) p += 2;
  if (DEMO_SCOPES.includes(ctx.storeId)) p += 1;
  return p;
}

/** Pure diff: which alerts does this observation pair justify? */
export function diffObservations(ctx: ProductCtx, before: ObsLite | null, after: ObsLite | null, rowsForContext: Row[]): AlertDraft[] {
  const out: AlertDraft[] = [];
  const rel = relevance(ctx);
  const inCategory = ctx.category === DEMO_CATEGORY;
  const who = ctx.brand ? `${ctx.brand}: ` : "";
  const where = ctx.storeName;
  const segCtx = segmentMedian(rowsForContext, ctx.segment, ctx.productId);
  const segLine = (unit: number | null) =>
    segCtx && unit != null
      ? ` In ${ctx.segment} the median across monitored stores is €${segCtx.median.toFixed(2)}/kg (${segCtx.n} observations); this product is now ${pct((unit - segCtx.median) / segCtx.median)} against it.`
      : !inCategory
        ? " This product is outside the tracked category, so it does not affect any brand's comparison group."
        : "";

  if (before && after && Math.abs(after.price - before.price) > 0.004) {
    const m = (after.price - before.price) / before.price;
    const down = m < 0;
    out.push({
      kind: down ? "price_decrease" : "price_increase",
      ctx,
      title: `${who}${ctx.name} ${down ? "down" : "up"} ${pct(m)} at ${where}`,
      why:
        `Shelf price moved from ${fmt(before.price)} to ${fmt(after.price)} between two captures of the retailer page.` +
        (after.promoKind && !before.promoKind ? " The new price comes with a retailer-advertised offer." : after.promoKind ? "" : " No promotion is advertised, so this is an observed price change, not a verified discount.") +
        segLine(after.unitPrice),
      before,
      after,
      magnitude: m,
      priority: rel + (down ? 3 : 2) + (Math.abs(m) >= 0.1 ? 2 : Math.abs(m) >= 0.05 ? 1 : 0),
      observedAt: after.capturedAt,
      sourceUrl: after.sourceUrl,
    });
  }
  if (after?.promoKind && (!before || before.promoKind !== after.promoKind)) {
    out.push({
      kind: "promo_started",
      ctx,
      title: `New promotion: ${ctx.name} · ${after.promoLabel ?? after.promoKind} at ${where}`,
      why:
        `The retailer page now advertises "${after.promoLabel ?? after.promoKind}"${after.validTo ? `, valid until ${after.validTo.slice(0, 10)}` : ""}.` +
        (inCategory ? " A competitor promotion in your comparison group can shift volume during its validity window." : segLine(after.unitPrice)),
      before,
      after,
      magnitude: null,
      priority: rel + 3,
      observedAt: after.capturedAt,
      sourceUrl: after.sourceUrl,
    });
  }
  if (before?.promoKind && after && !after.promoKind) {
    out.push({
      kind: "promo_ended",
      ctx,
      title: `Promotion ended: ${ctx.name} at ${where}`,
      why: `"${before.promoLabel ?? before.promoKind}" is no longer shown on the product page; the shelf price is now ${fmt(after.price)}.` + segLine(after.unitPrice),
      before,
      after,
      magnitude: null,
      priority: rel + 2,
      observedAt: after.capturedAt,
      sourceUrl: after.sourceUrl,
    });
  }
  if (before && !after) {
    out.push({
      kind: "left_offer_page",
      ctx,
      title: `No longer shown: ${ctx.name} on ${where}'s offer page`,
      why:
        `It was listed in the previous capture (${fmt(before.price)}${before.promoLabel ? `, ${before.promoLabel}` : ""}) and is missing from the latest one. ` +
        "This means the retailer stopped showing it online on that page. It is not evidence that the product left the physical shelf." +
        (inCategory ? "" : " Outside the tracked category."),
      before,
      after: null,
      magnitude: null,
      priority: rel + 1,
      observedAt: before.capturedAt,
      sourceUrl: before.sourceUrl,
    });
  }
  // Changes outside the tracked category are kept for completeness but never compete with relevant ones.
  if (!inCategory) for (const a of out) a.priority = Math.min(a.priority, 1);
  return out;
}

/** Shifts in premium / parity / value position for any company, comparing two sets of latest rows. */
export function positionShifts(beforeRows: Row[], afterRows: Row[], observedAt: string, sourceUrl: string): AlertDraft[] {
  const out: AlertDraft[] = [];
  for (const c of companies(afterRows)) {
    const b = new Map(positioning(beforeRows, c.name).map((p) => [p.segment, p]));
    for (const a of positioning(afterRows, c.name)) {
      const p = b.get(a.segment);
      if (!p || p.positioning === a.positioning || a.positioning === "no comparison" || p.positioning === "no comparison") continue;
      out.push({
        kind: "position_changed",
        ctx: { productId: "", name: a.segment, brand: c.brands[0] ?? c.name, segment: a.segment, category: DEMO_CATEGORY, storeId: "", storeName: "monitored stores" },
        title: `${c.name}: relative price position in ${a.segment} moved from ${p.positioning} to ${a.positioning}`,
        why: `Median unit price gap versus comparable competitor products changed from ${pct(p.gapPct ?? 0)} to ${pct(a.gapPct ?? 0)} (${a.ownObs} own vs ${a.competitorObs} competitor observations). ${segmentBasis(a.segment)}.`,
        before: null,
        after: null,
        magnitude: (a.gapPct ?? 0) - (p.gapPct ?? 0),
        priority: 6,
        observedAt,
        sourceUrl,
      });
    }
  }
  return out;
}

export function saveAlerts(drafts: AlertDraft[], origin: "monitor" | "replay", eventId: string | null): number {
  const ins = db().prepare(
    `INSERT OR IGNORE INTO alerts(kind, product_id, store_id, brand, segment, title, why, before, after, magnitude, priority, source_url, origin, event_id, created_at, observed_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let n = 0;
  for (const a of drafts) {
    const r = ins.run(
      a.kind,
      a.ctx.productId || null,
      a.ctx.storeId || null,
      a.ctx.brand,
      a.ctx.segment,
      a.title,
      a.why,
      a.before ? JSON.stringify(a.before) : null,
      a.after ? JSON.stringify(a.after) : null,
      a.magnitude,
      a.priority,
      a.sourceUrl,
      origin,
      eventId,
      nowIso(),
      a.observedAt,
    );
    n += Number(r.changes);
  }
  if (n) emit("alerts", { n, origin });
  return n;
}

// ------------------------------------------------------------------ replay of recorded captures

export interface CapturePair {
  storeId: string;
  storeName: string;
  sourceUrl: string;
  before: { at: string; products: number };
  after: { at: string; products: number };
}

/** Offer pages captured at least twice: real, recorded page states that can be replayed through the pipeline. */
export function replayablePairs(): CapturePair[] {
  const rows = db()
    .prepare(
      `SELECT o.store_id, s.name AS store_name, o.source_url, o.captured_at, COUNT(*) AS n
       FROM observations o JOIN stores s ON s.id = o.store_id
       WHERE o.origin = 'import:seed' AND (o.source_url LIKE '%kampanjat%' OR o.source_url LIKE '%tarjous%' OR o.source_url LIKE '%lidl.fi/c/%')
       GROUP BY o.store_id, o.source_url, o.captured_at HAVING n > 5 ORDER BY o.store_id, o.source_url, o.captured_at`,
    )
    .all() as { store_id: string; store_name: string; source_url: string; captured_at: string; n: number }[];
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(`${r.store_id}|${r.source_url}`, [...(by.get(`${r.store_id}|${r.source_url}`) ?? []), r]);
  const out: CapturePair[] = [];
  for (const caps of by.values()) {
    if (caps.length < 2) continue;
    const [a, b] = caps.slice(-2);
    out.push({ storeId: a.store_id, storeName: a.store_name, sourceUrl: a.source_url, before: { at: a.captured_at, products: a.n }, after: { at: b.captured_at, products: b.n } });
  }
  return out;
}

function captureState(storeId: string, sourceUrl: string, at: string) {
  const rows = db()
    .prepare(
      `SELECT o.product_id, o.price, o.unit_price, o.promo_kind, o.promo_label, o.promo_valid_to, o.captured_at, o.source_url,
              p.name, p.brand, p.segment, p.category, s.name AS store_name
       FROM observations o JOIN products p ON p.id = o.product_id JOIN stores s ON s.id = o.store_id
       WHERE o.store_id = ? AND o.source_url = ? AND o.captured_at = ?`,
    )
    .all(storeId, sourceUrl, at) as Record<string, unknown>[];
  return new Map(
    rows.map((r) => [
      r.product_id as string,
      {
        ctx: { productId: r.product_id as string, name: r.name as string, brand: (r.brand as string) ?? null, segment: (r.segment as string) ?? null, category: r.category as string, storeId, storeName: r.store_name as string },
        obs: {
          price: r.price as number,
          unitPrice: (r.unit_price as number) ?? null,
          promoKind: (r.promo_kind as string) ?? null,
          promoLabel: (r.promo_label as string) ?? null,
          validTo: (r.promo_valid_to as string) ?? null,
          capturedAt: r.captured_at as string,
          sourceUrl: r.source_url as string,
        } as ObsLite,
      },
    ]),
  );
}

/**
 * Replays two recorded captures of the same retailer offer page through the alert engine.
 * Uses only observations already stored; creates alerts marked origin = 'replay'. It does not claim
 * the change happened now: alerts carry the original capture time.
 */
export function replay(pair: { storeId: string; sourceUrl: string; beforeAt: string; afterAt: string }) {
  const before = captureState(pair.storeId, pair.sourceUrl, pair.beforeAt);
  const after = captureState(pair.storeId, pair.sourceUrl, pair.afterAt);
  const rows = latestRows(DEFAULT_SCOPE);
  const drafts: AlertDraft[] = [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  let compared = 0;
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    const ctx = (a ?? b)!.ctx;
    compared++;
    drafts.push(...diffObservations(ctx, b?.obs ?? null, a?.obs ?? null, rows));
  }
  const saved = saveAlerts(drafts, "replay", `replay:${pair.storeId}:${pair.beforeAt}:${pair.afterAt}`);
  const relevant = drafts.filter((d) => d.ctx.category === DEMO_CATEGORY).length;
  const summary = { compared, changes: drafts.length, relevant, saved, filteredOut: drafts.length - relevant };
  db()
    .prepare("INSERT OR REPLACE INTO monitor_events(id, monitor_id, event, payload, received_at, processed_at, status, outcome, origin) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(`replay:${pair.storeId}:${pair.beforeAt}:${pair.afterAt}`, null, "replay", JSON.stringify(pair), nowIso(), nowIso(), "processed", JSON.stringify(summary), "replay");
  emit("state", { reason: "replay" });
  return summary;
}

export function clearReplay() {
  db().prepare("DELETE FROM alerts WHERE origin = 'replay'").run();
  db().prepare("DELETE FROM monitor_events WHERE origin = 'replay'").run();
  emit("state", { reason: "replay_cleared" });
}

export function markAlertsRead() {
  db().prepare("UPDATE alerts SET read = 1 WHERE read = 0").run();
}
