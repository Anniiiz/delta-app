import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/lib/context";
import { areaView, categoryOf, followedThrough, subcategoryOf } from "@/lib/favourites";
import { AccountPromoTable } from "@/components/AccountPromos";
import { CategoryTree } from "@/components/CategoryTree";
import { FavButton } from "@/components/FavButton";
import { Card, Empty, Kpi, PageHeader, Price, pct } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My area" };

const ROWS = 40;
const PROMO_ROWS = 15;
const accountHref = (q: Record<string, string>) => `/account?${new URLSearchParams(q).toString()}`;

export default async function AreaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sp, company } = await pageContext(searchParams);
  const now = Date.now();
  const v = areaView(company, now);
  const catHref = (c: string) => accountHref({ cat: c });
  const subHref = (s: string) => accountHref({ sub: s });

  if (v.empty) {
    return (
      <div className="space-y-5">
        <PageHeader title="My area" />
        <p className="max-w-3xl text-[13px] text-mute">
          Follow the categories, subcategories or products you are responsible for. This page then shows just that area: its products, live promotions and competitor offers in the same
          subcategories. Saved for this workspace.
        </p>
        <CategoryTree tree={v.tree} catHref={catHref} subHref={subHref} sub="Star a category to follow all of it, or a subcategory for one product group. Products can be starred in My Products." />
      </div>
    );
  }

  const s = v.summary;
  const ws = s.widestSpread;
  const names = new Map(v.all.map((p) => [p.key, p.name]));
  const showAll = sp.all === "1";
  // Starred products first, then most widely listed (the account order; the sort is stable).
  const ordered = [...v.products].sort((a, b) => Number(b.area === "starred") - Number(a.area === "starred"));
  const rows = showAll ? ordered : ordered.slice(0, ROWS);
  const live = v.own.filter((p) => p.active);
  const competitors = v.competitors.filter((p) => p.active);

  return (
    <div className="space-y-5">
      <PageHeader title="My area" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Products in my area" value={s.products} hint={`${s.subcategories.length} subcategor${s.subcategories.length === 1 ? "y" : "ies"} · same EAN merged`} />
        <Kpi
          label="Stores seen"
          value={
            <>
              {s.storesSeen} <span className="text-[15px] font-medium text-mute">of {s.storeScopesTotal}</span>
            </>
          }
          hint="store scopes with at least one capture"
        />
        <Kpi
          label="Live promotions"
          value={s.livePromos}
          hint={
            <>
              {s.promoStoreListings} store listings
              {s.endingSoon > 0 && <span className="text-sun"> · {s.endingSoon} ending in 3 days</span>}
            </>
          }
        />
        <Kpi
          label="Widest price spread"
          value={ws ? pct(ws.pct / 100, false) : "—"}
          tone={ws ? undefined : "muted"}
          hint={
            ws ? (
              <Link href={accountHref({ p: ws.key })} className="block truncate hover:text-tag" title={ws.name}>
                {ws.name} · €{ws.min.toFixed(2)}–€{ws.max.toFixed(2)} · {ws.stores} stores
              </Link>
            ) : (
              "Needs a product seen in 2+ stores"
            )
          }
        />
      </div>

      <Card title="Following" right={<Link href="/account#categories" className="btn-ghost h-7 min-h-7 px-2 text-xs">Edit in My Products</Link>}>
        <ul className="flex flex-wrap gap-1.5">
          {v.favourites.map((f) => {
            const label = f.kind === "product" ? names.get(f.key) ?? f.key : f.key;
            const href = f.kind === "product" ? accountHref({ p: f.key }) : f.kind === "category" ? catHref(f.key) : subHref(f.key);
            return (
              <li key={`${f.kind}:${f.key}`} className="inline-flex max-w-full items-center rounded-[5px] border border-line bg-white/[0.02] pr-2">
                <FavButton kind={f.kind} id={f.key} on label={label} className="-my-px" />
                <Link href={href} className="min-w-0 truncate text-[13px] text-ink-2 hover:text-tag" title={label}>
                  {label}
                </Link>
                <span className="ml-1.5 text-[11px] text-faint">{f.kind}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card id="products" title="Products in my area" sub="Starred products first, then the most widely listed. A store without a capture is not evidence the product is absent." pad={false}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr>
                  <th className="w-9 !pr-0">
                    <span className="sr-only">Favourite</span>
                  </th>
                  <th>Product</th>
                  <th>Subcategory</th>
                  <th className="r">Stores seen</th>
                  <th className="r">Most common</th>
                  <th className="r">Range</th>
                  <th className="r">Spread</th>
                  <th className="r">Promo stores</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const sub = subcategoryOf(p.segment);
                  const multi = p.storesSeen >= 2;
                  return (
                    <tr key={p.key}>
                      <td className="w-9 !py-0 !pl-1.5 !pr-0">
                        <FavButton kind="product" id={p.key} on={p.area === "starred"} implied={p.area === "implied" ? followedThrough(p, v.sets) : undefined} label={p.name} />
                      </td>
                      <td className="max-w-[300px]">
                        <Link href={accountHref({ p: p.key })} className="block truncate text-ink hover:text-tag" title={p.name}>
                          {p.name}
                        </Link>
                        {p.brand && <div className="truncate text-xs text-mute">{p.brand}</div>}
                      </td>
                      <td className="whitespace-nowrap text-ink-2" title={categoryOf(sub)}>{sub}</td>
                      <td className="r num text-ink">{p.storesSeen}</td>
                      <td className="r"><Price value={p.modePrice} /></td>
                      <td className="r whitespace-nowrap">
                        {multi && p.maxPrice !== p.minPrice ? (
                          <span className="text-xs text-mute">
                            €{p.minPrice.toFixed(2)}–€{p.maxPrice.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="r num">{p.spreadPct ? <span className="chip text-ink-2" title="Across store-level scopes">{pct(p.spreadPct / 100, false)}</span> : <span className="text-faint">—</span>}</td>
                      <td className="r num">{p.promoStores > 0 ? <span className="text-sun">{p.promoStores}</span> : <span className="text-faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length < v.products.length && (
              <div className="border-t border-line px-4 py-2.5 text-xs text-mute">
                Showing {rows.length} of {v.products.length} products.{" "}
                <Link href="/area?all=1#products" className="text-tag hover:underline">
                  Show all
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            <Empty>No captured {company} products in the followed area yet.</Empty>
          </div>
        )}
      </Card>

      <Card id="ending" title="Promotions ending soon in my area" sub="Live offers on products in my area, soonest-ending first. Discount % only where the retailer states a reference price." pad={false}>
        {live.length ? (
          <>
            <AccountPromoTable rows={live.slice(0, PROMO_ROWS)} now={now} productHref={(key) => accountHref({ p: key })} />
            {live.length > PROMO_ROWS && (
              <div className="border-t border-line px-4 py-2.5 text-xs text-mute">
                Showing {PROMO_ROWS} of {live.length} offers.{" "}
                <Link href="/account?area=1&all=1#promotions" className="text-tag hover:underline">
                  Show all in My Products
                </Link>
              </div>
            )}
          </>
        ) : (
          <div className="p-4">
            <Empty>No live promotions on products in my area in the captured pages.</Empty>
          </div>
        )}
      </Card>

      <Card
        id="competitors"
        title="Competitors in my area"
        sub={`Other companies' live offers in ${s.subcategories.join(", ")}. Identical offers on several products of one brand are merged into one row.`}
        pad={false}
      >
        {competitors.length ? (
          <>
            <AccountPromoTable rows={competitors.slice(0, PROMO_ROWS)} now={now} showCompany groupBySegment />
            {competitors.length > PROMO_ROWS && (
              <div className="border-t border-line px-4 py-2.5 text-xs text-mute">
                Showing {PROMO_ROWS} of {competitors.length} competitor offers, soonest-ending first.{" "}
                <Link href="/account?area=1&all=1#competitors" className="text-tag hover:underline">
                  Show all in My Products
                </Link>
              </div>
            )}
          </>
        ) : (
          <div className="p-4">
            <Empty>No live competitor promotions captured in the subcategories of my area.</Empty>
          </div>
        )}
      </Card>
    </div>
  );
}
