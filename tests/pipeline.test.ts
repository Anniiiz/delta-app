import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { kruokaStoreHeader, parseKruokaCategory, parseLidlCategory, parseSkaupatCategory, parseWoltCategory } from "@/lib/parsers/categories";
import { beforeAll, describe, expect, it } from "vitest";
import { classify, brandOf } from "@/lib/taxonomy";
import { normalizePrice, promotionOf, resolveSize, type RawSnapshot } from "@/lib/normalize";
import { importExport } from "@/lib/importer";
import { importCategoryRun } from "@/lib/import-categories";
import { latestRows, positioning, history, crossRetailer } from "@/lib/analytics";
import { diffObservations, replay, replayablePairs, type ObsLite } from "@/lib/alerts";
import { verifySignature } from "@/lib/monitors";
import { db } from "@/lib/db";

const base: RawSnapshot = {
  price: 3.25, regular_price: null, lowest_30d: null, unit_price: null, unit_price_unit: null, promo_kind: null, promo_label: null,
  promo_valid_from: null, promo_valid_to: null, loyalty: null, multibuy_qty: null, multibuy_price: null,
};

describe("classification", () => {
  it("puts products in comparison groups by explicit rules", () => {
    expect(classify("Marabou Mjölkchoklad suklaalevy 160g").segment).toBe("Chocolate tablets");
    expect(classify("Panda Juhlapöydän konvehteja 300 g").segment).toBe("Boxed chocolates & pralines");
    expect(classify("Lindt Teddy joulukalenteri 170 g").segment).toBe("Advent calendars");
    expect(classify("Coop laktoositon proteiinijuoma suklaa 250 ml").category).toBe("Uncategorised");
    expect(classify("Aino Suklaakaramelli vegaaninen kaurajäätelö 508g/850ml").category).toBe("Uncategorised");
  });
  it("finds brands and owners", () => {
    expect(brandOf("KARL FAZER Suklaalevy")).toMatchObject({ brand: "Fazer", manufacturer: "Fazer" });
    expect(brandOf("Tupla Double Layer Raspberry Liquorice suklaapatukka 48g")).toMatchObject({ brand: "Tupla", manufacturer: "Cloetta" });
    expect(brandOf("Terry's suklaapallot 145 g").manufacturer).toBeNull();
  });
});

describe("normalisation", () => {
  it("computes unit prices only from single known sizes", () => {
    const s = resolveSize({ name: "Marabou Daim suklaalevy 160g", size_value: 0.16, size_unit: "kg" });
    expect(normalizePrice(base, s).unitPrice).toBe(20.31);
    const range = resolveSize({ name: "Malaco Aakkoset 280-340 g", size_value: 0.34, size_unit: "kg" });
    expect(range.isRange).toBe(true);
    expect(normalizePrice(base, range).unitPrice).toBeNull();
    const fromUrl = resolveSize({ name: "Haribo joulukalenteri 300", url: "https://www.k-ruoka.fi/kauppa/tuote/haribo-makeisjoulukalenteri-300g-4001686026205" });
    expect(fromUrl).toMatchObject({ value: 0.3, source: "url" });
  });
  it("treats Lidl's bundle total as a per-pack regular price, not a 30-day low", () => {
    const lidl = { ...base, price: 3.85, lowest_30d: 15.4, promo_kind: "multibuy", promo_label: "4 for €10.00", multibuy_qty: 4, multibuy_price: 10 };
    const p = promotionOf(lidl)!;
    expect(p.offerPrice).toBe(2.5);
    expect(p.referencePrice).toBe(3.85);
    expect(p.discountPct).toBe(35.1);
  });
  it("shows no discount without a stated reference price", () => {
    expect(promotionOf({ ...base, price: 4.99, promo_kind: "campaign", promo_label: "Campaign €4.99" })!.discountPct).toBeNull();
  });
  it("never treats a price difference as a promotion", () => {
    expect(promotionOf({ ...base, price: 2.99 })).toBeNull();
  });
});

