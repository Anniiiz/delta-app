import { parsePackSize, round, type BaseUnit } from "./units";

/**
 * Normalisation rules. Pure functions so they can be tested and re-run on any import.
 *
 * Principles:
 * - The raw retailer values are kept next to every normalised value.
 * - A unit price is only computed from a known, single pack size. Size ranges ("280–340 g") and
 *   sizes that contradict the retailer's own comparison price are flagged and left out of comparisons.
 * - A promotion is only "verified" when the retailer page itself advertised it (campaign, multi-buy or
 *   loyalty price). A lower price than last time is an "observed price change", never a promotion.
 * - A discount percentage is only shown when the retailer stated a reference price (regular price or
 *   the EU Omnibus lowest 30-day price).
 */

export interface SizeInfo {
  value: number | null; // in base unit (kg / l / pcs)
  unit: BaseUnit | null;
  source: "retailer" | "name" | "url" | null;
  /** "280-340 g": the pack varies, so a single unit price would be misleading. */
  isRange: boolean;
  rangeMin: number | null;
  rangeMax: number | null;
  rawText: string | null;
}

const RANGE_RE = /(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i;

export function resolveSize(p: { name: string; url?: string | null; size_value?: number | null; size_unit?: string | null }): SizeInfo {
  const range = p.name.match(RANGE_RE);
  if (range) {
    const f = /^(g|ml)$/i.test(range[3]) ? 0.001 : 1;
    const unit: BaseUnit = /l$/i.test(range[3]) ? "l" : "kg";
    const a = Number(range[1].replace(",", ".")) * f;
    const b = Number(range[2].replace(",", ".")) * f;
    return { value: null, unit, source: "name", isRange: true, rangeMin: round(a), rangeMax: round(b), rawText: range[0] };
  }
  if (p.size_value != null && p.size_value > 0 && p.size_unit) {
    return { value: p.size_value, unit: p.size_unit as BaseUnit, source: "retailer", isRange: false, rangeMin: null, rangeMax: null, rawText: `${p.size_value} ${p.size_unit}` };
  }
  const fromName = parsePackSize(p.name);
  if (fromName && !fromName.byWeight) return { value: fromName.value, unit: fromName.unit, source: "name", isRange: false, rangeMin: null, rangeMax: null, rawText: p.name };
  // Last resort: the product URL slug ("haribo-makeisjoulukalenteri-300g-4001686026205")
  const slug = p.url?.match(/[/-](\d+(?:[.,]\d+)?)(g|kg|ml|l)(?=[-/?]|$)/i);
  if (slug) {
    const fromUrl = parsePackSize(`${slug[1]} ${slug[2]}`);
    if (fromUrl) return { value: fromUrl.value, unit: fromUrl.unit, source: "url", isRange: false, rangeMin: null, rangeMax: null, rawText: slug[0] };
  }
  return { value: null, unit: null, source: null, isRange: false, rangeMin: null, rangeMax: null, rawText: null };
}

export interface RawSnapshot {
  price: number;
  regular_price: number | null;
  lowest_30d: number | null;
  unit_price: number | null;
  unit_price_unit: string | null;
  promo_kind: string | null;
  promo_label: string | null;
  promo_valid_from: string | null;
  promo_valid_to: string | null;
  loyalty: string | null;
  multibuy_qty: number | null;
  multibuy_price: number | null;
}

export type QualityFlag =
  | "size_missing"
  | "size_range"
  | "size_from_url"
  | "size_conflict"
  | "stated_unit_price_without_unit"
  | "reference_price_missing"
  | "reference_is_bundle_total";

export interface NormalizedPrice {
  /** Price for one pack on the shelf (what one unit costs without buying several or a loyalty card). */
  shelfPrice: number;
  unitPrice: number | null;
  unitBase: BaseUnit | null;
  /** Lowest per-pack price available through a verified offer (multi-buy share or loyalty price). */
  offerPrice: number | null;
  offerUnitPrice: number | null;
  flags: QualityFlag[];
}

export function normalizePrice(s: RawSnapshot, size: SizeInfo): NormalizedPrice {
  const flags: QualityFlag[] = [];
  let unitPrice: number | null = null;
  if (size.isRange) flags.push("size_range");
  else if (size.value == null) flags.push("size_missing");
  else {
    if (size.source === "url") flags.push("size_from_url");
    unitPrice = round(s.price / size.value, 2);
  }

  // Retailer-stated comparison price: trust it only when its unit is stated, and use it to sanity-check the size.
  if (s.unit_price != null && !s.unit_price_unit) {
    // K-Ruoka flyer rows repeat the shelf price here; Lidl states a comparison price without a unit.
    if (Math.abs(s.unit_price - s.price) > 0.005) {
      flags.push("stated_unit_price_without_unit");
      if (unitPrice != null && Math.abs(unitPrice - s.unit_price) / s.unit_price > 0.05) {
        flags.push("size_conflict");
        unitPrice = null;
      }
    }
  }

  let offerPrice: number | null = null;
  if (s.multibuy_price != null && s.multibuy_qty) offerPrice = round(s.multibuy_price / s.multibuy_qty, 2);
  else if (s.promo_kind === "loyalty" && s.multibuy_price != null) offerPrice = s.multibuy_price; // member price
  if (offerPrice != null && offerPrice >= s.price) offerPrice = null;
  const offerUnitPrice = offerPrice != null && unitPrice != null && size.value ? round(offerPrice / size.value, 2) : null;

  if (isBundleTotal(s)) flags.push("reference_is_bundle_total");
  if (s.promo_kind && referencePrice(s) == null) flags.push("reference_price_missing");
  return { shelfPrice: s.price, unitPrice, unitBase: size.unit, offerPrice, offerUnitPrice, flags };
}

export type PromoType = "campaign" | "multibuy" | "loyalty";

export interface PromotionInfo {
  type: PromoType;
  label: string;
  /** Effective price per pack under the offer. */
  offerPrice: number;
  referencePrice: number | null;
  referenceKind: "regular" | "lowest_30d" | null;
  /** Only when the retailer stated a reference price. */
  discountPct: number | null;
  validFrom: string | null;
  validTo: string | null;
  loyalty: string | null;
  conditions: string | null;
}

/**
 * Lidl multi-buy rows carry the bundle's regular total in the 30-day field (e.g. 4 × €3.85 = €15.40).
 * Recognised exactly (qty × shelf price), it is converted back to a per-pack regular price.
 */
export function isBundleTotal(s: RawSnapshot): boolean {
  return s.lowest_30d != null && !!s.multibuy_qty && s.multibuy_qty > 1 && Math.abs(s.lowest_30d - s.multibuy_qty * s.price) < 0.015;
}

export function referencePrice(s: RawSnapshot): { value: number; kind: "regular" | "lowest_30d" } | null {
  if (s.regular_price != null && s.regular_price > 0) return { value: s.regular_price, kind: "regular" };
  if (isBundleTotal(s)) return { value: round(s.lowest_30d! / s.multibuy_qty!, 2), kind: "regular" };
  // A 30-day lowest more than twice the shelf price is not plausible for one pack; don't build a discount on it.
  if (s.lowest_30d != null && s.lowest_30d > 0 && s.lowest_30d <= s.price * 2) return { value: s.lowest_30d, kind: "lowest_30d" };
  return null;
}

/** A verified, retailer-advertised promotion, or null. Never inferred from price movements. */
export function promotionOf(s: RawSnapshot): PromotionInfo | null {
  const kind = s.promo_kind as PromoType | null;
  if (!kind || !["campaign", "multibuy", "loyalty"].includes(kind)) return null;
  const ref = referencePrice(s);
  let offer = s.price;
  let conditions: string | null = null;
  if (kind === "multibuy" && s.multibuy_qty && s.multibuy_price != null) {
    offer = round(s.multibuy_price / s.multibuy_qty, 2);
    conditions = `Buy ${s.multibuy_qty} for €${s.multibuy_price.toFixed(2)}`;
  } else if (kind === "loyalty" && s.multibuy_price != null) {
    offer = s.multibuy_price;
    conditions = "Loyalty-card price";
  }
  if (s.loyalty) conditions = [conditions, loyaltyName(s.loyalty) + " required"].filter(Boolean).join(" · ");
  // For multi-buy the reference is the single-pack regular price, when the retailer stated it.
  const refValue = ref?.value ?? null;
  const discountPct = refValue != null && refValue > offer ? round(((refValue - offer) / refValue) * 100, 1) : null;
  return {
    type: kind,
    label: s.promo_label ?? kind,
    offerPrice: offer,
    referencePrice: refValue,
    referenceKind: ref?.kind ?? null,
    discountPct,
    validFrom: s.promo_valid_from,
    validTo: s.promo_valid_to,
    loyalty: s.loyalty,
    conditions,
  };
}

export function loyaltyName(code: string): string {
  return ({ k_plussa: "K-Plussa card", s_etukortti: "S-Etukortti", lidl_plus: "Lidl Plus" } as Record<string, string>)[code] ?? code;
}

/** Validity end as a comparable instant. Date-only values ("2026-11-15") run to the end of that day in Helsinki. */
export function validUntil(validTo: string | null): number | null {
  if (!validTo) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(validTo)) return Date.parse(`${validTo}T23:59:59+02:00`);
  const t = Date.parse(validTo);
  return Number.isFinite(t) ? t : null;
}

export const FLAG_TEXT: Record<QualityFlag, string> = {
  size_missing: "Pack size not stated; no unit price",
  size_range: "Pack size is a range; unit price not comparable",
  size_from_url: "Pack size read from the product URL",
  size_conflict: "Retailer's comparison price contradicts the stated pack size; excluded from unit-price comparisons",
  stated_unit_price_without_unit: "Retailer stated a comparison price without a unit",
  reference_price_missing: "Retailer did not state a regular or 30-day reference price; no discount % shown",
  reference_is_bundle_total: "Reference price was the multi-buy bundle total; converted to a per-pack regular price",
};
