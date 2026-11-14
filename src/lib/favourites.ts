import type { DatabaseSync } from "node:sqlite";
import { db, nowIso } from "./db";
import { ACCOUNT_COMPANY } from "./context";
import { validUntil } from "./normalize";
import { accountCells, accountProducts, accountPromos, bannerTotals, spreadOf, type AccountProduct, type AccountPromo, type AccountSummary } from "./account";

/**
 * Favourites: the products, categories and subcategories a person follows ("my area").
 * Delta has one account and no login yet, so favourites are saved for this installation (one SQLite table).
 *
 * Display hierarchy: Category → Subcategory, where a subcategory is an existing comparison group
 * (`products.segment`). Products without a segment sit under Other → Uncategorised.
 * A product is in the area when it is starred itself, or its subcategory or category is starred.
 * Starring a category writes one row; its subcategories and products are implied, not stored.
 */

export type FavKind = "product" | "category" | "subcategory";
export const FAV_KINDS: readonly FavKind[] = ["product", "category", "subcategory"];

export const OTHER_CATEGORY = "Other";
export const UNCATEGORISED = "Uncategorised";

/** Static category → subcategory mapping. Empty ones are hidden in the tree. */
export const CATEGORY_MAP: readonly { category: string; subcategories: readonly string[] }[] = [
  { category: "Chocolate", subcategories: ["Chocolate tablets", "Chocolate bars", "Boxed chocolates & pralines", "Chocolate-coated fruit"] },
  { category: "Sweets & biscuits", subcategories: ["Sweets & liquorice", "Sweet biscuits"] },
  { category: "Seasonal & gifting", subcategories: ["Advent calendars", "Seasonal & gift"] },
  { category: OTHER_CATEGORY, subcategories: [UNCATEGORISED] },
];

const SUB_TO_CAT = new Map(CATEGORY_MAP.flatMap((c) => c.subcategories.map((s) => [s, c.category] as const)));

/** Subcategory of a product segment: the segment itself, or "Uncategorised" without one. */
export function subcategoryOf(segment: string | null | undefined): string {
  return segment || UNCATEGORISED;
}

/** Category of a subcategory; a segment missing from the static mapping falls under Other. */
export function categoryOf(subcategory: string): string {
  return SUB_TO_CAT.get(subcategory) ?? OTHER_CATEGORY;
}

export const isCategory = (name: string) => CATEGORY_MAP.some((c) => c.category === name);
export const isSubcategory = (name: string) => SUB_TO_CAT.has(name);

export class FavouriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FavouriteError";
  }
}

// ------------------------------------------------------------------ storage

const ready = new WeakSet<DatabaseSync>();