describe("imported dataset", () => {
  beforeAll(() => {
    importExport();
    if (fs.existsSync(path.join(process.cwd(), "data", "raw", "confectionery-2026-11-14"))) importCategoryRun("confectionery-2026-11-14");
  }, 60_000);
  it("imports idempotently", () => {
    const n = (db().prepare("SELECT COUNT(*) n FROM observations").get() as { n: number }).n;
    expect(importExport().observationsAdded).toBe(0);
    expect((db().prepare("SELECT COUNT(*) n FROM observations").get() as { n: number }).n).toBe(n);
  });
  it("has a real demo slice with several brands and stores", () => {
    const rows = latestRows();
    expect(new Set(rows.map((r) => r.productId)).size).toBeGreaterThanOrEqual(20);
    expect(new Set(rows.map((r) => r.brand)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(rows.map((r) => r.storeId)).size).toBeGreaterThanOrEqual(3);
  });
  it("positions Fazer against comparable competitors with sample sizes", () => {
    const tablets = positioning(latestRows(), "Fazer").find((p) => p.segment === "Chocolate tablets")!;
    expect(tablets.ownObs).toBeGreaterThan(0);
    expect(tablets.competitorObs).toBeGreaterThan(0);
    expect(tablets.competitors.map((c) => c.company)).toContain("Mondelēz");
  });
  it("matches the same EAN across retailers", () => {
    const klassikot = crossRetailer().find((c) => c.ean === "6416453026353")!;
    expect(klassikot.banners.map((b) => b.banner)).toEqual(expect.arrayContaining(["Alepa", "K-Supermarket"]));
  });
  it("only reports price changes backed by two real captures", () => {
    for (const c of history().priceChanges) {
      expect(c.from).not.toBe(c.to);
      expect(Date.parse(c.at)).toBeGreaterThan(Date.parse(c.prevAt));
    }
  });
  it("replays recorded captures without promoting out-of-category noise", () => {
    const pair = replayablePairs().find((p) => p.storeId === "sok-prisma-kannelmaki")!;
    const r = replay({ storeId: pair.storeId, sourceUrl: pair.sourceUrl, beforeAt: pair.before.at, afterAt: pair.after.at });
    expect(r.changes).toBeGreaterThan(0);
    expect(r.relevant).toBe(0);
    const max = (db().prepare("SELECT MAX(priority) m FROM alerts WHERE origin = 'replay'").get() as { m: number }).m;
    expect(max).toBeLessThanOrEqual(1);
  });
});

describe("change detection", () => {
  const ctx = { productId: "sok:7622202238475", name: "Marabou Mjölkchoklad suklaalevy 160g", brand: "Marabou", segment: "Chocolate tablets", category: "Chocolate & confectionery", storeId: "sok-prisma-kannelmaki", storeName: "Prisma Kaari Kannelmäki" };
  const obs = (o: Partial<ObsLite>): ObsLite => ({ price: 2.99, unitPrice: 18.69, promoKind: "multibuy", promoLabel: "5 for €10.00", validTo: "2026-11-15", capturedAt: "2026-11-14T08:52:13Z", sourceUrl: "https://www.s-kaupat.fi/x", ...o });

  it("ignores page changes that leave prices and offers unchanged", () => {
    expect(diffObservations(ctx, obs({}), obs({ capturedAt: "2026-11-16T08:00:00Z" }), [])).toHaveLength(0);
  });
  it("flags a competitor price decrease with comparison-group context", () => {
    const rows = latestRows();
    const out = diffObservations(ctx, obs({}), obs({ price: 2.49, unitPrice: 15.56 }), rows);
    expect(out[0].kind).toBe("price_decrease");
    expect(out[0].priority).toBeGreaterThanOrEqual(6);
    expect(out[0].why).toMatch(/In Chocolate tablets the median/);
  });
  it("reports an ended promotion", () => {
    const out = diffObservations(ctx, obs({}), obs({ price: 2.99, promoKind: null, promoLabel: null }), []);
    expect(out.map((a) => a.kind)).toEqual(["promo_ended"]);
  });
});

describe("webhook signatures", () => {
  it("accepts valid and rejects tampered or stale signatures", () => {
    const body = Buffer.from('{"id":"evt_1"}');
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", "whsec_x").update(`${t}.`).update(body).digest("hex");
    expect(verifySignature(body, `t=${t},v1=${sig}`, "whsec_x")).toBe(true);
    expect(verifySignature(Buffer.from('{"id":"evt_2"}'), `t=${t},v1=${sig}`, "whsec_x")).toBe(false);
    expect(verifySignature(body, `t=${t - 900},v1=${sig}`, "whsec_x")).toBe(false);
  });
});

describe("category page parsers (real captured pages)", () => {
  const fx = (f: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
  it("reads K-Ruoka store prices, Plussa multi-buys and the store header", () => {
    const md = fx("kruoka-suklaalevyt.md");
    expect(kruokaStoreHeader(md)).toBe("Iso Omena");
    const ls = parseKruokaCategory(md);
    expect(ls.length).toBeGreaterThan(50);
    const plussa = ls.find((l) => l.snapshot.loyalty === "k_plussa" && l.snapshot.multibuy_qty);
    expect(plussa?.snapshot.multibuy_price).toBeGreaterThan(0);
  });
  it("reads S-kaupat plain, campaign and multi-buy tiles", () => {
    const plain = parseSkaupatCategory(fx("skaupat-suklaalevyt.md"));
    expect(plain.length).toBe(24);
    expect(plain.find((l) => l.ean === "6416453095014")?.snapshot.price).toBe(3.75);
    const seasonal = parseSkaupatCategory(fx("skaupat-sesonki.md"));
    const camp = seasonal.find((l) => l.snapshot.promo_kind === "campaign");
    expect(camp?.snapshot.lowest_30d).toBeGreaterThan(camp!.snapshot.price);
  });
  it("reads Wolt Market tiles, including struck-through offer prices", () => {
    const ls = parseWoltCategory(fx("wolt-suklaapatukat.md"));
    expect(ls.length).toBeGreaterThan(10);
    const offer = ls.find((l) => l.snapshot.promo_kind === "campaign");
    expect(offer?.snapshot.regular_price).toBeGreaterThan(offer!.snapshot.price);
    expect(ls.every((l) => l.sku && l.ean === null)).toBe(true);
  });
  it("reads Lidl tiles with brand, size and unit price", () => {
    const ls = parseLidlCategory(fx("lidl-makeiset.md"));
    expect(ls.length).toBeGreaterThan(0);
    expect(ls[0].snapshot.unit_price).not.toBeNull();
  });
});
