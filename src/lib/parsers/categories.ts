import { parseMoney, parseComparisonUnit } from "../units";
import { parseKruokaListingMarkdown } from "./kruoka";
import type { RawSnapshot } from "../normalize";

/**
 * Parsers for retailer category pages (markdown captured by Context.dev). Each returns one listing per
 * product with a raw snapshot in the same shape as the imported seed data, so the same
 * normalisation and promotion rules apply. Values are only read, never guessed: anything the page does
 * not state stays null.
 */

export interface CategoryListing {
  name: string;
  url: string;
  /** retailer product id: EAN for S-kaupat and K-Ruoka, product number for Lidl */
  sku: string;
  ean: string | null;
  brand: string | null;
  snapshot: RawSnapshot;
}

const empty = (price: number): RawSnapshot => ({
  price,
  regular_price: null,
  lowest_30d: null,
  unit_price: null,
  unit_price_unit: null,
  promo_kind: null,
  promo_label: null,
  promo_valid_from: null,
  promo_valid_to: null,
  loyalty: null,
  multibuy_qty: null,
  multibuy_price: null,
});

function isoDate(d: string, m: string, y: string | undefined, year: number) {
  return `${y ?? year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ------------------------------------------------------------------ S-kaupat

const S_LINK = /\[([^\]\n]{3,200})\]\((https:\/\/www\.s-kaupat\.fi\/tuote\/[^)\s/]+\/(\d{6,14}))(?:\?[^)\s]*)?\)/g;

/** "113 tuotettaSivu 1 / 5" product blocks: plain, campaign ("Kampanjahinta" + 30-day low) or multi-buy ("5 kpl = 10 €"). */
export function parseSkaupatCategory(md: string, year = 2026): CategoryListing[] {
  const out: CategoryListing[] = [];
  const seen = new Set<string>();
  const ms = [...md.matchAll(S_LINK)];
  for (let i = 0; i < ms.length; i++) {
    const [, rawName, url, ean] = ms[i];
    if (seen.has(ean)) continue;
    const block = md.slice((ms[i].index ?? 0) + ms[i][0].length, ms[i + 1]?.index ?? md.length).slice(0, 1600);
    const unit = block.match(/Vertailuhinta\s*(\d+,\d{2})\s*€\/(kg|l|kpl)/i);
    const multi = block.match(/(\d+)\s*kpl\s*=\s*(\d+(?:,\d{1,2})?)\s*€/);
    const camp = block.match(/Kampanjahinta\s*(\d+,\d{2})\s*€/);
    const low = block.match(/30 päivän ajalta:?\s*(\d+,\d{2})\s*€/);
    const vt = block.match(/Voimassa\s+(\d{1,2})\.(\d{1,2})\.(\d{4})?\s*asti/) ?? block.match(/viimeistään\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    let s: RawSnapshot | null = null;
    if (multi) {
      const single = parseMoney(block.match(/(\d+,\d{2})\s*€\s*Kampanjaehdot/)?.[1]) ?? parseMoney(block.match(/(\d+,\d{2})\s*€(?!\s*\/)/)?.[1]);
      if (single == null) continue;
      s = { ...empty(single), regular_price: single, promo_kind: "multibuy", promo_label: `${multi[1]} for €${parseMoney(multi[2])!.toFixed(2)}`, multibuy_qty: Number(multi[1]), multibuy_price: parseMoney(multi[2]) };
    } else if (camp) {
      const p = parseMoney(camp[1])!;
      s = { ...empty(p), lowest_30d: parseMoney(low?.[1]), promo_kind: "campaign", promo_label: `Campaign €${p.toFixed(2)}` };
    } else {
      const p = parseMoney(block.match(/(?:^|\n)\s*(?:noin\s*)?(\d+,\d{2})\s*€(?!\s*\/)/)?.[1]);
      if (p == null) continue; // navigation or sold-out tile without a price
      s = empty(p);
    }
    if (unit) {
      s.unit_price = parseMoney(unit[1]);
      s.unit_price_unit = parseComparisonUnit("/" + unit[2]);
    }
    if (s.promo_kind && vt) s.promo_valid_to = isoDate(vt[1], vt[2], vt[3], year);
    seen.add(ean);
    out.push({ name: rawName.trim(), url, sku: ean, ean, brand: null, snapshot: s });
  }
  return out;
}

// ------------------------------------------------------------------ K-Ruoka

/** Store name shown in the K-Ruoka page header, e.g. "Alppila" or "Iso Omena". */
export function kruokaStoreHeader(md: string): string | null {
  return md.match(/\[([^\]\n]{2,60})\]\(https:\/\/www\.k-ruoka\.fi\/kauppa\/tuotehaku\)/)?.[1] ?? null;
}

export function parseKruokaCategory(md: string): CategoryListing[] {
  const ITEM = /\[([^\]\n]{3,200})\]\((https:\/\/www\.k-ruoka\.fi\/kauppa\/tuote\/[^)\s]+)\)/g;
  const blocks = new Map<string, string>();
  const ms = [...md.matchAll(ITEM)];
  ms.forEach((m, i) => blocks.set(m[2].split("?")[0], md.slice((m.index ?? 0) + m[0].length, ms[i + 1]?.index ?? md.length).slice(0, 1200)));
  const out: CategoryListing[] = [];
  for (const l of parseKruokaListingMarkdown(md)) {
    if (l.price == null || !l.ean) continue;
    const block = blocks.get(l.url) ?? "";
    const s = empty(l.price);
    if (l.unitPrice != null && l.unitPriceUnit) {
      s.unit_price = l.unitPrice;
      s.unit_price_unit = l.unitPriceUnit;
    }
    // Plussa multi-buy: "Etuhinta Plussa-kortilla 3,00 € 2 kappaletta"
    const multi = block.match(/Etuhinta Plussa-kortilla\s+(\d+,\d{2})\s*€\s*(\d+)\s*kappaletta/);
    if (multi && Number(multi[2]) > 1) {
      s.regular_price = l.price;
      s.promo_kind = "multibuy";
      s.multibuy_qty = Number(multi[2]);
      s.multibuy_price = parseMoney(multi[1]);
      s.loyalty = "k_plussa";
      s.promo_label = `${multi[2]} for €${s.multibuy_price!.toFixed(2)} with Plussa`;
      s.unit_price = null; // the stated unit price refers to the offer
    } else if (l.plussaPrice != null && l.plussaPrice < l.price) {
      s.regular_price = l.price;
      s.promo_kind = "loyalty";
      s.multibuy_price = l.plussaPrice;
      s.loyalty = "k_plussa";
      s.promo_label = `Plussa price €${l.plussaPrice.toFixed(2)}`;
      s.unit_price = null;
    }
    out.push({ name: l.name, url: l.url, sku: l.ean, ean: l.ean, brand: null, snapshot: s });
  }
  return out;
}

// ------------------------------------------------------------------ Lidl

/** Lidl /h/ listing tiles: "BRAND\n\n Name\n\n 2,29€\n\n 75 g | 30,54 €/kg\n\n Myymälässä 12.11. - 15.11." */
export function parseLidlCategory(md: string, year = 2026): CategoryListing[] {
  const re = /\n\s*\d+\.\s*\[([^\]\n]+?) kohteelle [\d.]+ EUR\]\((https:\/\/www\.lidl\.fi\/p\/[^/)]+\/p(\d+))[^)]*\)/g;
  const ms = [...md.matchAll(re)];
  const out: CategoryListing[] = [];
  for (let i = 0; i < ms.length; i++) {
    const [, title, url, sku] = ms[i];
    const block = md.slice((ms[i].index ?? 0) + ms[i][0].length, ms[i + 1]?.index ?? md.length);
    const lines = block
      .split("\n")
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith("[") && !x.startsWith("Rendered"));
    const priceIdx = lines.findIndex((x) => /^\d+,\d{2}\s*€$/.test(x));
    if (priceIdx < 0) continue;
    const price = parseMoney(lines[priceIdx])!;
    const brand = lines.slice(0, priceIdx).find((x) => x === x.toUpperCase() && /[A-ZÅÄÖ]{2}/.test(x)) ?? null;
    const old = lines.slice(0, priceIdx).map((x) => x.match(/^(\d+,\d{2})\s*€$/)?.[1]).find(Boolean);
    const sizeLine = lines.slice(priceIdx + 1).join(" | ");
    const size = sizeLine.match(/(\d+(?:,\d+)?)\s*(g|kg|ml|l)\b/i);
    const unit = sizeLine.match(/(\d+,\d{2})\s*€\/(kg|l)/);
    const when = sizeLine.match(/Myymälässä\s+(\d{1,2})\.(\d{1,2})\.\s*-\s*(\d{1,2})\.(\d{1,2})\./);
    const s = empty(price);
    if (unit) {
      s.unit_price = parseMoney(unit[1]);
      s.unit_price_unit = unit[2] as "kg" | "l";
    }
    if (old && parseMoney(old)! > price) {
      s.regular_price = parseMoney(old);
      s.promo_kind = "campaign";
      s.promo_label = `Offer €${price.toFixed(2)}`;
    }
    if (when) {
      s.promo_valid_from = isoDate(when[1], when[2], undefined, year);
      s.promo_valid_to = isoDate(when[3], when[4], undefined, year);
    }
    const name = `${brand ? brand + " " : ""}${title}${size ? ` ${size[1]} ${size[2]}` : ""}`;
    out.push({ name, url, sku, ean: null, brand, snapshot: s });
  }
  return out;
}

// ------------------------------------------------------------------ Wolt Market

export const woltSku = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Wolt venue category tiles: "- 2,99 €\n\n ### M&M's Minis 115g\n\n 115 g26,00 €/kg".
 * Offers: "0,81 €~1,16 €~" (offer + struck-through regular price) and bundle deals ("3kpl -30%").
 * Wolt shows no EAN, so products are keyed by name and compared per kg within their group.
 */
export function parseWoltCategory(md: string): CategoryListing[] {
  const out: CategoryListing[] = [];
  const seen = new Set<string>();
  for (const tile of md.split(/\n-\s+(?=(?:-\s+)?[^\n]*?(?:\d+,\d{2}\s*€|jäljellä))/)) {
    const h = tile.indexOf("###");
    if (h < 0) continue;
    const head = tile.slice(0, h);
    const name = tile.slice(h + 3).split("\n")[0].trim();
    const tail = tile.slice(h + 3 + name.length, h + 400);
    const prices = [...head.matchAll(/(\d+,\d{2})\s*€(~?)/g)].map((m) => ({ v: parseMoney(m[1])!, struck: m[2] === "~" }));
    if (!name || !prices.length || seen.has(name)) continue;
    seen.add(name);
    const s = empty(prices[0].v);
    if (prices.length > 1 && prices[1].v > prices[0].v) {
      s.regular_price = prices[1].v;
      s.promo_kind = "campaign";
      s.promo_label = `Offer €${prices[0].v.toFixed(2)}`;
    }
    const bundle = head.match(/(\d+)\s*kpl\s*-\s*(\d+)\s*%/i);
    if (bundle && !s.promo_kind) {
      const q = Number(bundle[1]);
      s.regular_price = s.price;
      s.promo_kind = "multibuy";
      s.multibuy_qty = q;
      s.multibuy_price = Math.round(q * s.price * (1 - Number(bundle[2]) / 100) * 100) / 100;
      s.promo_label = `${q} pcs −${bundle[2]}%`;
    }
    const unit = tail.match(/(\d+,\d{2})\s*€\/(kg|l)\b/);
    if (unit && !s.promo_kind) {
      s.unit_price = parseMoney(unit[1]);
      s.unit_price_unit = unit[2] as "kg" | "l";
    }
    const size = tail.match(/^\s*(\d+(?:,\d+)?)\s*(g|kg|ml|l)\b/m);
    const fullName = size && !/\d\s*(g|kg|ml|l)\b/i.test(name) ? `${name} ${size[1]} ${size[2]}` : name;
    out.push({ name: fullName, url: "", sku: woltSku(name), ean: null, brand: null, snapshot: s });
  }
  return out;
}
