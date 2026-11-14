# Delta: know what your competitors are doing on every digital shelf

> **Code only.** This repository does not include the captured retailer data (the `data/` folder and the
> page samples under `tests/fixtures/`). To run it with data, set `CONTEXT_DEV_API_KEY` in `.env.local` and
> fetch your own captures with `npm run data:fetch` and `npm run data:import-categories`. The tests that load
> captures (`tests/pipeline.test.ts`, `tests/account.test.ts`, `tests/ask.test.ts`) need that data to pass;
> `tests/favourites.test.ts` runs without it.

Competitive intelligence for FMCG brands (Fazer, Cloetta, Orkla…) selling through Finnish grocery retailers.
Delta turns retailer web pages into one dashboard: competitor prices, normalised unit prices, verified
promotions, assortment changes, and alerts when a monitored page changes. Context.dev keeps it fresh.

Built for the *Context.dev: The Web Is Your Real-Time Database* challenge at Junction 2026. Everything on
screen is live web data read through Context.dev:

- **A fresh batch scrape on 14 Nov 2026:** 2,957 category and offer pages across S-kaupat, K-Ruoka, Lidl and
  Wolt Market, giving about 78,000 store-level prices and their advertised offers.
- **Hourly page monitors** on real product pages. When Context.dev reports a change, Delta re-reads the page
  fresh (cache bypassed), compares it with the stored history and raises an alert only if a price or offer
  really changed.
- **A daily sweep** (`npm run data:sweep`, scheduled at 06:00) that re-reads every page and appends to the
  price history, so the dataset is refreshed every day rather than captured once.

An earlier set of Context.dev captures (13 to 14 Nov 2026) seeded the first version.

## Quick start

```bash
cd shelfintel
npm install
npm run dev                 # http://127.0.0.1:3100 (imports data/source on first start)
npm test                    # 28 tests: classification, normalisation, parsers on real pages, import, analytics, alerts, signatures
```

Data commands:

```bash
npm run data:export         # export an earlier capture database → data/source/seed-export.json
npm run data:import         # (re)import into data/shelfintel.db; appends history, never overwrites
npm run data:report         # regenerate DATA_QUALITY.md
```

Live monitoring needs a key: `cp .env.example .env.local` and set `CONTEXT_DEV_API_KEY`. Everything else
(dashboard, analytics, replay) works without it.

## The data (see DATA_QUALITY.md)

- **Fresh batch scrape (14 Nov 2026):** chocolate and candy category pages from every store with its own online prices, via Context.dev batch scraping (about 3,100 credits):
  - K-Ruoka: 132 K stores × 7 categories (tablets, bars, boxes, wrapped boxes, candy bags, liquorice/toffee, calendars)
  - S-kaupat: 59 S Group stores × 6 categories, every page
  - Lidl: national sweets range (Lidl has no per-store prices online)

  Result: 71,660 store prices for 1,947 products, 5,516 retailer-advertised offers. Raw pages are kept in `data/raw/`.
- **Live monitoring:** three hourly Context.dev page monitors (Fazer Klassikot at Prisma Kaari Kannelmäki and at K-Supermarket Kamppi, Marabou Mjölkchoklad at Alepa Kamppi), polled every minute, plus the daily sweep.
- **Seed data:** 10,510 earlier Context.dev captures (13–14 Nov 2026), mostly everyday groceries plus S Group campaign pages. They give the first price history.
- **Wolt Market (Helsinki):** sweets pages of 4 Wolt Market venues (Kamppi, Hertsi, Kunkku, Vallila), 272 prices for 152 products. No EANs on Wolt, so they are compared per kg within product groups only.
- **Area:** views use **Helsinki stores only**: 151 stores with sweets prices (101 K-Group incl. all 4 K-Citymarkets, 46 S Group incl. all 6 Prismas and Food Market Herkku, 4 Wolt Market). Lidl is excluded (no store prices online); Espoo stores stay in the database but are not shown. See DATA_QUALITY.md §0c for coverage against every grocery shop in Helsinki (OpenStreetMap) and why the rest are missing.
- **Dashboard panel:** Prisma Kannelmäki, S-market Arabia, Alepa Kamppi, K-Citymarket Ruoholahti, K-Supermarket Kamppi, K-Market Alppila and Wolt Market Kamppi. The all-store views (store price index, K vs S gap, store outliers) use every Helsinki store.
- **Limits:** K-Ruoka shows at most 100 products per category page; 9 S Group stores failed on every page; K pages that fell back to the default store are rejected.
- **History:** 4 real price changes so far (Marabou tablets at S-market Arabia, €3.25 → €3.49). With under a day of history, no trend claims.

Re-fetch and import:

```bash
npm run data:fetch
npm run data:fetch -- --repair
npm run data:import-categories -- confectionery-2026-11-14
npx tsx --env-file=.env.local scripts/fetch-wolt.ts
npm run data:import-categories -- wolt-2026-11-14
```

## Company account view (My Products)

`/account` starts from the selected company's own products instead of competitors, and covers every
category and every captured store (see FAZER_VALUE_PLAN.md). It shows which stores each product was seen
in, the shelf price per store with the spread, the promotions on those products, and competitor
promotions in the same comparison groups. `?p=<EAN>` opens one product with its full store list.
A store without a capture is shown as "not captured", never as "not stocked". Data: `src/lib/account.ts`.

## Favourites and My area

Products, categories and subcategories can be starred (My Products, or the My area page). `/area` then shows
only the followed area: its key numbers, promotions ending soon and competitor offers in the same
subcategories; My Products has a "My area only" switch, and the chat understands "my area". Categories are a
two-level view over the product groups (`src/lib/favourites.ts`). There are no user accounts yet, so
favourites are saved per installation in the `favourites` table.

