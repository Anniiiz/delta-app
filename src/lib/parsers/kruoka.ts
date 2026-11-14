import { parseMoney, parsePackSize, type BaseUnit } from "../units";

/**
 * K-Ruoka (Kesko). Prices shown are for the selected store; Context.dev fetches
 * resolve to K-Citymarket Espoo Iso Omena. robots.txt disallows search URLs
 * (?haku=), so discovery uses category pages and product pages only.
 *
 * Listing markdown blocks look like:
 *   - [Pirkka suomalainen kevytmaito 1l](https://www.k-ruoka.fi/kauppa/tuote/pirkka-kevytmaito-1-l-6410405082657)
 *    Hinta 0,99 € kappale ... Yksikköhinta 0,99 € litra
 * Plussa (loyalty) offers:
 *    Plussa-etu  −10 %  Etuhinta Plussa-kortilla 1,75 € kappale ... Ilman Plussa-korttia 1,95 € kappale
 * Personal OmaPlussa offers (need activation) show "Etuhinta X € ... norm. Y ... Aktivoi etu".
 */

export interface KruokaListing {
  name: string;
  url: string;
  ean: string | null;
  /** Price paid without any loyalty card. */
  price: number | null;
  /** Price with K-Plussa card, when a Plussa offer applies. */
  plussaPrice: number | null;
  /** Personal OmaPlussa price that requires activation (never used in totals). */
  personalOfferPrice: number | null;
  unitPrice: number | null;
  unitPriceUnit: BaseUnit | null;
  sizeValue: number | null;
  sizeUnit: BaseUnit | null;
  byWeight: boolean;
  discountPercent: number | null;
}

const ITEM_RE = /\[([^\]\n]{3,200})\]\((https:\/\/www\.k-ruoka\.fi\/kauppa\/tuote\/[^)\s]+)\)/g;

const UNIT_WORD: Record<string, BaseUnit> = { litra: "l", kilogramma: "kg", kappale: "pcs" };

export function parseKruokaListingMarkdown(md: string): KruokaListing[] {
  const out: KruokaListing[] = [];
  const seen = new Set<string>();
  const matches = [...md.matchAll(ITEM_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const [, rawName, url] = m;
    if (seen.has(url)) continue;
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? md.length : Math.min(md.length, start + 800);
    const block = md.slice(start, end);
    if (!/Hinta|Etuhinta/.test(block)) continue; // navigation links, not products
    seen.add(url);
    out.push(parseKruokaPriceBlock(rawName.trim(), url, block));
  }
  return out;
}

export function parseKruokaPriceBlock(name: string, url: string, block: string): KruokaListing {
  const ean = url.match(/-(\d{8,14})(?:-n\d+)?(?:[/?#]|$)/)?.[1] ?? null;
  let price: number | null = null;
  let plussaPrice: number | null = null;
  let personalOfferPrice: number | null = null;

  const plain = block.match(/(?:^|\n)\s*Hinta\s+(noin\s+)?(\d+,\d{2})\s*€\s*(kappale|kilogramma|litra|rasia|pussi|pkt|ps|rs)?/);
  const plussa = block.match(/Etuhinta Plussa-kortilla\s+(\d+,\d{2})\s*€/);
  const without = block.match(/Ilman Plussa-korttia\s+(\d+,\d{2})\s*€/);
  const personal = /Aktivoi etu/.test(block) ? block.match(/Etuhinta\s+(\d+,\d{2})\s*€/) : null;
  const norm = block.match(/norm\.\s*(\d+,\d{2})/i);

  if (plussa && without) {
    plussaPrice = parseMoney(plussa[1]);
    price = parseMoney(without[1]);
  } else if (personal) {
    personalOfferPrice = parseMoney(personal[1]);
    price = norm ? parseMoney(norm[1]) : null;
  } else if (plain) {
    price = parseMoney(plain[2]);
  }

  const unitM = block.match(/Yksikköhinta\s+(\d+,\d{2})\s*€\s*(litra|kilogramma|kappale)/);
  const pct = block.match(/−\s?(\d{1,2})\s?%/);
  const size = parsePackSize(name);
  const approx = Boolean(plain?.[1]);
  const byWeight = plain?.[3] === "kilogramma" || ((approx || /-kg-/.test(url)) && unitM?.[2] === "kilogramma");
  // Loose produce: shelf price is per kg (the per-piece figure is only an estimate)
  if (byWeight && unitM && unitM[2] === "kilogramma") price = parseMoney(unitM[1]);
  return {
    name,
    url: url.split("?")[0],
    ean,
    price,
    plussaPrice,
    personalOfferPrice,
    unitPrice: unitM ? parseMoney(unitM[1]) : null,
    unitPriceUnit: unitM ? UNIT_WORD[unitM[2]] : null,
    sizeValue: byWeight ? 1 : size?.value ?? null,
    sizeUnit: byWeight ? "kg" : size?.unit ?? null,
    byWeight,
    discountPercent: pct ? Number(pct[1]) : null,
  };
}

export interface KruokaProduct extends KruokaListing {
  brand: string | null;
  imageUrl: string | null;
  seller: string | null;
  regularPrice: number | null;
  validity: { from: string | null; to: string | null } | null;
}

/** Parses a product page: JSON-LD for identity/seller/price, markdown for loyalty and offer conditions. */
export function parseKruokaProductPage(html: string | null, md: string | null, url: string): KruokaProduct | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ld: any = null;
  if (html) {
    for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        const parsed = JSON.parse(m[1]);
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [parsed];
        ld = arr.find((x) => x?.["@type"] === "Product") ?? ld;
      } catch {
        /* ignore */
      }
    }
  }
  const title = md?.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ld?.name ?? null;
  if (!title) return null;
  const head = md ? md.slice(md.indexOf("# ") >= 0 ? md.indexOf("# ") : 0, (md.indexOf("# ") >= 0 ? md.indexOf("# ") : 0) + 1500) : "";
  const listing = parseKruokaPriceBlock(title, url, head);
  const ldPrice = ld?.offers?.priceSpecification?.price ?? ld?.offers?.price ?? null;
  if (listing.price == null && ldPrice != null) listing.price = Number(ldPrice);
  const validM = head.match(/(?:voimassa|Voimassa)\s*(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)\s*[-–]\s*(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)/);
  const img = Array.isArray(ld?.image) ? ld.image[0] : ld?.image ?? null;
  return {
    ...listing,
    brand: ld?.brand?.name ?? null,
    imageUrl: typeof img === "string" ? img : null,
    seller: ld?.offers?.seller?.name ?? null,
    regularPrice: listing.plussaPrice != null ? listing.price : null,
    validity: validM ? { from: validM[1], to: validM[2] } : null,
  };
}
