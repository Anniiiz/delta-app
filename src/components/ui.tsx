import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

export function cls(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export const eur = (n: number | null | undefined, digits = 2) => (n == null || !Number.isFinite(n) ? "—" : `€${n.toFixed(digits)}`);
export const pct = (x: number | null | undefined, signed = true) =>
  x == null ? "—" : `${signed ? (x > 0 ? "+" : x < 0 ? "−" : "±") : ""}${Math.abs(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "14.11. 08:52" in Helsinki time. */
export function stamp(iso: string | null | undefined, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${withTime ? ` ${p.hour}:${p.minute}` : ""}`;
}

export function host(url: string | null | undefined) {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A price in tabular numerals. */
export function Price({ value, className, unit }: { value: number | null | undefined; className?: string; unit?: string | null }) {
  if (value == null || !Number.isFinite(value)) return <span className={cls("text-faint", className)}>—</span>;
  return (
    <span className={cls("price", className)}>
      €{value.toFixed(2)}
      {unit && <span className="ml-0.5 text-[0.85em] font-normal text-mute">/{unit}</span>}
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="grid h-[20px] w-[20px] place-items-center rounded-[5px] bg-accent text-[11px] font-semibold text-white">
        Δ
      </span>
      <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">delta.</span>
    </span>
  );
}

export const BANNER_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  Prisma: { bg: "#00704A", fg: "#fff", label: "P" },
  "S-market": { bg: "#3E9B4F", fg: "#fff", label: "S" },
  Alepa: { bg: "#E2231A", fg: "#FFE14D", label: "A" },
  "K-Supermarket": { bg: "#D9381E", fg: "#fff", label: "K" },
  "K-Market": { bg: "#F7A21B", fg: "#1a1206", label: "K" },
  "K-Citymarket": { bg: "#F26B21", fg: "#fff", label: "K" },
  Lidl: { bg: "#0050AA", fg: "#FFF000", label: "L" },
  "Wolt Market": { bg: "#009DE0", fg: "#fff", label: "W" },
  "Food Market Herkku": { bg: "#1D1D1B", fg: "#fff", label: "H" },
};

export function StoreBadge({ banner }: { banner: string }) {
  const s = BANNER_STYLE[banner] ?? { bg: "#62666d", fg: "#fff", label: banner[0] };
  return (
    <span aria-hidden className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] text-[10px] font-bold" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

export function SourceLink({ url, label }: { url: string | null | undefined; label?: string }) {
  if (!url) return <span className="text-faint">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-mute hover:text-tag" title={url}>
      {label ?? host(url)} <ExternalLink size={11} aria-hidden />
    </a>
  );
}

export function Card({ id, title, sub, right, children, className, pad = true }: { id?: string; title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section id={id} className={cls("card min-w-0", id && "scroll-mt-14", className)}>
      {(title || right) && (
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[13px] font-semibold text-ink">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-mute">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "warn" | "muted" }) {
  return (
    <div className="card px-4 py-3">
      <div className="label">{label}</div>
      <div className={cls("num mt-1 text-[22px] font-semibold tracking-[-0.02em]", tone === "muted" ? "text-mute" : "text-ink")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-mute">{hint}</div>}
    </div>
  );
}

export function PromoChip({ type, label }: { type: string; label?: string | null }) {
  return (
    <span className="chip border-sun/30 bg-sunbg text-sun" title="Retailer-advertised promotion, read from the retailer page">
      {label ?? type}
    </span>
  );
}

export function OwnDot({ own }: { own: boolean }) {
  return <span aria-hidden className={cls("inline-block h-2 w-2 shrink-0 rounded-[3px]", own ? "bg-tag" : "bg-faint")} />;
}

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[20px] text-ink">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-[13px] text-mute">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line px-4 py-6 text-center text-[13px] text-mute">{children}</div>;
}