## Ask delta. (chat over your own data)

`/ask` answers plain-language questions about the account's data in English or Finnish. Gemini never sees
the dataset up front: it calls lookup tools in `src/lib/ask.ts` (product search, per-store prices,
own and competitor promotions, price spreads, chain comparison, listing coverage) and answers only from
their results, with links to the screens that show the same numbers. It follows the honesty rules below
and declines questions the data cannot answer (sales volumes, margins, trends). Needs `GEMINI_API_KEY`
(and optionally `GEMINI_MODEL`) in `.env.local`; without a key the page says the assistant is not configured.

## Honesty rules built into the code

| Rule | Where |
|---|---|
| Promotions only when the retailer page advertised them (campaign / multi-buy / loyalty) | `normalize.ts` `promotionOf` |
| Discount % only with a stated regular or 30-day reference price | `normalize.ts` `referencePrice` |
| A lower price than last time is an *observed price change*, never a discount | `alerts.ts` |
| Unit prices only from a single known pack size; ranges and conflicts are excluded and flagged | `normalize.ts` |
| Comparisons only inside named comparison groups, always with sample sizes | `analytics.ts` `positioning` |
| "No longer shown online" never means "off the shelf" | `importer.ts` `rebuildListings`, alert text |
| A page change only becomes an alert if re-extracted prices or offers changed | `monitors.ts` `processEvent` |
| Replays are labelled everywhere and keep their original capture time | `alerts.ts` `replay` |
| Intelligence brief sentences are emitted only when computed facts support them | `summary.ts` |

## Context.dev in the workflow

1. **Watch.** Page monitors on real product pages from the dataset (Fazer Klassikot at Alepa Westend, Marabou Mjölkchoklad at Prisma, Karl Fazer at Lidl), with semantic instructions to ignore layout and banners. You create them from *Competitor Monitor*; each costs about 1 credit per scheduled run.
2. **Receive.** Private polling of `monitors.listAccountChanges` (default, no public URL), or signed webhooks (`MONITOR_MODE=webhook` + tunnel). Signatures are checked with HMAC-SHA256 over the raw body with a 5-minute tolerance, and events are deduplicated on their event id.
3. **Verify.** A fresh `web.scrape` (`maxAgeMs: 0`). S-kaupat prices are parsed from the page's embedded store-level pricing state; other pages use Context.dev JSON extraction.
4. **Compare.** The new observation is stored next to the history and diffed with the previous one for the same product and store.
5. **Alert.** Price up or down, promotion started or ended, offer no longer shown, and relative-position changes. Alerts are prioritised by magnitude, category relevance and store. The dashboard updates over server-sent events.

## Demo script

1. **Brand intelligence.** Open Overview as Fazer and read the KPIs, the brief and the positioning:
   - Boxed chocolates: Fazer is 33% below the competitor median (Panda, Lindt, Terry's) per kg
   - Tablets: Fazer is just below Marabou
   - Switch to Cloetta in the sidebar to see BonBon's advent calendar against Kinder, Lindt and Haribo.
2. **Competitor pricing.** On Price Intelligence:
   - The same EAN costs €4.99 at Alepa vs €5.99 in the K-Supermarket flyer, a 20% retailer gap.
   - Marabou Schweizernöt is €2.00 at Alepa Westend vs €3.25 in 31 other S Group stores.
   - The tablet chart compares per kg.
3. **Live monitoring.** On Competitor Monitor, create the recommended monitors and click *Run now*.
   - Marabou's "5 for €10" and Lidl's Karl Fazer "4 for €10" are both stated to end on 15.11, so a real "Promotion ended" alert is due.
   - Fallback: *Replay* the two recorded Prisma campaign-page captures. They give 11 real changes, all outside confectionery. The feed shows them dimmed and low priority, which is the noise filter at work.
4. **Intelligent alert.** Each alert shows what changed, where, which competitor, why it matters (the comparison-group median and the gap), and the source link.
5. **Business value.** Delta replaces manual checking of retailer sites and shows competitor offers as they start and end. It gives commercial teams positioning facts with sample sizes. It describes the market; it does not recommend coordinating prices with competitors or dictating retailers' resale prices.

## Business model (hypotheses, not validated; prices are not disclosed)

- **Starter**: limited product monitoring, competitor comparisons, daily updates.
- **Business**: adds retailer coverage, promotion alerts, price history, automated reports and category intelligence.

## Architecture

Next.js 15 App Router, TypeScript, Tailwind 4 (Linear-style theme), Recharts, `context.dev` SDK.
SQLite via `node:sqlite` with tables that map 1:1 to Postgres:
`brands`, `stores`, `products`, `listings`, `observations`, `promotions`, `monitors`, `monitor_events`, `alerts`.

```
src/lib/taxonomy.ts    comparison groups, brand rules, brand owners, demo scope
src/lib/normalize.ts   pack sizes, unit prices, promotion and reference-price rules, quality flags
src/lib/importer.ts    idempotent import with provenance; listings and offer-page disappearance
src/lib/analytics.ts   latest rows, positioning, history, cross-retailer and store spreads, coverage
src/lib/alerts.ts      diff → alerts, position shifts, labelled replay
src/lib/monitors.ts    Context.dev monitors, webhook verification, fresh re-extraction, polling
src/lib/summary.ts     rule-based intelligence brief
```

Not in scope for the MVP: billing, auth, nationwide coverage, wholesale prices, margins, volumes or market share.
The intelligence brief is rule-generated. An LLM rewrite of its wording is an optional next step; the numbers would stay deterministic.
