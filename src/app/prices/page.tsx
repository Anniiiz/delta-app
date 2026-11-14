import { median, retailerGap, storeIndex, storeSpread } from "@/lib/analytics";
import { pageContext } from "@/lib/context";
import { PriceExplorer } from "@/components/PriceExplorer";
import { toExplorerRows } from "@/lib/explorer";
import { GapBars, HBar, Legend } from "@/components/Charts";
import { FilterBar } from "@/components/FilterBar";
import { filterOptions, filterRows, parseFilters, storeFilter, without } from "@/lib/filters";
import { Card, Empty, OwnDot, PageHeader, Price, StoreBadge, SourceLink } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Prices({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sp, rows: allRows, company } = await pageContext(searchParams);
  const f = parseFilters(sp);
  const rows = filterRows(allRows, f, company);
  const sf = storeFilter(f, company);
  // Click-to-filter charts are computed without their own dimension (cross-highlight).
  const gap = retailerGap(undefined, storeFilter(without(f, "company"), company));
  const idx = storeIndex(undefined, storeFilter(without(f, "banner"), company));
  // Your products first, then the competitors with the widest store-to-store spread.
  const allSpread = storeSpread(undefined, 400, sf);
  const spread = [...allSpread.filter((s) => s.company === company).slice(0, 4), ...allSpread.filter((s) => s.company !== company)].slice(0, 6);
  const ownSegments = rows.filter((r) => r.company === company && r.segment).map((r) => r.segment!);
  // A page-level product-group filter takes over from the explorer's own default group.
  const initialSegment = f.segment.length ? "" : ownSegments.includes("Chocolate tablets") ? "Chocolate tablets" : (ownSegments[0] ?? "");

  // Store price index per chain banner
  const byBanner = new Map<string, number[]>();
  for (const s of idx) byBanner.set(s.banner, [...(byBanner.get(s.banner) ?? []), s.index]);
  const bannerData = [...byBanner.entries()].map(([b, xs]) => ({ key: b, label: `${b} (${xs.length})`, value: median(xs)!, own: false, sub: `${xs.length} stores · median store index` }));
  const gapCos = gap.byCompany.slice(0, 10);

  return (
    <div className="space-y-5">
      <PageHeader title={`Your prices vs competitors`} />
      <FilterBar options={filterOptions(allRows, company)} />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Same product, two chains: where you stand"
         
          right={<Legend ownLabel={company} otherLabel="Other companies" />}
        >
          {gapCos.length ? (
            <GapBars
              filter="company"
              labels={["K-Group", "S Group"]}
              unit=""
              data={gapCos.map((c) => ({ label: c.company, gap: c.gap, own: c.kesko, comp: c.sGroup, n: `${c.products} products · median shelf price`, isOwn: c.company === company }))}
            />
          ) : (
            <Empty>Not enough products priced in both chains.</Empty>
          )}
        </Card>

        <Card title="Store price index">
          {bannerData.length ? <HBar filter="banner" data={bannerData} kind="index" min={80} labelWidth={150} /> : <Empty>Needs store-level prices from at least 5 stores.</Empty>}
          {idx.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-4 text-[12.5px]">
              {[
                ["Cheapest", idx.slice(0, 3)],
                ["Priciest", idx.slice(-3).reverse()],
              ].map(([t, xs]) => (
                <div key={t as string}>
                  <div className="label mb-1">{t as string}</div>
                  {(xs as typeof idx).map((s) => (
                    <div key={s.storeId} className="flex items-center gap-1.5 py-0.5">
                      <StoreBadge banner={s.banner} />
                      <span className="min-w-0 flex-1 truncate text-ink-2">{s.name}</span>
                      <span className="num text-ink">{s.index.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Store-by-store price differences" pad={false}>
        {spread.length ? (
          <ul className="grid divide-y divide-line-2 md:grid-cols-2 md:divide-y-0">
            {spread.map((s) => (
              <li key={s.retailer + s.productId} className="border-line-2 px-4 py-3 md:border-b">
                <div className="flex items-center gap-2">
                  <OwnDot own={s.company === company} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.name}</span>
                  <span className="text-xs text-mute">{s.retailer}</span>
                </div>
                <p className="mt-1 pl-4 text-xs text-mute">
                  <Price value={s.modal} className="text-ink-2" /> in most of {s.stores} stores, except:
                </p>
                <ul className="mt-1 space-y-1 pl-4">
                  {s.outliers.map((o) => (
                    <li key={o.storeName} className="flex items-center gap-2 text-[12.5px]">
                      <span className="flex-1 truncate text-ink-2">{o.storeName}</span>
                      <Price value={o.price} className={o.price < s.modal ? "text-leaf" : "text-berry"} />
                      <SourceLink url={o.sourceUrl} label="src" />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <Empty>No store-level price differences found.</Empty>
          </div>
        )}
      </Card>

      <PriceExplorer
        key={JSON.stringify(f)}
        rows={toExplorerRows(f.segment.length ? rows : rows.filter((r) => r.segment === initialSegment))}
        company={company}
        segments={filterOptions(allRows, company).segment}
        segment={f.segment.length === 1 ? f.segment[0] : f.segment.length ? "" : initialSegment}
      />
    </div>
  );
}
