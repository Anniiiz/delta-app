"use client";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { FilterDim } from "@/lib/filters";
import { useFilterUrl } from "./FilterBar";

/** Cross-filter wiring: clicking a bar toggles its value in the page filter; unselected bars dim. */
interface CrossFilter {
  selected: string[];
  onPick: (key: string) => void;
}
const dimmed = (cf: CrossFilter | undefined, key: string) => !!cf && cf.selected.length > 0 && !cf.selected.includes(key);
function useCross(dim: FilterDim): CrossFilter {
  const f = useFilterUrl();
  return { selected: f.values(dim), onPick: (k) => f.toggle(dim, k) };
}

/**
 * Highlight-vs-context encoding: the selected company is the one indigo series, every competitor is
 * the same neutral gray. A legend is always shown for two series; values sit at the bar tips; text never
 * wears the series color. Bars ≤ 18px with 4px rounded data ends, hairline grid, hover tooltips.
 */
export const OWN = "#7170ff";
export const OTHER = "#8a8f98";
const SURFACE = "#0f1011";
const TEXT_2 = "#d0d6e0";

export function Legend({ ownLabel, otherLabel = "Competitors" }: { ownLabel: string; otherLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-mute">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: OWN }} aria-hidden /> {ownLabel}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: OTHER }} aria-hidden /> {otherLabel}
      </span>
    </div>
  );
}

