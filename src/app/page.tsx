import Link from "next/link";
import { ArrowRight, AlertTriangle, Info } from "lucide-react";
import { listAlerts, positioning, retailerGap } from "@/lib/analytics";
import { pageContext } from "@/lib/context";
import { attention, overallPosition, ownChainGaps, shelfCoverage } from "@/lib/pov";
import { topWithOwn } from "@/lib/chartdata";
import { Card, Empty, Kpi, OwnDot, PageHeader, Price, PromoChip, SourceLink, StoreBadge, ago, cls, pct, stamp } from "@/components/ui";
import { GapBars, HBar, Legend } from "@/components/Charts";
import { AlertItem } from "@/components/AlertItem";
import { FilterBar } from "@/components/FilterBar";
import { filterOptions, filterRows, parseFilters, storeFilter, without } from "@/lib/filters";

export const dynamic = "force-dynamic";

/** Home screen for a customer company ("you"): its shelf, its price position, and what competitors do next to it. */
export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sp, rows: allRows, company } = await pageContext(searchParams);
  const q = "";
  // Page filters (URL) apply to every visual below.
  const f = parseFilters(sp);
  const rows = filterRows(allRows, f, company);
  const sf = storeFilter(f, company);
  const pos = positioning(rows, company);
  const cov = shelfCoverage(company, sf);
  const chainGap = retailerGap(undefined, sf).byCompany.find((g) => g.company === company);
  const gaps = ownChainGaps(company, 8, sf);
  const todo = attention(company, rows, pos, sf);
  // Charts that set a filter are computed without their own dimension, so they keep all bars and dim the rest.
  const posAll = positioning(filterRows(allRows, without(f, "segment"), company), company);
  const covAll = shelfCoverage(company, storeFilter(without(f, "banner"), company));
  const rowsNoCo = filterRows(allRows, without(f, "company"), company);
  const overall = overallPosition(pos);

  const own = rows.filter((r) => r.company === company);
  const ownSegments = new Set(own.map((r) => r.segment).filter(Boolean) as string[]);
  const ownPromos = own.filter((r) => r.promo?.active);
  const against = rows
    .filter((r) => r.company !== company && r.promo?.active && r.segment && ownSegments.has(r.segment))
    .sort((a, b) => (b.promo!.discountPct ?? -1) - (a.promo!.discountPct ?? -1));
  const latest = rows.reduce((m, r) => (r.capturedAt > m ? r.capturedAt : m), "");
  const alerts = listAlerts(40).filter((a) => a.company === company || (a.segment && ownSegments.has(a.segment)));

  const pressure = new Map<string, number>();
  const ownSegNoCo = new Set(rowsNoCo.filter((r) => r.company === company && r.segment).map((r) => r.segment!));
  for (const r of rowsNoCo.filter((x) => x.promo?.active && (x.company === company || (x.segment && ownSegNoCo.has(x.segment)))))
    pressure.set(r.company ?? "Other", (pressure.get(r.company ?? "Other") ?? 0) + 1);

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <>
            Your shelf in Helsinki · <span className="text-tag">{company}</span>
          </>
        }
      />
      <FilterBar options={filterOptions(allRows, company)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Your products on shelf" value={cov.products} hint="seen with a price online" />
        <Kpi label="Stores listing you" value={`${cov.carrying}/${cov.stores}`} hint="Helsinki stores priced" />
        <Kpi label="Your price vs competitors" value={overall == null ? "—" : pct(overall)} tone={overall == null ? "muted" : undefined} hint="median €/kg gap across your groups" />
        <Kpi label="K-Group vs S Group" value={chainGap ? pct(chainGap.gap) : "—"} tone={chainGap ? undefined : "muted"} hint={chainGap ? `your same products, ${chainGap.products} EANs` : "no product in both chains"} />
        <Kpi label="Your live offers" value={ownPromos.length} hint={`${against.length} competitor offers in your groups`} />
        <Kpi label="Latest data" value={<span className="text-[17px]">{stamp(latest)}</span>} hint={ago(latest)} />
      </div>

      <Card title="Needs your attention" pad={false}>
        {todo.length ? (
          <ul className="divide-y divide-line-2">
            {todo.map((t, i) => (
              <li key={i}>
                <Link href={`${t.href ?? "/"}${q}`} title={t.detail} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02]">
                  <span className={cls("grid h-6 w-6 shrink-0 place-items-center rounded-md", t.tone === "warn" ? "bg-sunbg text-sun" : "bg-raised text-mute")}>
                    {t.tone === "warn" ? <AlertTriangle size={13} aria-hidden /> : <Info size={13} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink">{t.title}</span>
                  </span>
                  <ArrowRight size={14} className="text-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <Empty>Nothing stands out for {company} in the latest captures.</Empty>
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Your price position">
          {posAll.some((p) => p.gapPct != null) ? (
            <GapBars
              filter="segment"
              labels={[company, "competitors"]}
              data={posAll.filter((p) => p.gapPct != null).map((p) => ({ label: p.segment, gap: p.gapPct!, own: p.ownMedian!, comp: p.competitorMedian!, n: `${p.ownObs} yours · ${p.competitorObs} competitor listings` }))}
            />
          ) : (
            <Empty>No like-for-like competitor prices for {company} yet.</Empty>
          )}
        </Card>
        <Card title="Your products: K-Group vs S Group">
          {gaps.length ? (
            <GapBars labels={["K-Group", "S Group"]} unit="" data={gaps.map((g) => ({ label: g.name.replace(/\s+\d+\s?g$/i, ""), gap: g.gap, own: g.kesko, comp: g.sGroup, n: `${g.stores} stores` }))} />
          ) : (
            <Empty>None of your products is priced in both chains.</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Your share of the online sweets range">
          <HBar filter="banner" data={covAll.byBanner.map((b) => ({ key: b.banner, label: b.banner, value: Math.round(b.rangeShare * 1000) / 10, own: true, sub: `avg ${Math.round(b.ownPerStore)} of ${Math.round(b.allPerStore)} products per store · ${b.carrying}/${b.stores} stores list you` }))} kind="pct" sort="desc" labelWidth={140} />
        </Card>
        <Card title="Offers in your groups" right={<Legend ownLabel={company} />}>
          <HBar filter="company" data={topWithOwn([...pressure.entries()], company).map(([c, n]) => ({ key: c, label: c, value: n, own: c === company }))} kind="count" sort="desc" labelWidth={110} />
        </Card>
        <Card title="Latest changes for you" right={<Link href={`/monitor${q}`} className="btn-ghost h-7 min-h-7 px-2 text-xs">All <ArrowRight size={13} /></Link>} pad={false}>
          {alerts.length ? (
            <ul className="divide-y divide-line-2">
              {alerts.slice(0, 3).map((a) => (
                <AlertItem key={a.id} a={a} company={company} compact />
              ))}
            </ul>
          ) : (
            <div className="p-4">
              <Empty>
                No detected changes on your products or in your groups yet. Delta&apos;s monitors report here.{" "}
                <Link href={`/monitor${q}`} className="text-tag hover:underline">
                  See monitors
                </Link>
              </Empty>
            </div>
          )}
        </Card>
      </div>

      <Card title="Competitor offers against you" pad={false}>
        {against.length ? (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Group</th>
                  <th>Store</th>
                  <th>Offer</th>
                  <th className="r">Price</th>
                  <th className="r">Discount</th>
                  <th>Ends</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {against.slice(0, 8).map((r) => (
                  <tr key={r.obsId}>
                    <td className="max-w-[280px]">
                      <div className="flex items-center gap-2">
                        <OwnDot own={false} />
                        <span className="truncate text-ink" title={`${r.name} · ${r.company}`}>{r.name}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-xs text-mute">{r.segment}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2" title={r.storeName}>
                        <StoreBadge banner={r.banner} /> {r.banner}
                      </span>
                    </td>
                    <td>
                      <PromoChip type={r.promo!.type} label={r.promo!.label} />
                    </td>
                    <td className="r">
                      <Price value={r.promo!.offerPrice} />
                    </td>
                    <td className="r num">{r.promo!.discountPct != null ? `−${r.promo!.discountPct.toFixed(0)}%` : <span className="text-faint">n/a</span>}</td>
                    <td className="whitespace-nowrap text-ink-2">{r.promo!.validTo ? stamp(r.promo!.validTo, false) : "—"}</td>
                    <td>
                      <SourceLink url={r.sourceUrl} label="source" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <Empty>No competitor offers in your product groups right now.</Empty>
          </div>
        )}
      </Card>

      <Card title="Your groups in detail" right={<Legend ownLabel={company} />}>
        {pos.length ? (
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
            {pos.map((p) => (
              <div key={p.segment} className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                  <h3 className="text-[13px] text-ink">{p.segment}</h3>
                  <span
                    className={cls(
                      "chip",
                      p.positioning === "premium" ? "border-sky/30 bg-skybg text-sky" : p.positioning === "value" ? "border-leaf/30 bg-mint text-leaf" : p.positioning === "parity" ? "text-ink-2" : "text-faint",
                    )}
                  >
                    {p.positioning === "no comparison" ? "no comparable competitor" : `you are ${p.positioning === "premium" ? "above" : p.positioning === "value" ? "below" : "level"} ${pct(p.gapPct)}`}
                  </span>
                  <span className="text-xs text-faint">n {p.ownObs}/{p.competitorObs}</span>
                </div>
                {p.ownMedian != null || p.competitors.length ? (
                  <HBar
                    labelWidth={120}
                    data={[
                      ...(p.ownMedian != null ? [{ key: "own", label: company, value: p.ownMedian, own: true, n: p.ownObs }] : []),
                      ...[...p.competitors].sort((a, b) => b.n - a.n).slice(0, 7).map((c) => ({ key: c.company, label: c.company, value: c.median, own: false, n: c.n })),
                    ]}
                  />
                ) : (
                  <p className="text-xs text-mute">No unit price (pack size is a range).</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty>{company} has no listings in the panel stores.</Empty>
        )}
      </Card>
    </div>
  );
}
