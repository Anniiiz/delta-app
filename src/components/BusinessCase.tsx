"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { computeCase, fmt, fmtEur, nf1, WEEKS, type CaseInputs } from "@/lib/businesscase";

const FIELDS: { key: keyof CaseInputs; label: string; unit: string; step: number; max?: number; note: (d: CaseInputs, ctx: Ctx) => string }[] = [
  { key: "products", label: "Products tracked", unit: "products", step: 1, note: (_, c) => `Live: ${fmt(c.products)} ${c.company} products captured` },
  {
    key: "stores",
    label: "Stores checked per product",
    unit: "stores",
    step: 1,
    note: (_, c) => `Live: ${fmt(c.storesSeen)} store scopes with a ${c.company} capture; the average product was seen in ${nf1.format(c.avgStores)}`,
  },
  { key: "perWeek", label: "Checks per week", unit: "per week", step: 0.5, note: () => "How often each product × store is checked" },
  { key: "minutes", label: "Minutes per manual check", unit: "min", step: 0.25, note: () => "Open the store page, find the product, note price and offer" },
  { key: "hourly", label: "Loaded hourly cost", unit: "€ / h", step: 1, note: () => "Salary plus overheads" },
  { key: "sharePct", label: "Share checked by hand today", unit: "%", step: 1, max: 100, note: () => "Of the full footprint, what a team realistically covers" },
];

interface Ctx {
  company: string;
  products: number;
  storesSeen: number;
  avgStores: number;
}

export function BusinessCase({ defaults, ...ctx }: { defaults: CaseInputs } & Ctx) {
  const [v, setV] = useState<CaseInputs>(defaults);
  const r = computeCase(v);
  const changed = (Object.keys(defaults) as (keyof CaseInputs)[]).some((k) => v[k] !== defaults[k]);

  return (
    <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="chip border-violet/30 bg-violetbg text-violet">Assumptions · editable</span>
          <span className="flex-1" />
          {changed && (
            <button type="button" onClick={() => setV(defaults)} className="btn-ghost h-7 min-h-7 px-2 text-xs print:hidden">
              <RotateCcw size={12} aria-hidden /> Reset
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="label">{f.label}</span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={f.max}
                  step={f.step}
                  value={Number.isFinite(v[f.key]) ? v[f.key] : ""}
                  onChange={(e) => {
                    const n = e.target.value === "" ? 0 : Number(e.target.value);
                    setV((x) => ({ ...x, [f.key]: Number.isFinite(n) ? Math.max(0, f.max != null ? Math.min(f.max, n) : n) : 0 }));
                  }}
                  className="input num w-28 text-right"
                />
                <span className="text-xs text-mute">{f.unit}</span>
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-faint">{f.note(v, ctx)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-card p-4">
        <table className="dt">
          <thead>
            <tr>
              <th>By hand</th>
              <th className="r">Checks / year</th>
              <th className="r">Hours / year</th>
              <th className="r">Cost / year</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-ink-2">Full coverage</td>
              <td className="r num">{fmt(r.fullChecks)}</td>
              <td className="r num">{fmt(r.fullHours)}</td>
              <td className="r num font-semibold text-ink">{fmtEur(r.fullCost)}</td>
            </tr>
            <tr>
              <td className="text-ink-2">Today, {nf1.format(v.sharePct)}% checked</td>
              <td className="r num">{fmt(r.todayChecks)}</td>
              <td className="r num">{fmt(r.todayHours)}</td>
              <td className="r num font-semibold text-ink">{fmtEur(r.todayCost)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-[13px] text-ink-2">
          Coverage with Delta vs today&apos;s hand checking:{" "}
          <span className="num font-semibold text-ink">{r.coverageMultiple == null ? "—" : `${nf1.format(r.coverageMultiple)}×`}</span>
        </p>

        <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs leading-relaxed text-mute">
          <p>
            <span className="text-ink-2">Checks per year</span> = products × stores × checks per week × {WEEKS} weeks = {fmt(v.products)} × {fmt(v.stores)} × {nf1.format(v.perWeek)} × {WEEKS} ={" "}
            {fmt(r.fullChecks)}.
          </p>
          <p>
            <span className="text-ink-2">Hours</span> = checks × minutes ÷ 60; <span className="text-ink-2">cost</span> = hours × hourly cost. Today = full coverage × share checked by hand.
          </p>
          <p>
            <span className="text-ink-2">Coverage</span> = full footprint ÷ the share checked today. Time to read the results is not included.
          </p>
        </div>
      </div>
    </div>
  );
}
