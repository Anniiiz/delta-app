import Link from "next/link";
import { X } from "lucide-react";
import { accountCells, accountSummary, bannerTotals, type AccountBannerStat, type AccountProduct } from "@/lib/account";
import { areaView, categoryOf, followedThrough, subcategoryOf } from "@/lib/favourites";
import { CategoryTree } from "@/components/CategoryTree";
import { FavButton } from "@/components/FavButton";
import { DEFAULT_COMPANY, pageContext } from "@/lib/context";
import { AccountPromoTable } from "@/components/AccountPromos";
import { AccountStores } from "@/components/AccountStores";
import { Card, Empty, Kpi, PageHeader, Price, StoreBadge, cls, pct, stamp } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Banner columns, grouped by retailer: S Group, Kesko, Lidl. */
const BANNER_ORDER = ["Prisma", "S-market", "Alepa", "K-Citymarket", "K-Supermarket", "K-Market", "Lidl"];
const bannerRank = (b: string) => {
  const i = BANNER_ORDER.indexOf(b);
  return i < 0 ? BANNER_ORDER.length : i;
};

/** Store-level spread from the account lib, in percent 0-100, as a fraction for `pct`. */
const frac = (x: number | null | undefined) => (x == null ? null : x / 100);

export default async function Account({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sp, company } = await pageContext(searchParams);
  const now = Date.now();
  const summary = accountSummary(company, now);
  // Favourites: one pass gives every product with its area state, the category tree and the area promotions.
  const area = areaView(company, now);
  const products = area.all;
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const cat = str(sp.cat) && area.tree.some((c) => c.name === sp.cat) ? str(sp.cat) : null;
  const sub = str(sp.sub) && area.tree.some((c) => c.subcategories.some((s) => s.name === sp.sub)) ? str(sp.sub) : null;
  const areaOnly = sp.area === "1";
  const areaEmpty = areaOnly && area.products.length === 0;
  const filtered = products.filter(
    (p) => (!areaOnly || p.area != null) && (!sub || subcategoryOf(p.segment) === sub) && (!cat || categoryOf(subcategoryOf(p.segment)) === cat),
  );
  // Starred products first, then the existing order (most widely listed first; the sort is stable).
  const listed = [...filtered].sort((a, b) => Number(b.area === "starred") - Number(a.area === "starred"));
  const { own, competitors } = areaOnly ? { own: area.own, competitors: area.competitors } : area.allPromos;
  const starOf = (p: (typeof products)[number]) => (
    <FavButton kind="product" id={p.key} on={p.area === "starred"} implied={p.area === "implied" ? followedThrough(p, area.sets) : undefined} label={p.name} />
  );
  // One column per banner; a banner can have both store-level scopes and a chain-wide offer feed.
  const merged = new Map<string, { banner: string; retailer: string; stores: number; feed: boolean }>();
  for (const t of bannerTotals()) {
    const m = merged.get(t.banner) ?? { banner: t.banner, retailer: t.retailer, stores: 0, feed: false };
    if (t.level === "chain") m.feed = true;
    else m.stores += t.stores;
    merged.set(t.banner, m);
  }
  const totals = [...merged.values()].sort((a, b) => bannerRank(a.banner) - bannerRank(b.banner) || a.retailer.localeCompare(b.retailer) || a.banner.localeCompare(b.banner));
  const order = totals.map((t) => t.banner);

  const selectedKey = str(sp.p);
  // Links keep the current product, category / subcategory and area filters unless overridden.
  const link = (o: { p?: string | null; cat?: string | null; sub?: string | null; area?: boolean; all?: boolean } = {}) => {
    const v = { p: selectedKey, cat, sub, area: areaOnly, all: false, ...o };
    const q = new URLSearchParams();
    if (company !== DEFAULT_COMPANY) q.set("company", company);
    if (v.p) q.set("p", v.p);
    if (v.cat) q.set("cat", v.cat);
    if (v.sub) q.set("sub", v.sub);
    if (v.area) q.set("area", "1");
    if (v.all) q.set("all", "1");
    const s = q.toString();
    return s ? `/account?${s}` : "/account";
  };
  const href = (key?: string) => link({ p: key ?? null });

  // Long tables are cut to the top rows so the page stays light; ?all=1 shows everything.
  const showAll = sp.all === "1";
  const ROWS = 40;
  const shown = showAll ? listed : listed.slice(0, ROWS);
  const ownShown = showAll ? own : own.slice(0, ROWS);
  const competitorsShown = showAll ? competitors : competitors.slice(0, ROWS * 2);
  const allHref = (anchor: string) => `${link({ all: true })}#${anchor}`;
  const filtering = !!(cat || sub || areaOnly);
  const More = ({ n, of, what, anchor }: { n: number; of: number; what: string; anchor: string }) =>
    n < of ? (
      <div className="border-t border-line px-4 py-2.5 text-xs text-mute">
        Showing {n} of {of} {what}.{" "}
        <Link href={allHref(anchor)} className="text-tag hover:underline">
          Show all
        </Link>
      </div>
    ) : null;

  const selected = selectedKey ? products.find((p) => p.key === selectedKey) ?? null : null;
  const ws = summary.widestSpread;

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Products"
        sub={`Every ${company} product captured on retailer pages, across all categories and all ${summary.storeScopesTotal} store scopes. Shelf prices are set by retailers; this view describes what their pages showed.`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Products" value={summary.products} hint={`${summary.banners} banner${summary.banners === 1 ? "" : "s"} · same EAN merged`} />
        <Kpi
          label="Stores seen"
          value={
            <>
              {summary.storesSeen} <span className="text-[15px] font-medium text-mute">of {summary.storeScopesTotal}</span>
            </>
          }
          hint="store scopes with at least one capture"
        />
        <Kpi
          label="Live promotions"
          value={summary.livePromos}
          hint={
            <>
              {summary.promoStoreListings} store listings
              {summary.endingSoon > 0 && <span className="text-sun"> · {summary.endingSoon} ending in 3 days</span>}
            </>
          }
        />
        <Kpi
          label="Widest price spread"
          value={ws ? pct(frac(ws.pct), false) : "—"}
          tone={ws ? undefined : "muted"}
          hint={
            ws ? (
              <Link href={href(ws.key)} className="block truncate hover:text-tag" title={ws.name}>
                {ws.name} · €{ws.min.toFixed(2)}–€{ws.max.toFixed(2)} · {ws.stores} stores
              </Link>
            ) : (
              "Needs a product seen in 2+ stores"
            )
          }
        />
      </div>

      {selectedKey && (selected ? <ProductDetail product={selected} company={company} order={order} clear={href()} now={now} star={starOf(selected)} /> : (
        <Card title="Product not found" right={<ClearLink href={href()} />}>
          <Empty>No {company} product with key {selectedKey} in the captured data.</Empty>
        </Card>
      ))}

      <CategoryTree
        tree={area.tree}
        catHref={(c) => link({ cat: c === cat ? null : c, sub: null })}
        subHref={(s) => link({ sub: s === sub ? null : s, cat: null })}
        active={{ cat, sub }}
        right={
          <Link
            href={link({ area: !areaOnly })}
            role="switch"
            aria-checked={areaOnly}
            className="inline-flex h-7 shrink-0 items-center gap-2 rounded-md px-1.5 text-xs font-medium text-ink-2 hover:bg-raised hover:text-ink"
          >
            <span aria-hidden className={cls("relative h-4 w-7 rounded-full border transition-colors", areaOnly ? "border-accent bg-accent" : "border-line bg-white/[0.04]")}>
              <span className={cls("absolute top-[1px] h-3 w-3 rounded-full transition-all", areaOnly ? "left-[12px] bg-white" : "left-[1px] bg-mute")} />
            </span>
            My area only
          </Link>
        }
      />

      {filtering && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-mute">
          <span className="mr-1">
            Showing <span className="num text-ink-2">{filtered.length}</span> of <span className="num">{products.length}</span> products
          </span>
          {cat && <FilterChip href={link({ cat: null })} label={cat} />}
          {sub && <FilterChip href={link({ sub: null })} label={sub} />}
          {areaOnly && <FilterChip href={link({ area: false })} label="My area" />}
          {[cat, sub, areaOnly].filter(Boolean).length > 1 && (
            <Link href={link({ cat: null, sub: null, area: false })} className="ml-1 text-tag hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      )}

      {areaEmpty ? (
        <Card title="My area is empty">
          <Empty>
            Star a category or subcategory above, or a product in the tables, to follow it. My area then shows just those products, their promotions and competitor offers in the same subcategories.{" "}
            <Link href={link({ area: false })} className="text-tag hover:underline">
              Show all products
            </Link>
          </Empty>
        </Card>
      ) : (
      <>
      <Card
        id="presence"
        title="Store presence"
        sub="Stores where each product was seen with a price, out of the captured stores of that banner. Prices come from captured retailer pages; a store without a capture is not evidence the product is absent."
        pad={false}
      >
        {listed.length ? (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr>
                  <th className="w-9 !pr-0">
                    <span className="sr-only">Favourite</span>
                  </th>
                  <th>Product</th>
                  {totals.map((t) => (
                    <th key={t.banner} className="r">
                      <span className="inline-flex items-center gap-1.5">
                        <StoreBadge banner={t.banner} /> {t.banner}
                      </span>
                      <div className="text-[11px] font-normal text-faint">{[t.stores ? `${t.stores} store${t.stores === 1 ? "" : "s"}` : null, t.feed ? "offer feed" : null].filter(Boolean).join(" + ")}</div>
                    </th>
                  ))}
                  <th className="r">Stores seen</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const by = new Map(p.banners.map((b) => [b.banner, b]));
                  const on = p.key === selected?.key;
                  return (
                    <tr key={p.key} className={on ? "bg-tagbg" : undefined}>
                      <td className="w-9 !py-0 !pl-1.5 !pr-0">{starOf(p)}</td>
                      <td className="max-w-[300px]">
                        <Link href={href(p.key)} className={cls("block truncate hover:text-tag", on ? "text-tag" : "text-ink")} title={p.name} aria-current={on ? "true" : undefined}>
                          {p.name}
                        </Link>
                        <div className="truncate text-xs text-mute">{[p.brand, p.segment].filter(Boolean).join(" · ") || (p.ean ? `EAN ${p.ean}` : "")}</div>
                      </td>
                      {totals.map((t) => (
                        <PresenceCell key={t.banner} stat={by.get(t.banner)} banner={t.banner} />
                      ))}
                      <td className="r num font-medium text-ink">{p.storesSeen}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <More n={shown.length} of={listed.length} what={`products, ${area.sets.products.size ? "starred first, then " : ""}most widely listed first`} anchor="presence" />
          </div>
        ) : (
          <div className="p-4">
            <Empty>{filtering ? "No captured products match these filters." : `No captured listings for ${company}.`}</Empty>
          </div>
        )}
      </Card>

      <Card id="prices" title="Shelf price by store" sub="Most common shelf price and the range across stores where each product was seen. Spread only for products seen in 2 or more stores." pad={false}>
        {listed.length ? (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="r">Most common</th>
                  <th className="r">Min</th>
                  <th className="r">Max</th>
                  <th className="r">Spread</th>
                  <th>By banner</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const multi = p.storesSeen >= 2;
                  return (
                    <tr key={p.key}>
                      <td className="max-w-[300px]">
                        <div className="-my-1 -ml-1.5 flex min-w-0 items-center gap-0.5">
                          {starOf(p)}
                          <Link href={href(p.key)} className="block min-w-0 truncate text-ink hover:text-tag" title={p.name}>
                            {p.name}
                          </Link>
                        </div>
                        <div className="pl-6 text-xs text-mute">
                          {p.storesSeen} store{p.storesSeen === 1 ? "" : "s"}
                          {p.promoStores > 0 && <span className="text-sun"> · {p.promoStores} on promotion</span>}
                        </div>
                      </td>
                      <td className="r"><Price value={p.modePrice} /></td>
                      <td className="r">{multi ? <Price value={p.minPrice} className={p.minPrice < p.modePrice ? "text-leaf" : "text-ink-2"} /> : <span className="text-faint">—</span>}</td>
                      <td className="r">{multi ? <Price value={p.maxPrice} className={p.maxPrice > p.modePrice ? "text-berry" : "text-ink-2"} /> : <span className="text-faint">—</span>}</td>
                      <td className="r num">{multi && p.spreadPct ? <span className="chip text-ink-2" title="Across store-level scopes">{pct(frac(p.spreadPct), false)}</span> : <span className="text-faint">—</span>}</td>
                      <td>
                        <BannerPrices banners={p.banners} order={order} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <More n={shown.length} of={listed.length} what={`products, ${area.sets.products.size ? "starred first, then " : ""}most widely listed first`} anchor="prices" />
          </div>
        ) : (
          <div className="p-4">
            <Empty>{filtering ? "No captured products match these filters." : `No captured prices for ${company}.`}</Empty>
          </div>
        )}
      </Card>

      <Card id="promotions" title="Promotions on my products" sub="Offers advertised on retailer pages, live ones soonest-ending first. Discount % only where the retailer states a reference price. Offers past their stated end date but still on the latest capture are dimmed and marked Ended." pad={false}>
        {own.length ? (
          <>
            <AccountPromoTable rows={ownShown} now={now} productHref={href} />
            <More n={ownShown.length} of={own.length} what="offers, soonest-ending first" anchor="promotions" />
          </>
        ) : (
          <div className="p-4">
            <Empty>{areaOnly ? "No promotions on products in my area in the captured pages." : `No live promotions on ${company} products in the captured pages.`}</Empty>
          </div>
        )}
      </Card>

      <Card
        id="competitors"
        title={areaOnly ? "Competitor promotions in my area" : "Competitor promotions in my groups"}
        sub={
          areaOnly
            ? `Other companies' live offers in the subcategories of my area: ${area.subcategories.join(", ")}. Identical offers on several products of one brand are merged into one row.`
            : `Other companies' offers in the comparison groups where ${company} has products. Identical offers on several products of one brand are merged into one row.`
        }
        pad={false}
      >
        {competitors.length ? (
          <>
            <AccountPromoTable rows={competitorsShown} now={now} showCompany groupBySegment />
            <More n={competitorsShown.length} of={competitors.length} what="competitor offers, soonest-ending first" anchor="competitors" />
          </>
        ) : (
          <div className="p-4">
            <Empty>{areaOnly ? "No live competitor promotions captured in the subcategories of my area." : <>No competitor promotions captured in {company}&apos;s comparison groups.</>}</Empty>
          </div>
        )}
      </Card>
      </>
      )}
    </div>
  );
}

function FilterChip({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="chip border-tag/30 bg-tagbg text-tag hover:border-tag/60" aria-label={`Remove filter ${label}`}>
      {label} <X size={11} aria-hidden />
    </Link>
  );
}

function ClearLink({ href }: { href: string }) {
  return (
    <Link href={href} className="btn-ghost h-7 min-h-7 px-2 text-xs">
      <X size={13} aria-hidden /> Clear
    </Link>
  );
}

function PresenceCell({ stat, banner }: { stat: AccountBannerStat | undefined; banner: string }) {
  if (!stat) {
    return (
      <td className="r">
        <span className="text-faint" title="Not captured">—</span>
      </td>
    );
  }
  if (stat.chainOnly) {
    return (
      <td className="r">
        <span className="text-xs text-ink-2" title={`Seen in the ${banner} chain-wide offer feed, not store-level`}>offer feed</span>
        {stat.promoStores > 0 && <div className="text-[11px] text-sun">on promotion</div>}
      </td>
    );
  }
  const ratio = stat.capturedStores > 0 ? Math.min(1, stat.stores / stat.capturedStores) : 0;
  return (
    <td className="r">
      <span className="num text-ink" title={`Seen with a price in ${stat.stores} of ${stat.capturedStores} captured ${banner} stores${stat.promoStores ? `, ${stat.promoStores} on promotion` : ""}`}>
        {stat.stores}
        <span className="text-faint">/{stat.capturedStores}</span>
      </span>
      <div className="ml-auto mt-1 h-[3px] w-14 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <div className={cls("h-full rounded-full", stat.promoStores > 0 ? "bg-sun/70" : "bg-tag/70")} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </td>
  );
}

function BannerPrices({ banners, order }: { banners: AccountBannerStat[]; order: string[] }) {
  const rank = (b: string) => {
    const i = order.indexOf(b);
    return i < 0 ? order.length : i;
  };
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {[...banners].sort((a, b) => rank(a.banner) - rank(b.banner)).map((b) => (
        <li key={b.banner} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]" title={`${b.banner}: most common €${b.modePrice.toFixed(2)}${b.chainOnly ? " (chain-wide offer feed)" : `, ${b.stores} stores`}`}>
          <StoreBadge banner={b.banner} />
          <Price value={b.modePrice} className="text-ink" />
          {b.maxPrice !== b.minPrice && (
            <span className="text-xs text-mute">
              €{b.minPrice.toFixed(2)}–€{b.maxPrice.toFixed(2)}
            </span>
          )}
          <span className="text-xs text-faint">{b.chainOnly ? "feed" : `· ${b.stores}`}</span>
        </li>
      ))}
    </ul>
  );
}

function ProductDetail({ product: p, company, order, clear, now, star }: { product: AccountProduct; company: string; order: string[]; clear: string; now: number; star: React.ReactNode }) {
  const cells = accountCells(company, p.key, now);
  const rank = (b: string) => {
    const i = order.indexOf(b);
    return i < 0 ? order.length : i;
  };
  const banners = [...p.banners].sort((a, b) => rank(a.banner) - rank(b.banner));
  const meta = [p.ean ? `EAN ${p.ean}` : null, p.brand, p.segment].filter(Boolean).join(" · ");

  return (
    <Card
      title={
        <span className="-my-1 -ml-1.5 flex min-w-0 items-center gap-0.5">
          {star}
          <span className="min-w-0">{p.name}</span>
        </span>
      }
      sub={
        <>
          {meta}
          {meta && " · "}
          seen in {p.storesSeen} store scope{p.storesSeen === 1 ? "" : "s"} · captured {stamp(p.firstSeen, false)}
          {stamp(p.firstSeen, false) !== stamp(p.lastSeen, false) && ` to ${stamp(p.lastSeen, false)}`}
        </>
      }
      right={<ClearLink href={clear} />}
      pad={false}
    >
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        <Stat label="Most common">
          <Price value={p.modePrice} />
        </Stat>
        <Stat label="Lowest">
          <Price value={p.minPrice} className={p.minPrice < p.modePrice ? "text-leaf" : undefined} />
        </Stat>
        <Stat label="Highest">
          <Price value={p.maxPrice} className={p.maxPrice > p.modePrice ? "text-berry" : undefined} />
        </Stat>
        <Stat label="Spread">{p.spreadPct ? pct(frac(p.spreadPct), false) : <span className="text-faint">—</span>}</Stat>
      </div>

      <div className="overflow-x-auto border-b border-line">
        <table className="dt">
          <thead>
            <tr>
              <th>Banner</th>
              <th className="r">Seen</th>
              <th className="r">Most common</th>
              <th className="r">Range</th>
              <th className="r">On promotion</th>
            </tr>
          </thead>
          <tbody>
            {banners.map((b) => (
              <tr key={b.banner}>
                <td>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
                    <StoreBadge banner={b.banner} /> {b.banner}
                  </span>
                </td>
                <td className="r num text-ink-2">{b.chainOnly ? <span className="text-xs">offer feed</span> : `${b.stores} of ${b.capturedStores} captured`}</td>
                <td className="r"><Price value={b.modePrice} /></td>
                <td className="r whitespace-nowrap">
                  {b.maxPrice !== b.minPrice ? (
                    <span className="text-xs text-mute">
                      €{b.minPrice.toFixed(2)}–€{b.maxPrice.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="r num">{b.promoStores > 0 ? <span className="text-sun">{b.chainOnly ? "yes" : b.promoStores}</span> : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AccountStores cells={cells} modePrice={p.modePrice} banners={order} />
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="label">{label}</div>
      <div className="num mt-1 text-[17px] font-semibold text-ink">{children}</div>
    </div>
  );
}
