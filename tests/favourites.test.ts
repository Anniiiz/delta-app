import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  FavouriteError,
  areaProducts,
  areaStateOf,
  areaSummary,
  areaView,
  categoryTree,
  favouriteSegments,
  favouriteSets,
  followedThrough,
  isInArea,
  listFavourites,
  toggleFavourite,
} from "@/lib/favourites";

// Captures are from 13–14 Nov 2026; evaluate "active" and "ending soon" at a fixed instant.
const NOW = Date.parse("2026-11-14T12:00:00Z");
const CO = "FavCo";
const T1 = "9991000000001"; // EAN key

let seq = 0;
function seed() {
  const d = db();
  d.prepare("INSERT OR IGNORE INTO brands(name, manufacturer, company) VALUES (?, ?, ?)").run("FavBrand", CO, CO);
  d.prepare("INSERT OR IGNORE INTO brands(name, manufacturer, company) VALUES (?, ?, ?)").run("RivBrand", "RivCo", "RivCo");
  const store = d.prepare("INSERT OR IGNORE INTO stores(id, retailer, banner, name, level, city) VALUES (?, ?, ?, ?, ?, ?)");
  store.run("fav-s1", "FRetail", "FavMart", "FavMart One", "store", "Helsinki");
  store.run("fav-s2", "FRetail", "FavMart", "FavMart Two", "store", "Helsinki");
  const product = d.prepare("INSERT OR IGNORE INTO products(id, name, brand, category, segment, ean, raw) VALUES (?, ?, ?, ?, ?, ?, '{}')");
  const C = "Chocolate & confectionery";
  product.run("f:T1", "FavBrand suklaalevy", "FavBrand", C, "Chocolate tablets", T1);
  product.run("f:T2", "FavBrand suklaalevy tumma", "FavBrand", C, "Chocolate tablets", null);
  product.run("f:B1", "FavBrand suklaapatukka", "FavBrand", C, "Chocolate bars", null);
  product.run("f:C1", "FavBrand joulukalenteri", "FavBrand", C, "Advent calendars", null);
  product.run("f:U1", "FavBrand kaurajuoma", "FavBrand", "Uncategorised", null, null);
  product.run("r:T", "RivBrand suklaalevy", "RivBrand", C, "Chocolate tablets", null);
  product.run("r:A", "RivBrand joulukalenteri", "RivBrand", C, "Advent calendars", null);
  product.run("r:B", "RivBrand suklaapatukka", "RivBrand", C, "Chocolate bars", null);

  const obs = d.prepare(
    `INSERT INTO observations(source_key, product_id, store_id, price, regular_price, promo_kind, promo_label, promo_valid_to, source_url, source_kind, origin, captured_at, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 'test', ?, '{}')`,
  );
  const promo = d.prepare(
    `INSERT INTO promotions(observation_id, product_id, store_id, type, label, offer_price, reference_price, reference_kind, discount_pct, valid_to, source_url, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const at = "2026-11-13T08:00:00Z";
  const add = (product: string, storeId: string, price: number, p?: { label: string; to: string }) => {
    const url = `https://example.test/${product}/${storeId}/${++seq}`;
    const r = obs.run(`fav:${seq}`, product, storeId, price, null, p ? "campaign" : null, p?.label ?? null, p?.to ?? null, url, at);
    if (p) promo.run(Number(r.lastInsertRowid), product, storeId, "campaign", p.label, price, null, null, null, p.to, url, at);
  };
  add("f:T1", "fav-s1", 2.0, { label: "Tablet deal", to: "2026-11-15" });
  add("f:T1", "fav-s2", 3.0);
  add("f:T2", "fav-s1", 2.5);
  add("f:B1", "fav-s1", 1.0, { label: "Bar deal", to: "2026-12-31" });
  add("f:C1", "fav-s1", 10.0);
  add("f:U1", "fav-s2", 5.0);
  add("r:T", "fav-s1", 2.2, { label: "Rival tablet", to: "2026-11-20" });
  add("r:A", "fav-s2", 9.0, { label: "Rival calendar", to: "2026-11-20" });
  add("r:B", "fav-s1", 0.9, { label: "Rival bar", to: "2026-11-20" });
}

function reset() {
  listFavourites(); // creates the table on first use
  db().exec("DELETE FROM favourites");
}

const keys = (ps: { key: string }[]) => ps.map((p) => p.key).sort();

