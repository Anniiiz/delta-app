# Delta for one company: the Fazer account view

A plan for what the platform should show a single FMCG company. Fazer is the showcase because it has the
widest footprint in the data we already hold: 13 distinct EANs (22 retailer listings) seen in 168 of 181
store scopes, across all 7 banners, with 18 live promotions. Every figure below is from
`data/shelfintel.db` (captures of 13–14 Nov 2026).

## The shift

Today Delta is competitor-centric and limited to confectionery. The account view is company-centric:
it starts from *my products* and answers four questions in order.

| # | Question the company asks | Screen | Who uses it |
|---|---|---|---|
| 1 | Where are my products sold? | Store presence | Key account managers, field sales |
| 2 | What do they cost there? | Shelf price by store | Revenue / pricing managers |
| 3 | What discounts are running on them? | Promotion tracker | Key account managers, trade marketing |
| 4 | What are competitors doing next to me? | Competitor promotions | Category managers |

A fifth layer (alerts and a weekly brief) turns the four screens into something that arrives without logging in.

## 1. Store presence: which stores carry each product

**Shows:** a product × store grid, grouped by retailer and banner, plus a map. Each cell is "seen with a
price", "seen on promotion" or "not captured". Per product: stores seen, banners seen, first and last seen.

**What the data says for Fazer now**

| Product | Stores seen | Banners |
|---|---|---|
| Aito protein oat drink choco 2.5 dl | 88 | K-Citymarket, K-Supermarket, K-Market |
| Aito oat drink Barista 250 ml | 75 | K-Citymarket, K-Supermarket, K-Market |
| Aito protein oat drink strawberry-white choco | 46 | K-Citymarket, K-Supermarket, K-Market |
| Leipurimestarin kaurapellavaleipä 500 g | 35 | Prisma, S-market, Alepa |
| Aito Kauraruoka cheese flavour 2.5 dl | 30 | Prisma, S-market, Alepa |
| Klassikot chocolate box 260 g | 14 + K-Supermarket flyer | Alepa, K-Supermarket |

**Value:** the strawberry protein drink is seen in 46 Kesko stores and the choco one in 88. That 42-store
difference is a ready-made list for a sales rep, if it is a real listing gap.

**Limit to fix first:** today a blank cell means "we did not capture that page", not "not stocked".
Presence becomes trustworthy only when every Fazer product page is captured for every store (see Build
order, step 2). Until then the grid must say "not captured", never "missing".

## 2. Shelf price by store

**Shows:** for each product, the price in every store, the most common price per banner, and the spread.
Outlier stores are listed, with the source link.

**What the data says for Fazer now**

- Aito Barista 250 ml costs €1.25 to €1.69 across 75 Kesko stores, a 35% spread. K-Supermarket is mostly
  €1.35 (15 stores); K-Market is mostly €1.59 (24 stores).
- Aito protein drink choco: €1.94 to €2.25; 33 K-Markets at €2.09, 13 at €2.15.
- Aito Kauraruoka cheese flavour: €1.29 at Prisma, €1.39 in 19 S-markets, €1.45 in 10 Alepas.
- Klassikot 260 g (same EAN): €4.99 at Alepa vs €5.99 in the K-Supermarket flyer.

**Value:** Fazer sees where its recommended price positioning holds and where a product sits 20–35% above
the cheapest store. This is information for negotiations and pack-price architecture. Retailers set
their own shelf prices, so the screen describes and never suggests enforcing a price.

## 3. Promotion tracker: what discounts are on my products

**Shows:** every active promotion on a Fazer product: retailer, banner, mechanic (campaign, multi-buy,
loyalty price), offer price, stated reference price, discount %, number of stores, end date. A calendar
strip shows what ends this week.

**What the data says for Fazer now (18 promotions)**