function TipBox({ title, sub, lines }: { title: string; sub?: string; lines: string[] }) {
  return (
    <div className="rounded-md border border-line bg-raised px-2.5 py-2 text-xs shadow-xl">
      <div className="font-medium text-ink">{title}</div>
      {sub && <div className="text-mute">{sub}</div>}
      {lines.map((l) => (
        <div key={l} className="num mt-0.5 text-ink">{l}</div>
      ))}
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  sub?: string;
  value: number;
  own: boolean;
  n?: number;
}

type Fmt = (v: number) => string;
const FORMATS: Record<"eur" | "count" | "pct" | "index", Fmt> = {
  eur: (v) => `€${v.toFixed(2)}`,
  count: (v) => String(Math.round(v)),
  pct: (v) => `${Math.round(v)}%`,
  index: (v) => v.toFixed(1),
};

interface HBarProps {
  data: BarDatum[];
  unit?: string;
  /** Named format, so server components can choose it (functions can't cross to the client). */
  kind?: "eur" | "count" | "pct" | "index";
  /** Start the value axis here instead of 0 (for indices around 100). */
  min?: number;
  labelWidth?: number;
  sort?: "asc" | "desc" | "none";
  /** Make bars click-to-filter on this page dimension (bar key = filter value). */
  filter?: FilterDim;
}

/** Horizontal bars sorted low→high. Height follows the number of bars. */
export function HBar(props: HBarProps) {
  return props.filter ? <FilterableHBar {...props} filter={props.filter} /> : <BaseHBar {...props} />;
}

function FilterableHBar(props: HBarProps & { filter: FilterDim }) {
  const cf = useCross(props.filter);
  // The account's own bar never becomes a competitor filter.
  return <BaseHBar {...props} cf={{ ...cf, onPick: (k) => (props.filter === "company" && props.data.find((d) => d.key === k)?.own ? undefined : cf.onPick(k)) }} />;
}

function BaseHBar({ data, unit = "/kg", kind = "eur", min = 0, labelWidth = 170, sort = "asc", cf }: HBarProps & { cf?: CrossFilter }) {
  const format = FORMATS[kind];
  const rows = sort === "none" ? data : [...data].sort((a, b) => (sort === "asc" ? a.value - b.value : b.value - a.value));
  const h = Math.max(90, rows.length * 28 + 30);
  const max = Math.max(...rows.map((r) => r.value), 0);
  const cut = Math.floor(labelWidth / 6.4);
  return (
    <div style={{ height: h }} className="w-full overflow-hidden">
      <ResponsiveContainer key={rows.length}>
        <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 56, bottom: 2, left: 0 }} barCategoryGap={5}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={[min, min ? Math.ceil(max + 1) : max * 1.08 || 1]} allowDataOverflow tickFormatter={(v) => (kind === "eur" ? `€${Math.round(v)}` : format(v))} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={labelWidth} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} interval={0} tickFormatter={(s: string) => (s.length > cut ? s.slice(0, cut - 1) + "…" : s)} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as BarDatum;
              return <TipBox title={d.label} sub={d.sub} lines={[`${format(d.value)}${kind === "eur" ? unit : ""}${d.n != null ? ` · ${d.n} obs.` : ""}`]} />;
            }}
          />
          <Bar
            dataKey="value"
            barSize={16}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            cursor={cf ? "pointer" : undefined}
            onClick={cf ? (d: unknown) => cf.onPick((d as { payload: BarDatum }).payload.key) : undefined}
          >
            {rows.map((r) => (
              <Cell key={r.key} fill={r.own ? OWN : OTHER} fillOpacity={dimmed(cf, r.key) ? 0.3 : 1} />
            ))}
            <LabelList dataKey="value" position="right" formatter={(v: unknown) => format(Number(v))} style={{ fill: TEXT_2, fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface GapDatum {
  label: string;
  gap: number; // fraction, negative = cheaper than the comparison
  own: number;
  comp: number;
  n: string;
  /** highlight (indigo) vs context (gray); defaults to highlighted */
  isOwn?: boolean;
}

/** Price index vs competitor median per comparison group: bars left of zero = cheaper, right = pricier. */
interface GapProps {
  data: GapDatum[];
  labels?: [string, string];
  unit?: string;
  /** Make bars click-to-filter on this page dimension (bar label = filter value). */
  filter?: FilterDim;
}

export function GapBars(props: GapProps) {
  return props.filter ? <FilterableGap {...props} filter={props.filter} /> : <BaseGap {...props} />;
}

function FilterableGap(props: GapProps & { filter: FilterDim }) {
  const cf = useCross(props.filter);
  // The account's own bar never becomes a competitor filter.
  return <BaseGap {...props} cf={{ ...cf, onPick: (k) => (props.filter === "company" && props.data.find((d) => d.label === k)?.isOwn === true ? undefined : cf.onPick(k)) }} />;
}

function BaseGap({ data, labels = ["Own", "competitors"], unit = "/kg", cf }: GapProps & { cf?: CrossFilter }) {
  const lim = Math.ceil(Math.max(0.1, ...data.map((d) => Math.abs(d.gap))) * 1.2 * 10) / 10;
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim];
  const h = Math.max(90, data.length * 40 + 30);
  return (
    <div style={{ height: h }} className="w-full overflow-hidden">
      <ResponsiveContainer key={data.length}>
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 40, bottom: 2, left: 0 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={[-lim, lim]} ticks={ticks} tickFormatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={170} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} interval={0} />
          <ReferenceLine x={0} stroke="#62666d" />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as GapDatum;
              return <TipBox title={d.label} sub={d.n} lines={[`${labels[0]} €${d.own.toFixed(2)}${unit} · ${labels[1]} €${d.comp.toFixed(2)}${unit}`]} />;
            }}
          />
          <Bar
            dataKey="gap"
            barSize={18}
            isAnimationActive={false}
            cursor={cf ? "pointer" : undefined}
            onClick={cf ? (d: unknown) => cf.onPick((d as { payload: GapDatum }).payload.label) : undefined}
          >
            {data.map((d) => (
              <Cell key={d.label} fill={d.isOwn === false ? OTHER : OWN} fillOpacity={dimmed(cf, d.label) ? 0.3 : 1} />
            ))}
            <LabelList
              dataKey="gap"
              content={({ x, y, width, height, value }) => {
                const v = Number(value);
                const xx = Number(x) + (v < 0 ? Number(width) - 6 : Number(width) + 6);
                return (
                  <text x={xx} y={Number(y) + Number(height) / 2} dy={4} textAnchor={v < 0 ? "end" : "start"} fill={TEXT_2} fontSize={11}>
                    {`${v > 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface ColumnDatum {
  label: string;
  own: number;
  comp: number;
  sub?: string;
}

/** Stacked columns (own + competitors) with a 2px surface gap between segments. */
export function Columns({ data, ownLabel, height = 180 }: { data: ColumnDatum[]; ownLabel: string; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data.map((d) => ({ ...d, cap: 0.001, total: d.own + d.comp }))} margin={{ top: 16, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} interval={0} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as ColumnDatum;
              return <TipBox title={d.label} sub={d.sub} lines={[`${ownLabel}: ${d.own}`, `Competitors: ${d.comp}`]} />;
            }}
          />
          <Bar dataKey="comp" stackId="s" fill={OTHER} barSize={22} stroke={SURFACE} strokeWidth={2} isAnimationActive={false} />
          <Bar dataKey="own" stackId="s" fill={OWN} barSize={22} stroke={SURFACE} strokeWidth={2} isAnimationActive={false} />
          {/* zero-height cap carries the total label on top of the stack */}
          <Bar dataKey="cap" stackId="s" fill="transparent" barSize={22} isAnimationActive={false}>
            <LabelList dataKey="total" position="top" style={{ fill: TEXT_2, fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface StripDatum {
  group: string;
  value: number;
  own: boolean;
  label: string;
  sub: string;
}

/** Every listing as a dot on a €/kg axis, one row per company: shows spread, not just the median. */
export function Strip({ data }: { data: StripDatum[] }) {
  const groups = [...new Set(data.map((d) => d.group))];
  const order = new Map(groups.map((g, i) => [g, i]));
  const pts = data.map((d) => ({ ...d, y: order.get(d.group)! }));
  const h = Math.max(110, groups.length * 34 + 40);
  const max = Math.max(...data.map((d) => d.value));
  const series = [pts.filter((p) => !p.own), pts.filter((p) => p.own)];
  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 6, right: 16, bottom: 2, left: 0 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" dataKey="value" domain={[0, Math.ceil(max * 1.1)]} tickFormatter={(v) => `€${v}`} axisLine={false} tickLine={false} />
          <YAxis type="number" dataKey="y" domain={[-0.6, groups.length - 0.4]} ticks={groups.map((_, i) => i)} tickFormatter={(i) => groups[i] ?? ""} width={130} axisLine={false} tickLine={false} reversed />
          <ZAxis range={[64, 64]} />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as StripDatum;
              return <TipBox title={d.label} sub={d.sub} lines={[`€${d.value.toFixed(2)}/kg`]} />;
            }}
          />
          <Scatter data={series[0]} fill={OTHER} stroke={SURFACE} strokeWidth={2} isAnimationActive={false} />
          <Scatter data={series[1]} fill={OWN} stroke={SURFACE} strokeWidth={2} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
