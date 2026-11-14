/**
 * Product classification for Delta.
 *
 * Everything here is deterministic and explainable: a product lands in a comparison group because a
 * named rule matched its retailer product name, never because a model guessed. Products that match no
 * rule stay "Uncategorised" and are excluded from competitive comparisons.
 */

export const DEMO_CATEGORY = "Chocolate & confectionery";

export interface SegmentRule {
  /** Comparison group: only products in the same segment are compared with each other. */
  segment: string;
  category: string;
  test: RegExp;
  /** Explains why products in this group are comparable. Shown in the UI next to the sample size. */
  basis: string;
}

/** Names that mention chocolate but are not confectionery (drinks, ice cream, porridge, bread). */
const NOT_CONFECTIONERY = /jäätelö|juoma|puuro|kaurajuoma|proteiini|rieska|leipä|kakku|piirak|torttu|puikula|jogurtti/i;

export const SEGMENT_RULES: SegmentRule[] = [
  { segment: "Advent calendars", category: DEMO_CATEGORY, test: /joulukalenteri|suklaakalenteri/i, basis: "Seasonal chocolate and sweets calendars, compared per kg" },
  { segment: "Chocolate tablets", category: DEMO_CATEGORY, test: /suklaalevy/i, basis: "Filled and plain chocolate tablets (150–250 g), compared per kg" },
  { segment: "Chocolate bars", category: DEMO_CATEGORY, test: /suklaapatukka/i, basis: "Single-serve chocolate bars (45–60 g), compared per kg" },
  {
    segment: "Boxed chocolates & pralines",
    category: DEMO_CATEGORY,
    test: /konveht|suklaakuulat|suklaapallot/i,
    basis: "Gift boxes, pralines and chocolate balls, compared per kg",
  },
  {
    segment: "Chocolate-coated fruit",
    category: DEMO_CATEGORY,
    test: /trü frü|fruit dips|drips/i,
    basis: "Fruit pieces coated in chocolate, compared per kg",
  },
  { segment: "Sweets & liquorice", category: DEMO_CATEGORY, test: /^malaco|remix|aakkoset|juleskum|karkki|makeis|lakritsi/i, basis: "Bagged sweets and liquorice, compared per kg" },
  { segment: "Sweet biscuits", category: DEMO_CATEGORY, test: /domino|täytekeksi|herkuttelukeksi/i, basis: "Filled and chocolate biscuits, compared per kg" },
  { segment: "Seasonal & gift", category: DEMO_CATEGORY, test: /a^/, basis: "Seasonal chocolates and gift packs, compared per kg" },
];

/** The retailer's own category page, used when no name rule matches. */
const RETAILER_CATEGORY: Record<string, string> = {
  "suklaat/suklaalevyt": "Chocolate tablets",
  "suklaat/suklaapatukat": "Chocolate bars",
  "suklaat/konvehtirasiat": "Boxed chocolates & pralines",
  "suklaat/kaareelliset-konvehtirasiat": "Boxed chocolates & pralines",
  "karkkipussit/karkkipussit": "Sweets & liquorice",
  "muut-makeiset/laku-ja-toffeepatukat": "Sweets & liquorice",
  "muut-makeiset/makeisjoulukalenterit": "Advent calendars",
  suklaalevyt: "Chocolate tablets",
  "suklaa-ja-toffeepatukat": "Chocolate bars",
  karkkipussit: "Sweets & liquorice",
  karkkilaatikot: "Sweets & liquorice",
  "lakut-ja-tikkarit": "Sweets & liquorice",
  "sesonki-ja-lahjamakeiset": "Seasonal & gift",
  // Wolt Market
  "suklaapatukat": "Chocolate bars",
  "karkkipussit-laatikot": "Sweets & liquorice",
  "patukat-tikkarit": "Sweets & liquorice",
  kausimakeiset: "Seasonal & gift",
};

export function classify(name: string, retailerCategory?: string | null): { category: string; segment: string | null; rule: string | null } {
  for (const r of SEGMENT_RULES) {
    if (!r.test.test(name)) continue;
    // Calendars may mention chocolate drinks etc.; for the rest, drop non-confectionery look-alikes.
    if (r.segment !== "Advent calendars" && NOT_CONFECTIONERY.test(name)) continue;
    return { category: r.category, segment: r.segment, rule: r.test.source };
  }
  const seg = retailerCategory ? RETAILER_CATEGORY[retailerCategory] : undefined;
  if (seg) return { category: DEMO_CATEGORY, segment: seg, rule: `retailer category: ${retailerCategory}` };
  return { category: "Uncategorised", segment: null, rule: null };
}