describe("favourites", () => {
  beforeAll(() => seed());
  beforeEach(() => reset());

  it("toggles on and off and persists in the table", () => {
    expect(toggleFavourite("subcategory", "Chocolate tablets", CO)).toEqual({ kind: "subcategory", key: "Chocolate tablets", on: true });
    expect(listFavourites().map((f) => [f.kind, f.key])).toEqual([["subcategory", "Chocolate tablets"]]);
    expect((db().prepare("SELECT COUNT(*) AS n FROM favourites").get() as { n: number }).n).toBe(1);
    expect(toggleFavourite("product", T1, CO)).toMatchObject({ on: true });
    expect(listFavourites()).toHaveLength(2);
    expect(toggleFavourite("subcategory", "Chocolate tablets", CO).on).toBe(false);
    expect(listFavourites().map((f) => f.key)).toEqual([T1]);
  });

  it("rejects unknown kinds and keys", () => {
    expect(() => toggleFavourite("brand", "Fazer", CO)).toThrow(FavouriteError);
    expect(() => toggleFavourite("category", "Snacks", CO)).toThrow(/Unknown category/);
    expect(() => toggleFavourite("subcategory", "Crisps", CO)).toThrow(/Unknown subcategory/);
    expect(() => toggleFavourite("product", "0000000000000", CO)).toThrow(/No FavCo product/);
    expect(() => toggleFavourite("product", "r:T", CO)).toThrow(FavouriteError); // a competitor's product
    expect(() => toggleFavourite("product", "", CO)).toThrow(FavouriteError);
    expect(() => toggleFavourite(undefined, undefined, CO)).toThrow(FavouriteError);
    expect(listFavourites()).toHaveLength(0);
  });

  it("a starred category implies its subcategories and products without writing rows for them", () => {
    toggleFavourite("category", "Chocolate", CO);
    expect(listFavourites()).toHaveLength(1);
    const sets = favouriteSets();
    const ps = areaProducts(CO, NOW);
    expect(keys(ps)).toEqual(keys([{ key: T1 }, { key: "f:T2" }, { key: "f:B1" }]));
    expect(isInArea({ key: "f:C1", segment: "Advent calendars" }, sets)).toBe(false);
    expect(areaStateOf({ key: T1, segment: "Chocolate tablets" }, sets)).toBe("implied");
    expect(followedThrough({ segment: "Chocolate bars" }, sets)).toBe("Chocolate");
    const choc = categoryTree(CO, NOW).find((c) => c.name === "Chocolate")!;
    expect(choc.on).toBe(true);
    expect(choc.subcategories.every((s) => s.implied && !s.on)).toBe(true);
    expect(choc.inArea).toBe(3);
  });

  it("restricts area products, summary and promotions (competitors by subcategory)", () => {
    toggleFavourite("subcategory", "Chocolate tablets", CO);
    toggleFavourite("product", "f:C1", CO);
    expect(keys(areaProducts(CO, NOW))).toEqual(keys([{ key: T1 }, { key: "f:T2" }, { key: "f:C1" }]));
    const v = areaView(CO, NOW);
    expect(v.products.find((p) => p.key === "f:C1")!.area).toBe("starred");
    expect(v.products.find((p) => p.key === T1)!.area).toBe("implied");

    const s = areaSummary(CO, NOW);
    expect(s).toMatchObject({ products: 3, storesSeen: 2, livePromos: 1, endingSoon: 1, promoStoreListings: 1 });
    expect(s.widestSpread).toMatchObject({ key: T1, min: 2, max: 3, pct: 50, stores: 2 });
    expect(s.subcategories).toEqual(["Advent calendars", "Chocolate tablets"]);

    expect(v.own.map((p) => p.label)).toEqual(["Tablet deal"]); // the bar deal is outside the area
    const rivals = v.competitors.filter((p) => p.company === "RivCo").map((p) => p.label).sort();
    expect(rivals).toEqual(["Rival calendar", "Rival tablet"]); // calendars via the starred product, not bars
    expect(v.competitors.every((p) => p.segment === "Chocolate tablets" || p.segment === "Advent calendars")).toBe(true);
    expect(s.competitorPromos).toBe(v.competitors.filter((p) => p.active).length);
    expect(areaSummary(CO, Date.parse("2026-11-16T12:00:00Z"))).toMatchObject({ livePromos: 0, endingSoon: 0 });
  });

  it("builds the category tree from the mapping and the segments present, with counts", () => {
    toggleFavourite("product", T1, CO);
    const tree = categoryTree(CO, NOW);
    expect(tree.map((c) => c.name)).toEqual(["Chocolate", "Seasonal & gifting", "Other"]); // no sweets or biscuits for FavCo
    const choc = tree[0];
    expect(choc.subcategories.map((s) => [s.name, s.products, s.starred, s.inArea])).toEqual([
      ["Chocolate tablets", 2, 1, 1],
      ["Chocolate bars", 1, 0, 0],
    ]);
    expect(choc).toMatchObject({ products: 3, starred: 1, inArea: 1, on: false });
    expect(tree[1].subcategories.map((s) => s.name)).toEqual(["Advent calendars"]);
    expect(tree[2].subcategories).toMatchObject([{ name: "Uncategorised", products: 1 }]);
  });

  it("lists the segments covered by starred categories and subcategories", () => {
    expect(favouriteSegments()).toEqual([]);
    toggleFavourite("category", "Seasonal & gifting", CO);
    toggleFavourite("subcategory", "Chocolate bars", CO);
    toggleFavourite("subcategory", "Uncategorised", CO);
    toggleFavourite("product", T1, CO); // products do not add segments
    expect(favouriteSegments()).toEqual(["Advent calendars", "Chocolate bars", "Seasonal & gift"]);
  });
});
