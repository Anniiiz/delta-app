import type { AlertRow, HistoryInfo, RetailerGap, Row, SegmentPosition } from "./analytics";
import { validUntil } from "./normalize";

/**
 * Key takeaways for the selected company: short sentences, each emitted only when computed facts
 * support it. Figures are copied from the deterministic analytics; the scope is stated once in `basis`.
 */
export interface Brief {
  sentences: { text: string; tone: "neutral" | "good" | "warn" }[];
  basis: string;
}

const eur = (n: number) => `€${n.toFixed(2)}`;
const pct = (x: number) => `${Math.abs(Math.round(x * 100))}%`;

export function brief(company: string, rows: Row[], pos: SegmentPosition[], hist: HistoryInfo, alerts: AlertRow[], gap?: RetailerGap | null): Brief {
  const s: Brief["sentences"] = [];
  const comp = rows.filter((r) => r.company !== company);

  for (const p of pos.filter((x) => x.positioning !== "no comparison")) {
    const where = p.positioning === "premium" ? "above" : p.positioning === "value" ? "below" : "in line with";
    s.push({ text: `${p.segment}: ${p.positioning === "parity" ? "" : pct(p.gapPct!) + " "}${where} competitors (${eur(p.ownMedian!)} vs ${eur(p.competitorMedian!)}/kg).`, tone: "neutral" });
  }

  if (gap && Math.abs(gap.gap) >= 0.01)
    s.push({ text: `Same ${company} products cost ${pct(gap.gap)} ${gap.gap > 0 ? "more" : "less"} at K-Group than S Group (${gap.products} products).`, tone: "neutral" });

  const promos = comp.filter((r) => r.promo?.active);
  if (promos.length) {
    const byCo = new Map<string, number>();
    for (const r of promos) byCo.set(r.company ?? "Other", (byCo.get(r.company ?? "Other") ?? 0) + 1);
    const [top, n] = [...byCo.entries()].sort((a, b) => b[1] - a[1])[0];
    s.push({ text: `${promos.length} competitor offers live; ${top} runs ${n}.`, tone: "warn" });
  }

  const soon = promos.filter((r) => (validUntil(r.promo!.validTo) ?? Infinity) - Date.now() < 3 * 86400_000).length;
  if (soon) s.push({ text: `${soon} of them end within 3 days.`, tone: "neutral" });

  const drops = alerts.filter((a) => a.origin === "monitor" && a.kind === "price_decrease" && a.company !== company).length;
  if (drops) s.push({ text: `${drops} competitor price cut${drops > 1 ? "s" : ""} detected by monitors.`, tone: "warn" });

  if (!hist.priceChanges.length) s.push({ text: "No price changes observed yet, so no trend claims.", tone: "neutral" });

  return {
    sentences: s,
    basis: `${rows.length} listings · ${new Set(rows.map((r) => r.productId)).size} products · ${new Set(rows.map((r) => r.storeId)).size} store scopes`,
  };
}
