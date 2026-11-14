/**
 * Package size and money parsing for Finnish grocery listings.
 * Base units: volume -> "l", mass -> "kg", count -> "pcs".
 */
export type BaseUnit = "l" | "kg" | "pcs";

export interface PackSize {
  value: number; // in base unit
  unit: BaseUnit;
  /** true when the product is sold by weight (price is per kg, "irto") */
  byWeight?: boolean;
}

const UNIT_MAP: Record<string, { unit: BaseUnit; factor: number }> = {
  kg: { unit: "kg", factor: 1 },
  g: { unit: "kg", factor: 0.001 },
  l: { unit: "l", factor: 1 },
  dl: { unit: "l", factor: 0.1 },
  cl: { unit: "l", factor: 0.01 },
  ml: { unit: "l", factor: 0.001 },
  kpl: { unit: "pcs", factor: 1 },
  pcs: { unit: "pcs", factor: 1 },
  pc: { unit: "pcs", factor: 1 },
  "kpl:n": { unit: "pcs", factor: 1 },
};

/** Parses "1,39" / "1.39" / "0,99 €" to a number. */
export function parseMoney(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = String(s).replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extracts a package size from a product name or packaging text.
 * Handles "1 l", "500g", "1,5 kg", "10 kpl", "6x1,5 l", "4 x 125 g".
 */
export function parsePackSize(text: string | null | undefined): PackSize | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/ /g, " ");
  // Eggs are counted: "M10", "L6", "XL10", "6 kpl/408 g", "15kpl"
  if (/muna|munia|munat/.test(t)) {
    const cnt = t.match(/(\d{1,2})\s*kpl/) ?? t.match(/\b(?:xs|s|m|l|xl)(\d{1,2})\b/);
    if (cnt) return { value: Number(cnt[1]), unit: "pcs" };
  }
  // multipack: 6x1,5l / 4 x 125 g
  const multi = t.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml)\b/);
  if (multi) {
    const u = UNIT_MAP[multi[3]];
    return { value: round(Number(multi[1]) * Number(multi[2].replace(",", ".")) * u.factor), unit: u.unit };
  }
  const re = /(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml|kpl|pcs)\b/g;
  let m: RegExpExecArray | null;
  let last: PackSize | null = null;
  while ((m = re.exec(t))) {
    const u = UNIT_MAP[m[2]];
    const v = Number(m[1].replace(",", "."));
    if (!u || !Number.isFinite(v) || v <= 0) continue;
    // prefer the first mass/volume match; counts only if nothing else
    const size = { value: round(v * u.factor), unit: u.unit };
    if (size.unit !== "pcs") return size;
    last = last ?? size;
  }
  if (last) return last;
  if (/\birto\b|\b€\/kg\b|per kg|\/kg$/.test(t)) return { value: 1, unit: "kg", byWeight: true };
  return null;
}

/** Comparison unit text such as "€/l", "€/kg", "LTR", "KGM" -> base unit. */
export function parseComparisonUnit(s: string | null | undefined): BaseUnit | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/ltr|\/l\b|litra|^l$/.test(t)) return "l";
  if (/kgm|\/kg\b|kilo|^kg$/.test(t)) return "kg";
  if (/pce|kpl|pcs|\/kpl/.test(t)) return "pcs";
  return null;
}

export function round(n: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `€${n.toFixed(2)}`;
}

/** Convert user quantity (with unit) to base unit. */
export function toBase(qty: number, unit: string): { value: number; unit: BaseUnit } | null {
  const u = UNIT_MAP[unit.toLowerCase()];
  if (!u) return null;
  return { value: round(qty * u.factor), unit: u.unit };
}
