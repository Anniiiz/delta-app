import { db } from "@/lib/db";
import { DEFAULT_SCOPE, type Row } from "@/lib/analytics";
import { pageContext } from "@/lib/context";
import { endingColumns, topWithOwn } from "@/lib/chartdata";
import { validUntil } from "@/lib/normalize";
import { Card, Empty, Kpi, OwnDot, PageHeader, Price, PromoChip, SourceLink, StoreBadge, stamp } from "@/components/ui";
import { Columns, HBar, Legend } from "@/components/Charts";
import { FilterBar } from "@/components/FilterBar";
import { filterOptions, filterRows, parseFilters, without } from "@/lib/filters";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { campaign: "Campaign", multibuy: "Multi-buy", loyalty: "Loyalty" };

export default async function Promotions({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sp, rows: allRows, company } = await pageContext(searchParams);
  const f = parseFilters(sp);
  const rows = filterRows(allRows, f, company);
  // The company chart keeps all companies and dims the unselected ones (cross-highlight).
  const rowsNoCo = filterRows(allRows, without(f, "company"), company);
  const now = Date.now();
  const promos = rows.filter((r) => r.promo?.active).sort((a, b) => (validUntil(a.promo!.validTo) ?? Infinity) - (validUntil(b.promo!.validTo) ?? Infinity));
  // Your offers, and competitor offers in the product groups where you sell.
  const ownSegments = new Set(rows.filter((r) => r.company === company && r.segment).map((r) => r.segment!));
  const own = promos.filter((r) => r.company === company);
  const comp = promos.filter((r) => r.company !== company && r.segment && ownSegments.has(r.segment));
  const relevant = [...own, ...comp];
  const soonIn = (xs: typeof promos) => xs.filter((r) => (validUntil(r.promo!.validTo) ?? Infinity) - now < 3 * 86400_000).length;

  const byCo = new Map<string, number>();
  const ownSegNoCo = new Set(rowsNoCo.filter((r) => r.company === company && r.segment).map((r) => r.segment!));
  for (const r of rowsNoCo.filter((x) => x.promo?.active && (x.company === company || (x.segment && ownSegNoCo.has(x.segment)))))
    byCo.set(r.company ?? "Other", (byCo.get(r.company ?? "Other") ?? 0) + 1);

  // Deepest stated discount per product (one bar per product).
  const disc = new Map<string, { label: string; value: number; own: boolean; sub: string }>();
  for (const r of relevant) {
    const d = r.promo!.discountPct;
    if (d == null) continue;
    const cur = disc.get(r.productId);
    if (!cur || d > cur.value) disc.set(r.productId, { label: r.name.replace(/\s+(suklaalevy|suklaapatukka|konvehteja|suklaakonvehtirasia)\b/i, "").replace(/\s+[\d,.-]+\s?g$/i, ""), value: d, own: r.company === company, sub: `${r.storeName} · ${r.promo!.label}` });
  }
  const discData = [...disc.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.value - a.value).slice(0, 10);

  const byType = new Map<string, number>();
  for (const r of own) byType.set(r.promo!.type, (byType.get(r.promo!.type) ?? 0) + 1);

  const captures = db()
    .prepare(
      `SELECT s.name AS store, o.captured_at, COUNT(*) AS listed, SUM(o.promo_kind IS NOT NULL) AS promos
       FROM observations o JOIN products p ON p.id = o.product_id JOIN stores s ON s.id = o.store_id
       WHERE p.category = ? AND o.store_id IN (${DEFAULT_SCOPE.storeIds.map(() => "?").join(",")})
       GROUP BY o.store_id, o.captured_at ORDER BY o.captured_at DESC`,
    )
    .all(DEFAULT_SCOPE.category, ...DEFAULT_SCOPE.storeIds) as { store: string; captured_at: string; listed: number; promos: number }[];

  return (
    <div className="space-y-5">
      <PageHeader title="Your promotions and the ones against you" />
      <FilterBar options={filterOptions(allRows, company)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Your live offers" value={own.length} hint={[...byType.entries()].map(([t, n]) => `${n} ${TYPE_LABEL[t].toLowerCase()}`).join(" · ") || "none right now"} />
        <Kpi label="Competitor offers in your groups" value={comp.length} hint={`${new Set(comp.map((r) => r.company)).size} companies`} />
        <Kpi label="Yours ending in 3 days" value={soonIn(own)} />
        <Kpi label="Theirs ending in 3 days" value={soonIn(comp)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Offers in your groups, by company" right={<Legend ownLabel={company} />}>
          <HBar filter="company" data={topWithOwn([...byCo.entries()], company).map(([c, n]) => ({ key: c, label: c, value: n, own: c === company }))} kind="count" sort="desc" labelWidth={110} />
        </Card>
        <Card title="Deepest stated discounts in your groups" right={<Legend ownLabel={company} />}>
          {discData.length ? <HBar data={discData} kind="pct" sort="desc" labelWidth={170} /> : <Empty>No stated reference prices.</Empty>}
        </Card>
        <Card title="Offers ending" right={<Legend ownLabel={company} />}>
          <Columns data={endingColumns(relevant, company)} ownLabel={company} height={220} />
        </Card>
      </div>

      <Card title={`Your offers · ${own.length}`} pad={false}>
        {own.length ? <PromoTable list={own} company={company} /> : <div className="p-4"><Empty>No live offers on your products in the panel stores.</Empty></div>}
      </Card>

      <Card title={`Competitor offers in your groups · ${comp.length}`} pad={false}>
        {comp.length ? <PromoTable list={comp} company={company} /> : <div className="p-4"><Empty>No competitor offers in your product groups.</Empty></div>}
      </Card>

      <Card title="Capture history" pad={false}>
        <table className="dt">
          <thead>
            <tr><th>Captured</th><th>Store scope</th><th className="r">Listings</th><th className="r">On promotion</th></tr>
          </thead>
          <tbody>
            {captures.map((c) => (
              <tr key={c.store + c.captured_at}>
                <td className="whitespace-nowrap text-xs text-mute">{stamp(c.captured_at)}</td>
                <td className="text-ink-2">{c.store}</td>
                <td className="r num">{c.listed}</td>
                <td className="r num">{c.promos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function PromoTable({ list, company }: { list: Row[]; company: string }) {
  return (
      <div className="overflow-x-auto">
          <table className="dt">
            <thead>
              <tr>
                <th>Product</th>
                <th>Store</th>
                <th>Offer</th>
                <th className="r">Per pack</th>
                <th className="r">Reference</th>
                <th className="r">Discount</th>
                <th>Ends</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 60).map((r) => {
                const p = r.promo!;
                return (
                  <tr key={r.obsId}>
                    <td className="max-w-[300px]">
                      <div className="flex items-center gap-2">
                        <OwnDot own={r.company === company} />
                        <span className="truncate text-ink" title={`${r.name} · ${r.brand}`}>{r.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2" title={r.storeName}>
                        <StoreBadge banner={r.banner} /> {r.banner}
                      </span>
                    </td>
                    <td title={p.conditions ?? undefined}>
                      <PromoChip type={p.type} label={p.label} />
                    </td>
                    <td className="r"><Price value={p.offerPrice} /></td>
                    <td className="r">
                      {p.referencePrice != null ? (
                        <span title={p.referenceKind === "regular" ? "Regular price" : "Lowest price in previous 30 days"}>
                          <Price value={p.referencePrice} className="text-ink-2" />
                          <span className="ml-1 text-[11px] text-faint">{p.referenceKind === "regular" ? "reg." : "30 d"}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </td>
                    <td className="r num">{p.discountPct != null ? <span className="text-sun">−{p.discountPct.toFixed(0)}%</span> : <span className="text-faint">—</span>}</td>
                    <td className="whitespace-nowrap text-xs text-ink-2">{p.validTo ? stamp(p.validTo, false) : "—"}</td>
                    <td><SourceLink url={r.sourceUrl} label="source" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length > 60 && <p className="border-t border-line px-4 py-2.5 text-xs text-mute">Showing 60 of {list.length}. Use the filters to narrow down.</p>}
      </div>
  );
}