function fdb(): DatabaseSync {
  const d = db();
  if (!ready.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS favourites (
      kind TEXT NOT NULL CHECK(kind IN ('product','category','subcategory')),
      key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (kind, key)
    )`);
    ready.add(d);
  }
  return d;
}

export interface Favourite {
  kind: FavKind;
  key: string;
  createdAt: string;
}

/** Every favourite, oldest first within kind (category, subcategory, product). */
export function listFavourites(): Favourite[] {
  const rows = fdb().prepare("SELECT kind, key, created_at FROM favourites ORDER BY created_at, kind, key").all() as { kind: FavKind; key: string; created_at: string }[];
  const rank = (k: FavKind) => (k === "category" ? 0 : k === "subcategory" ? 1 : 2);
  return rows.map((r) => ({ kind: r.kind, key: r.key, createdAt: r.created_at })).sort((a, b) => rank(a.kind) - rank(b.kind));
}

export interface FavouriteSets {
  products: Set<string>;
  categories: Set<string>;
  subcategories: Set<string>;
}

export function favouriteSets(favs: Favourite[] = listFavourites()): FavouriteSets {
  const s: FavouriteSets = { products: new Set(), categories: new Set(), subcategories: new Set() };
  for (const f of favs) (f.kind === "product" ? s.products : f.kind === "category" ? s.categories : s.subcategories).add(f.key);
  return s;
}

/** Turns a favourite on or off. Throws FavouriteError for an unknown kind or key. */
export function toggleFavourite(kind: unknown, key: unknown, company = ACCOUNT_COMPANY): { kind: FavKind; key: string; on: boolean } {
  if (typeof kind !== "string" || !FAV_KINDS.includes(kind as FavKind)) throw new FavouriteError(`Unknown kind. Use one of: ${FAV_KINDS.join(", ")}.`);
  const k = kind as FavKind;
  const name = typeof key === "string" ? key.trim() : "";
  if (!name || name.length > 200) throw new FavouriteError("key must be a non-empty string.");
  if (k === "category" && !isCategory(name)) throw new FavouriteError(`Unknown category "${name}". Known: ${CATEGORY_MAP.map((c) => c.category).join(", ")}.`);
  if (k === "subcategory" && !isSubcategory(name)) throw new FavouriteError(`Unknown subcategory "${name}".`);
  if (k === "product" && !accountProducts(company).some((p) => p.key === name)) throw new FavouriteError(`No ${company} product with key "${name}" in the captured data.`);

  const d = fdb();
  const del = d.prepare("DELETE FROM favourites WHERE kind = ? AND key = ?").run(k, name);
  if (Number(del.changes) > 0) return { kind: k, key: name, on: false };
  d.prepare("INSERT INTO favourites(kind, key, created_at) VALUES (?, ?, ?)").run(k, name, nowIso());
  return { kind: k, key: name, on: true };
}

// ------------------------------------------------------------------ area membership

export type AreaState = "starred" | "implied" | null;

/** Why a product is in the area: starred itself, implied by its subcategory or category, or not at all. */
export function areaStateOf(product: { key: string; segment: string | null }, sets: FavouriteSets = favouriteSets()): AreaState {
  if (sets.products.has(product.key)) return "starred";
  const sub = subcategoryOf(product.segment);
  if (sets.subcategories.has(sub) || sets.categories.has(categoryOf(sub))) return "implied";
  return null;
}

/** The followed subcategory or category that brings a product into the area, if any. */
export function followedThrough(product: { segment: string | null }, sets: FavouriteSets): string | undefined {
  const sub = subcategoryOf(product.segment);
  if (sets.subcategories.has(sub)) return sub;
  const cat = categoryOf(sub);
  return sets.categories.has(cat) ? cat : undefined;
}

export function isInArea(product: { key: string; segment: string | null }, sets: FavouriteSets = favouriteSets()): boolean {
  return areaStateOf(product, sets) != null;
}

/** Segment names covered by starred categories and subcategories (products not included; Uncategorised has no segment). */
export function favouriteSegments(sets: FavouriteSets = favouriteSets()): string[] {
  const out = new Set<string>();
  for (const s of sets.subcategories) if (s !== UNCATEGORISED) out.add(s);
  for (const c of sets.categories) for (const s of CATEGORY_MAP.find((x) => x.category === c)?.subcategories ?? []) if (s !== UNCATEGORISED) out.add(s);
  return [...out].sort();
}

// ------------------------------------------------------------------ category tree

export interface SubcategoryNode {
  name: string;
  category: string;
  /** Starred directly. */
  on: boolean;
  /** Followed through its starred category. */
  implied: boolean;
  products: number;
  /** Products starred individually. */
  starred: number;
  /** Products in the area (starred, or through this subcategory or its category). */
  inArea: number;
}

export interface CategoryNode {
  name: string;
  on: boolean;
  products: number;
  starred: number;
  inArea: number;
  subcategories: SubcategoryNode[];
}

function buildTree(products: AccountProduct[], sets: FavouriteSets): CategoryNode[] {
  const bySub = new Map<string, AccountProduct[]>();
  for (const p of products) {
    const s = subcategoryOf(p.segment);
    bySub.set(s, [...(bySub.get(s) ?? []), p]);
  }
  // Static order first; a segment outside the mapping is appended under Other.
  const extra = [...bySub.keys()].filter((s) => !SUB_TO_CAT.has(s)).sort();
  return CATEGORY_MAP.map((c) => {
    const subs = [...c.subcategories, ...(c.category === OTHER_CATEGORY ? extra : [])]
      .filter((s) => bySub.has(s))
      .map((s): SubcategoryNode => {
        const ps = bySub.get(s)!;
        return {
          name: s,
          category: c.category,
          on: sets.subcategories.has(s),
          implied: sets.categories.has(c.category),
          products: ps.length,
          starred: ps.filter((p) => sets.products.has(p.key)).length,
          inArea: ps.filter((p) => isInArea(p, sets)).length,
        };
      });
    return {
      name: c.category,
      on: sets.categories.has(c.category),
      products: subs.reduce((n, s) => n + s.products, 0),
      starred: subs.reduce((n, s) => n + s.starred, 0),
      inArea: subs.reduce((n, s) => n + s.inArea, 0),
      subcategories: subs,
    };
  }).filter((c) => c.subcategories.length > 0);
}

// ------------------------------------------------------------------ area view

export interface AreaSummary {
  company: string;
  products: number;
  storesSeen: number;
  storeScopesTotal: number;
  livePromos: number;
  endingSoon: number;
  promoStoreListings: number;
  widestSpread: AccountSummary["widestSpread"];
  /** Live competitor promotions in the area's subcategories. */
  competitorPromos: number;
  /** Subcategories the area covers: followed ones plus those of starred products. */
  subcategories: string[];
}

export type AreaProduct = AccountProduct & { area: AreaState };

export interface AreaView {
  favourites: Favourite[];
  sets: FavouriteSets;
  empty: boolean;
  tree: CategoryNode[];
  /** Every company product, with its area state. */
  all: AreaProduct[];
  /** Products in the area, in the account order (most widely listed first). */
  products: AreaProduct[];
  /** Subcategories the area covers: followed ones, those of followed categories and of starred products. */
  subcategories: string[];
  /** Area KPIs; computed on first read. */
  readonly summary: AreaSummary;
  /** Own promotions on area products. */
  own: AccountPromo[];
  /** Competitor promotions in the area's subcategories. */
  competitors: AccountPromo[];
  /** All own and competitor promotions of the account, unfiltered (for pages that toggle the area). */
  allPromos: { own: AccountPromo[]; competitors: AccountPromo[] };
}

const ENDING_SOON_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Everything the area screens need, computed from one pass over the account data (account.ts is memoised;
 * this avoids re-grouping the company's products for each part).
 */
export function areaView(company = ACCOUNT_COMPANY, now = Date.now()): AreaView {
  const favourites = listFavourites();
  const sets = favouriteSets(favourites);
  const all = accountProducts(company, now).map((p) => ({ ...p, area: areaStateOf(p, sets) }));
  const products = all.filter((p) => p.area != null);
  const keys = new Set(products.map((p) => p.key));
  const subcategories = new Set([...sets.subcategories, ...products.filter((p) => p.area === "starred").map((p) => subcategoryOf(p.segment))]);
  for (const c of sets.categories) for (const s of CATEGORY_MAP.find((x) => x.category === c)?.subcategories ?? []) subcategories.add(s);

  const promos = accountPromos(company, now);
  const own = promos.own.filter((p) => keys.has(p.key));
  const competitors = promos.competitors.filter((p) => subcategories.has(subcategoryOf(p.segment)));

  // The summary needs every store cell; it is computed on first read, so pages that only filter skip it.
  let summary: AreaSummary | null = null;
  const summarise = (): AreaSummary => {
    const cells = keys.size ? accountCells(company, undefined, now).filter((c) => keys.has(c.key)) : [];
    const cellsByKey = new Map<string, typeof cells>();
    for (const c of cells) cellsByKey.set(c.key, [...(cellsByKey.get(c.key) ?? []), c]);
    let widest: AreaSummary["widestSpread"] = null;
    for (const p of products) {
      const s = spreadOf(cellsByKey.get(p.key) ?? []);
      if (s && (!widest || s.pct > widest.pct || (s.pct === widest.pct && s.stores > widest.stores))) widest = { key: p.key, name: p.name, ...s };
    }
    const live = own.filter((p) => p.active);
    return {
      company,
      products: products.length,
      storesSeen: new Set(cells.map((c) => c.storeId)).size,
      storeScopesTotal: bannerTotals().reduce((n, b) => n + b.stores, 0),
      livePromos: live.length,
      endingSoon: live.filter((p) => {
        const t = validUntil(p.validTo);
        return t != null && t <= now + ENDING_SOON_MS;
      }).length,
      promoStoreListings: cells.filter((c) => c.promo?.active).length,
      widestSpread: widest,
      competitorPromos: competitors.filter((p) => p.active).length,
      subcategories: subs,
    };
  };
  const subs = [...subcategories].sort();
  return {
    favourites,
    sets,
    empty: favourites.length === 0,
    tree: buildTree(all, sets),
    all,
    products,
    subcategories: subs,
    get summary() {
      return (summary ??= summarise());
    },
    own,
    competitors,
    allPromos: promos,
  };
}

export function categoryTree(company = ACCOUNT_COMPANY, now = Date.now()): CategoryNode[] {
  return buildTree(accountProducts(company, now), favouriteSets());
}

export function areaProducts(company = ACCOUNT_COMPANY, now = Date.now()): AccountProduct[] {
  const sets = favouriteSets();
  return accountProducts(company, now).filter((p) => isInArea(p, sets));
}

export function areaSummary(company = ACCOUNT_COMPANY, now = Date.now()): AreaSummary {
  return areaView(company, now).summary;
}

export function areaPromos(company = ACCOUNT_COMPANY, now = Date.now()): { own: AccountPromo[]; competitors: AccountPromo[] } {
  const v = areaView(company, now);
  return { own: v.own, competitors: v.competitors };
}
