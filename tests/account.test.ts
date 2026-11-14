import { beforeAll, describe, expect, it } from "vitest";
import { importExport } from "@/lib/importer";
import { db } from "@/lib/db";
import { accountCells, accountProducts, accountPromos, accountSummary, bannerTotals, modeOf } from "@/lib/account";

// Captures are from 13–14 Nov 2026; evaluate "active" and "ending soon" at a fixed instant.
const NOW = Date.parse("2026-11-14T12:00:00Z");

describe("account view on the imported dataset", () => {
  beforeAll(() => {
    importExport();
  });

  it("covers every Fazer product and store scope, not just the confectionery demo scope", () => {
    const s = accountSummary("Fazer", NOW);
    expect(s.storesSeen).toBe(168);
    expect(s.storeScopesTotal).toBe(181);
    expect(s.banners).toBe(7);
    const products = accountProducts("Fazer", NOW);
    expect(products.filter((p) => p.ean).length).toBe(13);
    expect(products.flatMap((p) => p.productIds).length).toBe(22);
    expect(products.map((p) => p.storesSeen)).toEqual([...products.map((p) => p.storesSeen)].sort((a, b) => b - a));
    expect(bannerTotals().reduce((n, b) => n + b.stores, 0)).toBe(181);
  });

  it("reports store presence and price spread for Aito Barista", () => {
    const p = accountProducts("Fazer", NOW).find((x) => x.key === "6410222009202")!;
    expect(p.storesSeen).toBe(75);
    expect(p.minPrice).toBe(1.25);
    expect(p.maxPrice).toBe(1.69);
    expect(p.spreadPct).toBe(35.2);
    expect(accountSummary("Fazer", NOW).widestSpread).toMatchObject({ key: "6410222009202", min: 1.25, max: 1.69, stores: 75 });
  });

  it("merges the same EAN across retailers (Klassikot at Alepa and the K-Supermarket flyer)", () => {
    const p = accountProducts("Fazer", NOW).find((x) => x.key === "6416453026353")!;
    expect(p.productIds).toEqual(["kesko:6416453026353", "sok:6416453026353"]);
    const alepa = p.banners.find((b) => b.banner === "Alepa")!;
    const ksm = p.banners.find((b) => b.banner === "K-Supermarket")!;
    expect(alepa).toMatchObject({ stores: 14, modePrice: 4.99, chainOnly: false });
    expect(ksm).toMatchObject({ stores: 1, modePrice: 5.99, chainOnly: true, capturedStores: 1 });
    expect(p.spreadPct).toBe(0); // chain flyer price is excluded from the store-level spread
    const cells = accountCells("Fazer", "6416453026353", NOW);
    expect(cells).toHaveLength(15);
    expect(cells.find((c) => c.banner === "Alepa")!.promo).toMatchObject({ offerPrice: 4.99, referencePrice: 6.45, active: true });
  });

  it("groups own promotions with store counts and finds competitor promotions in shared groups", () => {
    const { own, competitors } = accountPromos("Fazer", NOW);
    const bread = own.filter((p) => p.key === "6413466114206");
    expect(bread.reduce((n, p) => n + p.stores, 0)).toBe(35);
    expect(bread[0]).toMatchObject({ type: "campaign", offerPrice: 2.99, referencePrice: 4.59, own: true });
    // Discount only with a stated reference price.
    for (const p of own) if (p.referencePrice == null) expect(p.discountPct).toBeNull();
    const marabou = competitors.filter((p) => p.brand === "Marabou" && p.label === "5 for €10.00");
    expect(new Set(marabou.map((p) => p.banner))).toEqual(new Set(["Alepa", "S-market", "Prisma"]));
    expect(competitors.every((p) => p.active && !p.own && p.company !== "Fazer")).toBe(true);
  });
});

// ----------------------------------------------------------------------- synthetic data

type Obs = { product: string; store: string; price: number; at: string; promo?: { type: string; label: string; offer: number; ref?: number; disc?: number; to: string } };
let seq = 0;

