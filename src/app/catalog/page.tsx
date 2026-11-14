import { db } from "@/lib/db";
import { coverage, DEFAULT_SCOPE } from "@/lib/analytics";
import { pageContext } from "@/lib/context";
import { AREA_SQL } from "@/lib/taxonomy";
import { HBar } from "@/components/Charts";
import { Card, OwnDot, PageHeader, SourceLink, StoreBadge, cls, stamp } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Catalog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await pageContext(searchParams);
  const cov = coverage(DEFAULT_SCOPE);
  const products = db()
    .prepare(
      `SELECT p.id, p.name, p.brand, b.company, b.manufacturer, p.segment, p.ean, p.size_raw, p.size_source, p.size_is_range, p.url,
              COUNT(DISTINCT o.store_id) AS stores, COUNT(o.id) AS obs, MAX(o.captured_at) AS last,
              SUM(o.store_id IN (${DEFAULT_SCOPE.storeIds.map(() => "?").join(",")})) AS in_scope,
              (SELECT COUNT(*) FROM listings l WHERE l.product_id = p.id AND l.status = 'left_offer_page') AS left_pages
       FROM products p LEFT JOIN brands b ON b.name = p.brand
       JOIN observations o ON o.product_id = p.id AND o.store_id IN (SELECT s.id FROM stores s WHERE ${AREA_SQL})
       WHERE p.category = ? GROUP BY p.id ORDER BY stores DESC, p.name`,
    )
    .all(...DEFAULT_SCOPE.storeIds, DEFAULT_SCOPE.category) as Record<string, string | number | null>[];
  const brands = db()
    .prepare(`SELECT b.name, b.manufacturer, b.company, COUNT(p.id) AS n FROM brands b JOIN products p ON p.brand = b.name
              WHERE p.category = ? AND EXISTS (SELECT 1 FROM observations o JOIN stores s ON s.id = o.store_id WHERE o.product_id = p.id AND ${AREA_SQL})
              GROUP BY b.name ORDER BY n DESC, b.name LIMIT 60`)
    .all(DEFAULT_SCOPE.category) as { name: string; manufacturer: string | null; company: string; n: number }[];
  const scopeStores = cov.stores.filter((s) => s.inScope);
  const segMap = new Map<string, number>();
  for (const p of products) segMap.set(String(p.segment), (segMap.get(String(p.segment)) ?? 0) + 1);
  const segCounts = [...segMap.entries()].map(([k, n]) => ({ key: k, label: k, value: n, own: false }));
  const otherStores = cov.stores.filter((s) => !s.inScope);
  const imp = cov.totals.imports[0];
  const impStats = imp ? JSON.parse(imp.stats) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Products & Stores"
       
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title="Your panel stores" pad={false}>
          <div className="overflow-x-auto">
          <table className="dt">
            <thead>
              <tr><th>Store scope</th><th>Level</th><th className="r">Products</th><th className="r">Obs.</th><th>Last capture</th></tr>
            </thead>
            <tbody>
              {scopeStores.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-ink"><StoreBadge banner={s.banner} /> {s.name}</span>
                    {s.address && <div className="pl-6 text-[11px] text-faint">{s.address}</div>}
                  </td>
                  <td className="text-xs text-ink-2">{s.level === "store" ? "Store-level prices" : "Chain-wide offers"}</td>
                  <td className="r num">{s.products}</td>
                  <td className="r num">{s.observations}</td>
                  <td className="whitespace-nowrap text-xs text-mute">{stamp(s.lastCapture)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-xs text-mute">+ {otherStores.length} more Helsinki stores in the all-store views (store index, K vs S gap, outliers).</p>
        </Card>

        <div className="space-y-5">
          <Card title="Dataset">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-mute">Products (all categories)</dt><dd className="num text-ink-2">{cov.totals.products}</dd>
              <dt className="text-mute">Chocolate & confectionery</dt><dd className="num text-ink-2">{cov.totals.categoryProducts}</dd>
              <dt className="text-mute">Price observations</dt><dd className="num text-ink-2">{cov.totals.observations.toLocaleString("en")}</dd>
              <dt className="text-mute">Verified promotions (all)</dt><dd className="num text-ink-2">{cov.totals.promotions.toLocaleString("en")}</dd>
              <dt className="text-mute">Helsinki stores</dt><dd className="num text-ink-2">{cov.totals.stores}</dd>
              <dt className="text-mute">Last import</dt><dd className="text-ink-2">{imp ? `${stamp(imp.finished_at)} · ${imp.source}` : "—"}</dd>
              {impStats && (<><dt className="text-mute">Skipped on import</dt><dd className="text-ink-2">{impStats.observationsSkipped} rows (demo page)</dd></>)}
            </dl>
          </Card>

          <Card title="Data quality">
            <ul className="space-y-2">
              {cov.flags.map((f) => (
                <li key={f.flag} className="flex gap-3 text-[13px]">
                  <span className="num w-8 shrink-0 text-right text-ink">{f.products}</span>
                  <span className="text-ink-2">{f.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Products per comparison group">
        <HBar data={segCounts} kind="count" sort="desc" labelWidth={170} />
      </Card>
      <Card title="Observations per store scope">
        <HBar data={scopeStores.map((s) => ({ key: s.id, label: s.banner + (s.level === "chain" ? " (chain)" : ` ${s.name.split(" ").slice(-1)[0]}`), value: s.observations, own: false, sub: s.name }))} kind="count" sort="desc" labelWidth={150} />
      </Card>
      </div>

      <Card title="Brands" pad={false}>
        <div className="flex flex-wrap gap-2 p-4">
          {brands.map((b) => (
            <span key={b.name} className={cls("chip py-1", b.company === company && "border-tag/40 bg-tagbg")}>
              <OwnDot own={b.company === company} />
              <span className="text-ink">{b.name}</span>
              <span className="text-faint">{b.manufacturer ?? "owner not set"} · {b.n}</span>
            </span>
          ))}
        </div>
      </Card>

      <Card title={`Tracked products · ${products.length}`} pad={false}>
        <div className="max-h-[620px] overflow-auto">
          <table className="dt">
            <thead>
              <tr><th>Product</th><th>Comparison group</th><th>EAN</th><th>Pack</th><th className="r">Stores</th><th className="r">Obs.</th><th>Online listing</th><th>Last seen</th><th>Page</th></tr>
            </thead>
            <tbody>
              {products.slice(0, 300).map((p) => (
                <tr key={p.id as string}>
                  <td className="max-w-[320px]">
                    <div className="flex items-center gap-2">
                      <OwnDot own={p.company === company} />
                      <div className="min-w-0">
                        <div className="truncate text-ink" title={p.name as string}>{p.name}</div>
                        <div className="text-xs text-mute">{p.brand} {p.manufacturer ? `· ${p.manufacturer}` : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-xs text-ink-2">{p.segment}</td>
                  <td className="num text-xs text-mute">{p.ean ?? "—"}</td>
                  <td className="whitespace-nowrap text-xs text-ink-2">
                    {p.size_raw && !p.size_is_range && p.size_source === "retailer" ? `${Math.round(Number(p.size_raw.toString().split(" ")[0]) * 1000)} g` : p.size_raw ?? "—"}
                    {p.size_source === "url" && <div className="text-[11px] text-faint">from URL</div>}
                    {Boolean(p.size_is_range) && <div className="text-[11px] text-faint">range</div>}
                  </td>
                  <td className="r num">{p.stores}{Number(p.in_scope) === 0 && <div className="text-[11px] text-faint">outside scope</div>}</td>
                  <td className="r num">{p.obs}</td>
                  <td className="text-xs">{Number(p.left_pages) > 0 ? <span className="text-sun">left an offer page</span> : <span className="text-mute">listed</span>}</td>
                  <td className="whitespace-nowrap text-xs text-mute">{stamp(p.last as string)}</td>
                  <td><SourceLink url={p.url as string} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