export function segmentBasis(segment: string): string {
  return SEGMENT_RULES.find((r) => r.segment === segment)?.basis ?? "";
}

// ------------------------------------------------------------------ brands

interface BrandDef {
  brand: string;
  /** Prefix (lower case) of the retailer product name. */
  prefixes: string[];
  /**
   * Brand owner, from public company information (curated reference data, not scraped).
   * null where we are not certain; the UI then groups the brand on its own.
   */
  manufacturer: string | null;
}

const B = (brand: string, manufacturer: string | null, ...prefixes: string[]): BrandDef => ({ brand, manufacturer, prefixes: prefixes.length ? prefixes : [brand.toLowerCase()] });

export const BRANDS: BrandDef[] = [
  // Fazer
  B("Fazer", "Fazer", "karl fazer", "fazerin", "fazer"),
  B("Pätkis", "Fazer"),
  B("Tyrkisk Peber", "Fazer", "tyrkisk peber"),
  B("Dumle", "Fazer"),
  // Mondelēz
  B("Marabou", "Mondelēz"),
  B("Daim", "Mondelēz"),
  B("Milka", "Mondelēz"),
  B("Toblerone", "Mondelēz"),
  B("Oreo", "Mondelēz"),
  B("Cadbury", "Mondelēz"),
  B("Mirabell", "Mondelēz"),
  // Cloetta
  B("Malaco", "Cloetta"),
  B("Tupla", "Cloetta"),
  B("BonBon", "Cloetta"),
  B("Cloetta", "Cloetta"),
  B("Center", "Cloetta"),
  B("Jenkki", "Cloetta"),
  B("Pändy", "Cloetta"),
  B("Läkerol", "Cloetta"),
  B("Kexchoklad", "Cloetta"),
  // Orkla
  B("Panda", "Orkla"),
  // Ferrero
  B("Kinder", "Ferrero"),
  B("Ferrero", "Ferrero"),
  B("Raffaello", "Ferrero"),
  // Nestlé
  B("Nestlé", "Nestlé", "after eight, kitkat, smarties ja nestlé", "nestlé"),
  B("KitKat", "Nestlé", "kitkat", "kit kat"),
  B("After Eight", "Nestlé", "after eight"),
  B("Smarties", "Nestlé"),
  B("Lion", "Nestlé", "lion "),
  B("Quality Street", "Nestlé", "quality street"),
  B("Baci", "Nestlé", "baci"),
  // Mars
  B("Mars", "Mars", "mars "),
  B("Snickers", "Mars"),
  B("Twix", "Mars"),
  B("M&M's", "Mars", "m&m"),
  B("Bounty", "Mars"),
  B("Milky Way", "Mars", "milky way"),
  B("Maltesers", "Mars"),
  B("Skittles", "Mars"),
  B("Dove", "Mars", "dove "),
  // Others with well-known owners
  B("Haribo", "Haribo", "haribo"),
  B("Maoam", "Haribo", "maoam"),
  B("Lindt", "Lindt & Sprüngli"),
  B("Toffifee", "Storck"),
  B("Riesen", "Storck"),
  B("Werther's", "Storck", "werther"),
  B("Anthon Berg", "Toms Group", "anthon berg"),
  B("Toms", "Toms Group", "toms "),
  B("Chupa Chups", "Perfetti Van Melle", "chupa chups"),
  B("Reese's", "Hershey", "reese"),
  B("Ritter Sport", "Alfred Ritter", "ritter"),
  B("Brunberg", "Brunberg"),
  B("Halva", "Halva"),
  B("BUBS", "BUBS", "bubs"),
  // Retailer private labels
  B("Pirkka", "Kesko (private label)", "pirkka"),
  B("K-Menu", "Kesko (private label)", "k-menu"),
  B("Coop", "S Group (private label)", "coop "),
  B("Xtra", "S Group (private label)", "xtra"),
  B("Rainbow", "S Group (private label)", "rainbow"),
  B("Favorina", "Lidl (private label)", "favorina"),
  // Owner not set
  B("Terry's", null),
  B("Trü Frü", null),
  B("Fruit Dips", null, "fruit dips"),
  B("Dave & Jon's", null, "dave & jon"),
  B("Baileys", null),
  B("Guylian", null, "guylian"),
  B("Niederegger", null),
];

/** First words that are product types, not brands. */
const NOT_A_BRAND = new Set(["joulukalenteri", "karkkipussi", "makea", "talvi", "talvikonvehti", "the", "belgian", "joulun", "sour", "super", "gummi", "5-pack", "santa's", "vanhat", "lauantai", "herkku", "suklaakuorrutteiset", "pehmeä", "suklaakalenteri"]);