function seed() {
  const d = db();
  d.prepare("INSERT OR IGNORE INTO brands(name, manufacturer, company) VALUES (?, ?, ?)").run("TBrand", "TestCo", "TestCo");
  d.prepare("INSERT OR IGNORE INTO brands(name, manufacturer, company) VALUES (?, ?, ?)").run("RBrand", "RivalCo", "RivalCo");
  d.prepare("INSERT OR IGNORE INTO brands(name, manufacturer, company) VALUES (?, ?, ?)").run("FBrand", "FarCo", "FarCo");
  const store = d.prepare("INSERT OR IGNORE INTO stores(id, retailer, banner, name, level, city) VALUES (?, ?, ?, ?, ?, ?)");
  store.run("t-s1", "TRetail", "TestMart", "TestMart One", "store", "Helsinki");
  store.run("t-s2", "TRetail", "TestMart", "TestMart Two", "store", "Helsinki");
  store.run("t-s3", "TRetail", "TestMart", "TestMart Three", "store", "Espoo");
  store.run("t-s4", "TRetail", "TestMart", "TestMart Four", "store", "Espoo");
  store.run("chain:TestMart", "TRetail", "TestMart", "TestMart offers", "chain", null);
  store.run("o-s1", "ORetail", "OtherMart", "OtherMart One", "store", "Helsinki");
  const product = d.prepare("INSERT OR IGNORE INTO products(id, name, brand, category, segment, ean, raw) VALUES (?, ?, ?, ?, ?, ?, '{}')");
  product.run("t:A", "TBrand Bar 100 g", "TBrand", "Test category", "Test bars", "9990000000001");
  product.run("o:A", "TBRAND BAR", "TBrand", "Test category", "Test bars", "9990000000001");
  product.run("t:C", "TBrand Bites", "TBrand", "Test category", "Test bars", null);
  product.run("t:R1", "RBrand Bar", "RBrand", "Test category", "Test bars", null);
  product.run("t:R2", "RBrand Old Deal", "RBrand", "Test category", "Test bars", null);
  product.run("t:F1", "FBrand Drink", "FBrand", "Test category", "Test drinks", null);

  const obs = d.prepare(
    `INSERT INTO observations(source_key, product_id, store_id, price, regular_price, promo_kind, promo_label, promo_valid_to, source_url, source_kind, origin, captured_at, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 'test', ?, '{}')`,
  );
  const promo = d.prepare(
    `INSERT INTO promotions(observation_id, product_id, store_id, type, label, offer_price, reference_price, reference_kind, discount_pct, valid_to, source_url, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const add = (o: Obs) => {
    const url = `https://example.test/${o.product}/${o.store}/${++seq}`;
    const r = obs.run(`test:${seq}`, o.product, o.store, o.price, o.promo?.ref ?? null, o.promo?.type ?? null, o.promo?.label ?? null, o.promo?.to ?? null, url, o.at);
    if (o.promo)
      promo.run(Number(r.lastInsertRowid), o.product, o.store, o.promo.type, o.promo.label, o.promo.offer, o.promo.ref ?? null, o.promo.ref != null ? "regular" : null, o.promo.disc ?? null, o.promo.to, url, o.at);
  };
  const deal = { type: "campaign", label: "Deal €2.50", offer: 2.5, ref: 3, disc: 16.7, to: "2026-11-15" };
  // Product A at TestMart: s1 captured twice (latest wins), s2 and s3 at store level, plus a chain flyer.
  add({ product: "t:A", store: "t-s1", price: 1.5, at: "2026-11-10T08:00:00Z", promo: { type: "campaign", label: "Old deal", offer: 1.5, to: "2026-11-11" } });
  add({ product: "t:A", store: "t-s1", price: 2.5, at: "2026-11-13T08:00:00Z", promo: deal });
  add({ product: "t:A", store: "t-s2", price: 2.5, at: "2026-11-13T08:00:00Z", promo: deal });
  add({ product: "t:A", store: "t-s3", price: 2.0, at: "2026-11-13T08:00:00Z" });
  add({ product: "t:A", store: "chain:TestMart", price: 9.0, at: "2026-11-13T08:00:00Z" });
  // Same EAN at a different retailer.
  add({ product: "o:A", store: "o-s1", price: 3.0, at: "2026-11-13T09:00:00Z" });
  // Product C: two stores with different prices (mode tie → lower), multi-buy ending later.
  add({ product: "t:C", store: "t-s1", price: 1.2, at: "2026-11-13T08:00:00Z", promo: { type: "multibuy", label: "2 for €2.00", offer: 1.0, to: "2026-12-31" } });
  add({ product: "t:C", store: "t-s2", price: 1.0, at: "2026-11-13T08:00:00Z" });
  // Competitors: an active promo in the shared group, an expired one, and one outside the group.
  add({ product: "t:R1", store: "t-s1", price: 1.8, at: "2026-11-13T08:00:00Z", promo: { type: "campaign", label: "Rival €1.80", offer: 1.8, to: "2026-11-20" } });
  add({ product: "t:R2", store: "t-s2", price: 1.8, at: "2026-11-13T08:00:00Z", promo: { type: "campaign", label: "Rival old", offer: 1.8, to: "2026-11-01" } });
  add({ product: "t:F1", store: "t-s1", price: 0.9, at: "2026-11-13T08:00:00Z", promo: { type: "campaign", label: "Far deal", offer: 0.9, to: "2026-11-20" } });
}

