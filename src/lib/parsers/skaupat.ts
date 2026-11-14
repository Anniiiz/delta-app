import { parseMoney, parsePackSize, parseComparisonUnit, type BaseUnit } from "../units";

/**
 * S-kaupat (S Group online store).
 * - Search results render client-side; Context.dev markdown captures them after a wait.
 * - Product pages embed Apollo state in __NEXT_DATA__ with store-specific pricing:
 *   currentPrice, regularPrice, campaignPrice, campaignPriceValidUntil, lowest30DayPrice.
 */

export interface SkaupatCandidate {
  name: string;
  url: string;
  ean: string;
  price: number | null;
  unitPrice: number | null;
  unitPriceUnit: BaseUnit | null;
}

const LINK_RE = /\[([^\]\n]{3,160})\]\((https:\/\/www\.s-kaupat\.fi\/tuote\/[^)\s/]+\/(\d{6,14}))\)/g;

export function parseSkaupatSearchMarkdown(md: string): SkaupatCandidate[] {
  const out: SkaupatCandidate[] = [];
  const seen = new Set<string>();
  const matches = [...md.matchAll(LINK_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const [, name, url, ean] = m;
    if (seen.has(ean)) continue;
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? md.length : Math.min(md.length, start + 600);
    const block = md.slice(start, end);
    // "1,39 €1,39 €/lVertailuhinta 1,39 €/l" (campaigns may show more than one price; product page resolves)
    const priceM = block.match(/(\d+,\d{2})\s*€(?!\s*\/)/);
    const unitM = block.match(/Vertailuhinta\s*(\d+,\d{2})\s*€\/(l|kg|kpl)/i);
    seen.add(ean);
    out.push({
      name: name.trim(),
      url,
      ean,
      price: priceM ? parseMoney(priceM[1]) : null,
      unitPrice: unitM ? parseMoney(unitM[1]) : null,
      unitPriceUnit: unitM ? parseComparisonUnit("/" + unitM[2]) : null,
    });
  }
  return out;
}

export interface SkaupatProduct {
  name: string;
  ean: string | null;
  brand: string | null;
  imageUrl: string | null;
  storeId: string | null;
  storeName: string | null;
  currentPrice: number;
  regularPrice: number | null;
  campaignPrice: number | null;
  campaignValidUntil: string | null;
  lowest30DayPrice: number | null;
  comparisonPrice: number | null;
  comparisonUnit: BaseUnit | null;
  isApproximate: boolean;
  sizeValue: number | null;
  sizeUnit: BaseUnit | null;
  byWeight: boolean;
  discountRuleText: string | null;
  /** S-kaupat may fall back to a chain-wide price when the store has no price */
  isGlobalFallback: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function parseSkaupatProductHtml(html: string, url: string): SkaupatProduct | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let nd: Any;
  try {
    nd = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const ap: Record<string, Any> = nd?.props?.pageProps?.apolloState ?? {};
  const eanFromUrl = url.match(/\/(\d{6,14})(?:[/?#]|$)/)?.[1] ?? null;

  const root = ap.ROOT_QUERY ?? {};
  const currentStoreId: string | null = root.currentStoreId ?? null;

  // Product entity with pricing
  const products = Object.values(ap).filter((v: Any) => v && v.__typename === "Product" && v.pricing);
  let product: Any =
    products.find((p: Any) => eanFromUrl && (p.ean === eanFromUrl || String(p.id ?? "").includes(eanFromUrl))) ?? products[0];
  // Fallback: product data may live under ROOT_QUERY keys
  if (!product) {
    for (const [k, v] of Object.entries(root)) {
      if (k.startsWith("product(") && v && typeof v === "object" && (v as Any).pricing) {
        product = v;
        break;
      }
      if (k.startsWith("product(") && v && (v as Any).__ref && ap[(v as Any).__ref]?.pricing) {
        product = ap[(v as Any).__ref];
        break;
      }
    }
  }
  if (!product) return null;

  // Store-specific pricing edge (ProductStoreEdge) is preferred when present
  const edge: Any = Object.values(ap).find((v: Any) => v && v.__typename === "ProductStoreEdge" && v.pricing);
  const pricing: Any = edge?.pricing ?? product.pricing;
  const storeObj: Any = Object.values(ap).find((v: Any) => v && v.__typename === "Store" && v.name);

  const name: string = product.name;
  const size = parsePackSize(name);
  const salesUnit = (pricing.salesUnit ?? product.priceUnit) as string | undefined;
  const cmpUnit = parseComparisonUnit(pricing.comparisonUnit ?? product.comparisonUnit);
  // Loose produce is listed per piece at an approximate price; the reliable figure is the per-kg price.
  const approxPerPiece = Boolean(pricing.isApproximatePrice) && cmpUnit === "kg" && salesUnit !== "KGM";
  const byWeight = salesUnit === "KGM" || product.priceUnit === "KGM" || approxPerPiece;

  const rawCurrent = Number(pricing.currentPrice);
  if (!Number.isFinite(rawCurrent) || rawCurrent <= 0) return null;
  const factor = approxPerPiece && pricing.comparisonPrice ? Number(pricing.comparisonPrice) / rawCurrent : 1;
  const conv = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * factor * 100) / 100);
  const current = conv(rawCurrent)!;
  const regular = conv(pricing.regularPrice);
  const campaign = conv(pricing.campaignPrice);
  const tmpl: string | undefined = product.productDetails?.productImages?.mainImage?.urlTemplate;
  const img: string | null = tmpl ? tmpl.replace("{MODIFIERS}", "w_200,h_200,q_75").replace("{EXTENSION}", "jpg") : null;

  return {
    name,
    ean: product.ean ?? eanFromUrl,
    brand: product.brandName ?? product.brand ?? null,
    imageUrl: img,
    storeId: currentStoreId ?? storeObj?.id ?? null,
    storeName: storeObj?.name ?? null,
    currentPrice: current,
    regularPrice: regular,
    campaignPrice: campaign,
    campaignValidUntil: pricing.campaignPriceValidUntil ?? null,
    lowest30DayPrice: conv(pricing.lowest30DayPrice),
    comparisonPrice: pricing.comparisonPrice != null ? Number(pricing.comparisonPrice) : null,
    comparisonUnit: cmpUnit,
    isApproximate: Boolean(pricing.isApproximatePrice),
    sizeValue: byWeight ? 1 : size?.value ?? null,
    sizeUnit: byWeight ? "kg" : size?.unit ?? null,
    byWeight: Boolean(byWeight),
    isGlobalFallback: Boolean(product.isGlobalFallback),
    discountRuleText: pricing.primaryDiscountRule ? JSON.stringify(pricing.primaryDiscountRule).slice(0, 300) : null,
  };
}
