import type { Row } from "./analytics";
import type { ColumnDatum } from "@/components/Charts";
import { stamp } from "@/components/ui";

/** Active offers grouped by stated end date, own vs competitors. */
export function endingColumns(rows: Row[], company: string): ColumnDatum[] {
  const m = new Map<string, ColumnDatum>();
  for (const r of rows.filter((x) => x.promo?.active)) {
    const k = r.promo!.validTo?.slice(0, 10) ?? "open";
    const e = m.get(k) ?? { label: k === "open" ? "open" : stamp(`${k}T12:00:00Z`, false), own: 0, comp: 0, sub: k === "open" ? "No end date stated" : `Ends ${k}` };
    if (r.company === company) e.own++;
    else e.comp++;
    m.set(k, e);
  }
  const sorted = [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const open = sorted.filter((c) => c.label === "open");
  const dated = sorted.filter((c) => c.label !== "open");
  if (dated.length <= 8) return [...dated, ...open];
  const later = dated.slice(7).reduce((a, c) => ({ ...a, own: a.own + c.own, comp: a.comp + c.comp }), { label: "later", own: 0, comp: 0, sub: `${dated.length - 7} later end dates` });
  return [...dated.slice(0, 7), later, ...open];
}

/** Top N entries by value, always keeping the selected company. */
export function topWithOwn(entries: [string, number][], own: string, n = 10): [string, number][] {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, n);
  const mine = sorted.find(([k]) => k === own);
  if (mine && !top.includes(mine)) top[top.length - 1] = mine;
  return top;
}