| Product | Where | Offer | Discount | Stores | Ends |
|---|---|---|---|---|---|
| Kaurapellavaleipä 500 g | Alepa, S-market, Prisma | €2.99 (was €4.59) | 35% | 35 | 15.11. |
| Karl Fazer tablet | Lidl | 4 for €10 (€3.85 each) | 35% | chain | 15.11. |
| Klassikot 260 g | Alepa | €4.99 (was €6.45) | 23% | 14 | 17.11. |
| Vadelmajogurtti cake 400 g | Alepa | €6.99 (was €8.95) | 22% | 14 | 17.11. |
| Domino Crunchy 150 g | K-Market | 2 for €5 (€3.25 each) | 23% | chain | 29.11. |
| Aito Kauraruoka | Lidl | 3 for €3 (€1.29 each) | 22% | chain | 15.11. |
| Puikula 6 pcs | K-Market | Plussa €1.29 (was €1.49) | 13% | chain | 29.11. |
| Klassikot 260 g, Juhlaklassikot 380 g, Remix | K-Supermarket | €5.99 / €9.99 / €4.99 | not stated | chain | 26.12. |

**Value**

- **Campaign execution check:** was the agreed campaign published, at the agreed price, in the agreed
  stores, for the agreed dates? Today that is checked by hand, per retailer site.
- **Promo pressure:** share of Fazer listings on promotion and average depth, per retailer. This shows
  which retailer discounts the brand most.
- **End dates:** four Fazer promotions end on 15.11. The follow-up question (did the price return to
  regular?) is one monitor run away.

## 4. Competitor promotions next to mine

**Shows:** for each comparison group Fazer plays in, competitor promotions side by side with Fazer's,
with the same columns as the promotion tracker.

**What the data says now**

- **Tablets:** Marabou runs "5 for €10" (33–39% off) on 12 flavours in 31 S Group stores until 15.11.
  Karl Fazer tablets appear only in Lidl's "4 for €10". We hold no Karl Fazer tablet price at S Group or
  Kesko, which is itself a capture gap to close.
- **Boxed chocolates:** in the K-Supermarket Christmas flyer (until 26.12.) Fazer Klassikot is €5.99
  next to Panda Juhlapöydän 300 g at €4.99, Terry's at €4.99 and Lindor 137 g at €5.99.
- **Sweets:** Malaco Aakkoset "2 for €4.50" (19% off) vs Fazer Remix at €4.99 in the same flyer.

**Value:** Fazer sees share of promotional space per retailer and reacts in the next promo-planning
round. It replaces flyer-reading by hand.

## 5. Alerts and weekly brief

- Alerts already exist in the code: promotion started or ended, price up or down, offer no longer shown.
  Scope them to "my products" and "my comparison groups".
- New alert types for the account view: product newly seen in a store, product no longer seen in a store
  where it was captured before, promotion live in fewer stores than last capture.
- Weekly brief per retailer account, rule-generated: stores seen, price spread, promotions started and
  ended, competitor promotions in the same groups.

## What we cannot show (and should say so)

- Sales volumes, market share, margins, wholesale prices, physical shelf position, in-store stock.
- Trends: we have two days of captures. Price history starts when monitoring starts.
- Vantaa and the rest of Finland: only Helsinki and Espoo stores are in the data.
- "Not stocked" claims, until full per-store capture is running.

## Build order

1. **Account view on existing data** (no new credits). Lift the confectionery-only scope for the
   selected company; add Store presence, Shelf price by store and Promotion tracker pages driven by
   `listings`, `observations` and `promotions`. Link same-EAN products across retailers.
2. **Full Fazer capture.** Fetch every Fazer product page for every store through Context.dev, so blank
   cells become real gaps. Rough size: 13 EANs × about 178 stores is about 2,300 pages per sweep. Add
   the missing Karl Fazer tablets at S Group and Kesko.
3. **Daily monitoring.** Schedule the sweep; after a week the app can show price history and
   "promotion ended, price returned to €X".
4. **Competitor set per company.** Let the company confirm its comparison groups and rival products
   (oat drinks: Oddlygood, Oatly, Pirkka are already in the data).
5. **Weekly brief and export** (PDF or CSV per retailer account).

## How this earns money (hypotheses)

| Buyer pain | What they do today | Delta answer | Tier |
|---|---|---|---|
| "Is my campaign live as agreed?" | Staff click through retailer sites | Promotion tracker with store counts and end dates | Starter |
| "Where am I not listed?" | Field reps visit stores | Store presence grid and gap list | Business |
| "Why is my product €1.69 here and €1.25 there?" | Not visible at all | Shelf price by store | Business |
| "What did Marabou just launch?" | Flyer reading | Competitor promotions and alerts | Business |

The first pilot pitch is a single page: the Fazer promotion tracker and the Barista price spread, both
built from real captures.
