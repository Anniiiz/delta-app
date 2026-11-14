import Link from "next/link";
import type { AccountPromo } from "@/lib/account";
import { validUntil } from "@/lib/normalize";
import { Price, PromoChip, SourceLink, StoreBadge, cls, stamp } from "./ui";

const SOON_MS = 3 * 86400_000;

const ends = (p: AccountPromo) => validUntil(p.validTo) ?? Infinity;

/** Live offers first, soonest-ending first, then by banner and product name. */
export function sortPromos(rows: AccountPromo[]) {
  return [...rows].sort((a, b) => Number(b.active) - Number(a.active) || ends(a) - ends(b) || a.banner.localeCompare(b.banner) || a.name.localeCompare(b.name));
}

interface PromoGroup {
  id: string;
  items: AccountPromo[];
}

/** Rows that share brand × banner × label × offer price × end date become one row ("12 products"). */
function collapse(rows: AccountPromo[]): PromoGroup[] {
  const map = new Map<string, AccountPromo[]>();
  for (const p of rows) {
    const k = [p.brand ?? p.company ?? "", p.banner, p.label ?? p.type, p.offerPrice.toFixed(2), p.validTo ?? ""].join("|");
    map.set(k, [...(map.get(k) ?? []), p]);
  }
  return [...map.entries()].map(([id, items]) => ({ id, items }));
}

function range(xs: number[]) {
  return xs.length ? { lo: Math.min(...xs), hi: Math.max(...xs) } : null;
}

export function AccountPromoTable({
  rows,
  now,
  showCompany = false,
  groupBySegment = false,
  productHref,
}: {
  rows: AccountPromo[];
  now: number;
  showCompany?: boolean;
  groupBySegment?: boolean;
  productHref?: (key: string) => string;
}) {
  const sorted = sortPromos(rows);
  const sections: { segment: string | null; groups: PromoGroup[] }[] = groupBySegment
    ? [...new Set(sorted.map((p) => p.segment ?? "Other"))]
        .sort((a, b) => a.localeCompare(b))
        .map((s) => ({ segment: s, groups: collapse(sorted.filter((p) => (p.segment ?? "Other") === s)) }))
    : [{ segment: null, groups: sorted.map((p, i) => ({ id: `${p.key}|${p.banner}|${p.label}|${i}`, items: [p] })) }];
  const cols = showCompany ? 11 : 10;

  return (
    <div className="overflow-x-auto">
      <table className="dt">
        <thead>
          <tr>
            <th>Product</th>
            {showCompany && <th>Company</th>}
            <th>Banner</th>
            <th>Mechanic</th>
            <th className="r">Per pack</th>
            <th className="r">Reference</th>
            <th className="r">Discount</th>
            <th className="r">Stores</th>
            <th>Ends</th>
            <th></th>
          </tr>
        </thead>
        {sections.map((sec) => (
          <tbody key={sec.segment ?? "all"}>
            {sec.segment && (
              <tr>
                <td colSpan={cols} className="bg-white/[0.015] text-xs font-medium text-mute">
                  {sec.segment} <span className="num text-faint">· {sec.groups.reduce((n, g) => n + g.items.length, 0)}</span>
                </td>
              </tr>
            )}
            {sec.groups.map((g) => (
              <PromoRow key={g.id} items={g.items} now={now} showCompany={showCompany} productHref={productHref} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PromoRow({ items, now, showCompany, productHref }: { items: AccountPromo[]; now: number; showCompany: boolean; productHref?: (key: string) => string }) {
  const p = items[0];
  const many = items.length > 1;
  const refs = range(items.filter((x) => x.referencePrice != null).map((x) => x.referencePrice!));
  const discs = range(items.filter((x) => x.discountPct != null && x.referencePrice != null).map((x) => x.discountPct!));
  const stores = range(items.map((x) => x.stores));
  const kinds = new Set(items.filter((x) => x.referencePrice != null).map((x) => x.referenceKind));
  const kind = kinds.size === 1 ? [...kinds][0] : null;
  const ended = !p.active;
  const soon = !ended && ends(p) - now < SOON_MS;
  const names = items.map((x) => x.name);

  return (
    <tr className={ended ? "opacity-55" : undefined}>
      <td className="max-w-[320px]">
        {many ? (
          <details className="group">
            <summary className="list-none text-ink [&::-webkit-details-marker]:hidden" title={names.join("\n")}>
              <span className="text-ink">{p.brand ?? p.company ?? "Products"}</span>{" "}
              <span className="chip ml-1 text-ink-2 group-open:bg-raised-2">{items.length} products</span>
            </summary>
            <ul className="mt-1.5 space-y-0.5 text-xs text-mute">
              {items.map((x) => (
                <li key={x.key} className="truncate" title={x.name}>{x.name}</li>
              ))}
            </ul>
          </details>
        ) : productHref && p.own ? (
          <Link href={productHref(p.key)} className="block truncate text-ink hover:text-tag" title={p.name}>
            {p.name}
          </Link>
        ) : (
          <span className="block truncate text-ink" title={p.name}>{p.name}</span>
        )}
      </td>
      {showCompany && (
        <td className="whitespace-nowrap">
          <div className="text-ink-2">{p.company ?? "Other"}</div>
          {p.brand && p.brand !== p.company && <div className="text-xs text-mute">{p.brand}</div>}
        </td>
      )}
      <td>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
          <StoreBadge banner={p.banner} /> {p.banner}
        </span>
      </td>
      <td><PromoChip type={p.type} label={p.label} /></td>
      <td className="r"><Price value={p.offerPrice} /></td>
      <td className="r whitespace-nowrap">
        {refs ? (
          <span title={kind === "regular" ? "Regular price" : kind ? "Lowest price in previous 30 days" : "Stated reference price"}>
            <Price value={refs.lo} className="text-ink-2" />
            {refs.hi !== refs.lo && <span className="text-xs text-mute">–<Price value={refs.hi} className="text-ink-2" /></span>}
            {kind && <span className="ml-1 text-[11px] text-faint">{kind === "regular" ? "reg." : "30 d"}</span>}
          </span>
        ) : (
          <span className="text-xs text-faint">—</span>
        )}
      </td>
      <td className="r num whitespace-nowrap">
        {discs ? (
          <span className="text-sun">
            −{discs.lo.toFixed(0)}
            {Math.round(discs.hi) !== Math.round(discs.lo) && `–${discs.hi.toFixed(0)}`}%
          </span>
        ) : (
          <span className="text-faint" title="No reference price stated by the retailer">—</span>
        )}
      </td>
      <td className="r num whitespace-nowrap text-ink-2">
        {p.level === "chain" ? (
          <span className="text-xs text-mute" title="Chain-wide offer feed, not store-level">chain-wide</span>
        ) : stores && stores.lo !== stores.hi ? (
          `${stores.lo}–${stores.hi}`
        ) : (
          p.stores
        )}
      </td>
      <td className={cls("whitespace-nowrap text-xs", soon ? "text-sun" : "text-ink-2")} title={ended ? "Stated end date has passed; still shown on the latest capture" : soon ? "Stated to end within 3 days" : undefined}>
        {p.validTo ? stamp(p.validTo, false) : "—"}
        {ended && <span className="chip ml-1.5 text-mute">Ended</span>}
      </td>
      <td><SourceLink url={p.sourceUrl} label="source" /></td>
    </tr>
  );
}