describe("account view rules on synthetic data", () => {
  beforeAll(() => {
    importExport(); // no-op if already imported; keeps the file order-independent
    seed();
  });

  it("merges listings of one EAN across retailers and names it after the widest listing", () => {
    const a = accountProducts("TestCo", NOW).find((p) => p.key === "9990000000001")!;
    expect(a.productIds).toEqual(["o:A", "t:A"]);
    expect(a.name).toBe("TBrand Bar 100 g");
    expect(a.storesSeen).toBe(5);
    expect(a.banners.map((b) => b.banner)).toEqual(["TestMart", "OtherMart"]);
    expect(a.banners[0]).toMatchObject({ stores: 4, capturedStores: 5, chainOnly: false, promoStores: 2 });
  });

  it("uses only the latest observation per product × store", () => {
    const s1 = accountCells("TestCo", "9990000000001", NOW).find((c) => c.storeId === "t-s1")!;
    expect(s1.price).toBe(2.5);
    expect(s1.promo).toMatchObject({ label: "Deal €2.50", active: true, discountPct: 16.7 });
    expect(s1.city).toBe("Helsinki");
  });

  it("computes the mode price (ties → lower) and spread over store-level scopes only", () => {
    const products = accountProducts("TestCo", NOW);
    const a = products.find((p) => p.key === "9990000000001")!;
    expect(a.modePrice).toBe(2.5);
    expect(a.minPrice).toBe(2.0);
    expect(a.maxPrice).toBe(9.0); // the chain flyer price counts in min/max …
    expect(a.spreadPct).toBe(50); // … but not in the store-level spread (2.00 → 3.00)
    const c = products.find((p) => p.key === "t:C")!;
    expect(c.modePrice).toBe(1.0);
    expect(modeOf([3, 1, 3, 1, 2])).toBe(1);
  });

  it("groups promotions with store counts and filters competitors by shared comparison group", () => {
    const { own, competitors } = accountPromos("TestCo", NOW);
    expect(own.map((p) => [p.key, p.label, p.stores])).toEqual([
      ["9990000000001", "Deal €2.50", 2],
      ["t:C", "2 for €2.00", 1],
    ]);
    expect(own[0]).toMatchObject({ referencePrice: 3, discountPct: 16.7, level: "store", own: true });
    expect(competitors.map((p) => p.label)).toEqual(["Rival €1.80"]);
    expect(competitors[0]).toMatchObject({ company: "RivalCo", segment: "Test bars", own: false, stores: 1 });
  });

  it("summarises live promotions and counts the ones ending within 3 days", () => {
    const s = accountSummary("TestCo", NOW);
    expect(s).toMatchObject({ products: 2, storesSeen: 5, banners: 2, livePromos: 2, promoStoreListings: 3, endingSoon: 1 });
    expect(s.widestSpread).toMatchObject({ key: "9990000000001", min: 2, max: 3, pct: 50, stores: 4 });
    expect(accountSummary("TestCo", Date.parse("2026-12-01T00:00:00Z"))).toMatchObject({ livePromos: 1, endingSoon: 0 });
  });
});