export function brandOf(name: string, retailerBrand?: string | null): { brand: string | null; manufacturer: string | null; source: "name" | "retailer" | "first-word" | null } {
  const n = name.toLowerCase().trim();
  for (const b of BRANDS) if (b.prefixes.some((p) => n.startsWith(p))) return { brand: b.brand, manufacturer: b.manufacturer, source: "name" };
  const rb = retailerBrand?.trim();
  if (rb && rb !== "-") {
    const hit = BRANDS.find((b) => b.prefixes.some((p) => rb.toLowerCase().startsWith(p.trim())));
    if (hit) return { brand: hit.brand, manufacturer: hit.manufacturer, source: "retailer" };
    return { brand: titleCase(rb), manufacturer: null, source: "retailer" };
  }
  // Fallback: the first word, when it looks like a brand. Marked as such; owner unknown.
  const first = name.trim().split(/\s+/)[0];
  if (first && /^\p{Lu}/u.test(first) && !NOT_A_BRAND.has(first.toLowerCase())) return { brand: titleCase(first.replace(/[´`]/g, "'")), manufacturer: null, source: "first-word" };
  return { brand: null, manufacturer: null, source: null };
}

/** "Company" = brand owner when known, otherwise the brand itself. Used by the company selector. */
export function companyOf(brand: string | null, manufacturer: string | null): string | null {
  return manufacturer ?? brand;
}

function titleCase(s: string) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

// ------------------------------------------------------------------ retailers and store scopes

export interface ScopeInfo {
  id: string;
  retailer: "S Group" | "Kesko" | "Lidl" | "Wolt" | "Other";
  banner: string;
  /** store = prices verified for one physical store; chain = chain-wide offers valid across the banner */
  level: "store" | "chain";
}

export function scopeInfo(scopeId: string, storeChain?: string | null): ScopeInfo {
  if (scopeId === "chain:lidl") return { id: scopeId, retailer: "Lidl", banner: "Lidl", level: "chain" };
  if (scopeId.startsWith("wolt-market")) return { id: scopeId, retailer: "Wolt", banner: "Wolt Market", level: "store" };
  if (scopeId === "chain:k-supermarket") return { id: scopeId, retailer: "Kesko", banner: "K-Supermarket", level: "chain" };
  if (scopeId === "chain:k-market") return { id: scopeId, retailer: "Kesko", banner: "K-Market", level: "chain" };
  if (scopeId === "chain:k-citymarket") return { id: scopeId, retailer: "Kesko", banner: "K-Citymarket", level: "chain" };
  const c = storeChain ?? scopeId.split("-")[0];
  if (c === "sok" || scopeId.startsWith("sok-prisma")) return { id: scopeId, retailer: "S Group", banner: "Prisma", level: "store" };
  if (c === "smarket") return { id: scopeId, retailer: "S Group", banner: "S-market", level: "store" };
  if (c === "alepa") return { id: scopeId, retailer: "S Group", banner: "Alepa", level: "store" };
  if (c === "kesko") return { id: scopeId, retailer: "Kesko", banner: "K-Citymarket", level: "store" };
  if (c === "herkku") return { id: scopeId, retailer: "S Group", banner: "Food Market Herkku", level: "store" };
  if (c === "kmarket") return { id: scopeId, retailer: "Kesko", banner: "K-Market", level: "store" };
  if (c === "ksupermarket") return { id: scopeId, retailer: "Kesko", banner: "K-Supermarket", level: "store" };
  if (c === "lidl") return { id: scopeId, retailer: "Lidl", banner: "Lidl", level: "store" };
  return { id: scopeId, retailer: "Other", banner: c, level: "store" };
}

/**
 * Coverage area: Helsinki stores with their own online prices. Lidl is left out because it publishes no
 * store prices online, and stores outside Helsinki are kept in the database but excluded from every view.
 */
export const AREA_CITY = "Helsinki";
export const EXCLUDED_RETAILERS = ["Lidl"];
/** SQL condition on a stores row aliased `s`. */
export const AREA_SQL = `(s.city = '${AREA_CITY}' AND s.level = 'store' AND s.retailer NOT IN (${EXCLUDED_RETAILERS.map((r) => `'${r}'`).join(",")}))`;

/**
 * The dashboard panel: one store per banner in Helsinki, each with store-level prices from its own
 * category pages. Every other Helsinki store feeds the all-store views (store price index, K vs S gap,
 * store outliers).
 */
export const DEMO_SCOPES = ["sok-prisma-kannelmaki", "smarket-arabia", "alepa-kamppi", "kesko-kcm-ruoholahti", "ksupermarket-kamppi", "kmarket-alppila", "wolt-market-kamppi"];
