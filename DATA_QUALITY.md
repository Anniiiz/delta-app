# Delta data-quality report

Generated 2026-11-14 19:51 UTC by `npm run data:report`. Every figure below is computed from the imported data.

## 0. Category fetch (14.11.2026)

Chocolate & candy category pages were fetched through Context.dev batch scraping for every store with its own online prices: K-Ruoka (7 categories per store), S-kaupat (6 categories, all pages) and Lidl (national range). Raw markdown is kept in `data/raw/helsinki-additions-2026-11-14/`.

| Measure | Value |
|---|---|
| Pages captured | 275 |
| Pages with products imported | 228 |
| Skipped: fetch failed | 37 |
| Skipped: no products on page | 10 |
| Stores with category prices | 192 |
| …K-Group / S Group / Lidl | Kesko 136 · Lidl 1 · S Group 65 · Wolt 4 |
| Store × product prices | 77707 |
| Products found | 2247 |
| Retailer-advertised offers | 6063 |
| Context.dev credits (batches) | 277 |

Known limits: K-Ruoka shows at most 100 products per category page (chocolate tablets, bars and candy bags reach that cap, so each K store contributes its first 100 there). Nine S Group stores failed on every page and are missing. K-Ruoka falls back to K-Citymarket Iso Omena for store ids it doesn't know; those pages are rejected. Lidl publishes one national range online, not per-store prices.

## 0b. Wolt Market and coverage area

Wolt Market sweets pages were captured for the Helsinki venues listed in wolt.com's public venue sitemap (robots.txt allows all paths): 4 venues, 272 prices, 152 products. Wolt shows no EANs, so Wolt products are compared per kg inside their product group but not matched one-to-one with K and S products. Pages load tiles lazily; about 50–85 products per venue were captured. Wolt Market Deli Kamppi has no sweets category.

**Views are limited to Helsinki stores with their own online prices; Lidl (no store prices online) and stores outside Helsinki stay in the database but are excluded.** Helsinki stores in the views: Kesko 101 · S Group 46 · Wolt 4.

## 0c. Helsinki grocery store coverage

Grocery shops in Helsinki per OpenStreetMap (shop = supermarket, convenience, grocery, wholesale, deli, food), matched by location to stores with chocolate & candy prices in ShelfIntel. Wolt Market's 4 dark stores are not in OpenStreetMap and come on top.

| Chain | Shops in Helsinki (OSM) | With sweets prices | Why not all |
|---|---|---|---|
| Independent & other | 134 | 0 | Ethnic shops, delis and wholesalers: no online prices (some are on Wolt) |
| K-Market | 82 | 75 | 5 K-Markets in OpenStreetMap have no K-Ruoka store page; K-Market Hakaniemi publishes no sweets online |
| Alepa | 71 | 29 | Most Alepas show only S Group's chain-wide prices online (checked per store); 3 Alepas' listing pages always fail |
| S-market | 31 | 10 | Most S-markets show only chain-wide prices online; 3 S-markets' listing pages always fail |
| Lidl | 27 | 0 | Excluded: no store prices online |
| K-Supermarket | 23 | 23 |  |
| Prisma | 6 | 6 |  |
| K-Citymarket | 4 | 4 |  |
| Food Market Herkku | 1 | 1 |  |

## 1. Files found

| File | Format | Contents |
|---|---|---|
| ../seed/seed.db | SQLite (node:sqlite) | Earlier store of Context.dev captures: stores, products, price_snapshots, monitors, monitor_events |
| data/source/seed-export.json | JSON export of the above | 593 products, 297 stores, 10513 price snapshots, 5 monitor events (exported 2026-11-14T15:54) |
| data/raw/confectionery-2026-11-14/pages-*.jsonl | JSONL, one captured page per line | Context.dev markdown of K-Ruoka, S-kaupat and Lidl chocolate & candy category pages, with URL, store, request id and capture time |
| ../parkpredict/data/* | JSON/CSV | Parking data for a different project; not used |

Every price observation was captured through Context.dev (`source_kind = context.dev`, with a request id).

## 2. Source schema (price_snapshots)

`id`, `product_id`, `store_scope`, `price`, `regular_price`, `lowest_30d`, `unit_price`, `unit_price_unit`, `promo_kind`, `promo_label`, `promo_valid_from`, `promo_valid_to`, `loyalty`, `multibuy_qty`, `multibuy_price`, `source_url`, `source_kind`, `request_id`, `captured_at`, `is_sample`, `base_known`

| Column | Empty in rows |
|---|---|
| regular_price | 5794 |
| lowest_30d | 6232 |
| unit_price | 8537 |
| unit_price_unit | 8550 |
| promo_kind | 2381 |
| promo_label | 2381 |
| promo_valid_from | 10458 |
| promo_valid_to | 2405 |
| loyalty | 10445 |
| multibuy_qty | 6748 |
| multibuy_price | 2381 |

## 3. Stores represented

| Retailer | Banner | Level | Store scopes | Observations |
|---|---|---|---|---|
| S Group | Alepa | store-level | 48 | 29883 |
| Kesko | K-Market | store-level | 93 | 24408 |
| Kesko | K-Supermarket | store-level | 39 | 16568 |
| S Group | S-market | store-level | 19 | 9392 |
| S Group | Prisma | store-level | 6 | 4160 |
| Kesko | K-Citymarket | store-level | 5 | 2685 |
| S Group | Food Market Herkku | store-level | 1 | 700 |
| Wolt | Wolt Market | store-level | 4 | 272 |
| Lidl | Lidl | chain-wide offers | 1 | 68 |
| Kesko | K-Supermarket | chain-wide offers | 1 | 50 |
| Kesko | K-Market | chain-wide offers | 1 | 31 |

Cities: Helsinki 157, Espoo 57, (chain-wide) 4. No Vantaa stores are in the dataset.

## 4. Categories and brands

The seed captures cover a grocery basket (milk, coffee, pasta, chicken…) plus whole campaign/offer pages, so most products are everyday groceries. 2234 products match the chocolate & confectionery rules:

| Comparison group | Products | Brands |
|---|---|---|
| Advent calendars | 99 | Lindt, Haribo, Kinder, BonBon, Nestlé, Fazer, ?, After Eight, Muumi, Marabou, Toblerone, Bip, Halva, KitKat, Brain, Chocoland, Chupa Chups, Dolci, Windel, Foodin, Ferrero, Nomo, Baileys, Zozole, Ritter Sport, Elit, Hulten, Baci, Niederegger, Goodio, Anthon Berg, Dammenberg, Vegaaninen, Adventtikalenteri, Favorina, Hultén, Smarties, Mauri |
| Chocolate tablets | 341 | Fazer, Marabou, Panda, Pirkka, Brunberg, Lindt, Donoka's, Nidar, Sun, KitKat, Ferrero, Tony's, Valkosuklaa, Mr, Nick's, Goodio, Ritter Sport, Benjamissimo, Dammenberg, Gluteeniton, Puhdistamo, Muumi, Elit, Simon, Coop, Xtra, Smash!, Bett'r, Nomo, MrBeast, ?, Balance, Toblerone, Sini, Findus, Hau-Hau, Kaskein, Raikastamo, Snellman, Saarioinen, Valio, LifeHair, Rosten, Arla, Juustoportti, After Eight, Le, Valrhona |
| Chocolate bars | 346 | Tupla, Marabou, Daim, Fazer, Kinder, Coop, ?, Cloetta, Twix, Pirkka, Snickers, Pätkis, Mars, Da, Fami, Suffeli, Smash, Jim, KitKat, Lindt, Lion, Stratos, Nidar, Bounty, Royal, Nestle, Dove, Center, Toblerone, Baileys, Nestlé, Toms, Kismet, Nomo, Schär, Foodin, Witor's, Tony's, Elit, Ferrero, Brunberg, Milky Way, Nick's, Nutella, Dammenberg, Hanuta, Suklaatikut, Moofree, Amatller, Suklaasydämet, Marsipaani, Smash!, Panda, Smarties, Reese's, Heaply, Muumi, PawPatrol, Puhdistamo, Fredman, Herbamare®, Purina, Best-In, Finax, Birkkalan, Salakis, Pakkasmarja, Sun'n, Läkerol, Kotimaista, Jyväbroiler, Arla, Herkkutilan, Lohilo, Tabby, Le, Pablo, Agatha, Hershey's, Marcos |
| Boxed chocolates & pralines | 378 | Panda, Fazer, Lindt, Terry's, Ferrero, After Eight, Budapest, Baileys, Rocher, Raffaello, Wienernougat, Toffifee, Marabou, Jacquot, Milka, Brunberg, Anthon Berg, ?, Pirkka, Mirabell, Mieszko, Cemoi, Böhme, Guylian, Witor's, Jakobsen, Elit, Niederegger, Trapa, Vergani, Halloren, Oreo, Nestlé, Baci, Guinness, Sorini, Vandenbulcke, Hamlet, Helsinki, Storck, Cosmo, Kanelimamma, Dammenberg, Merci, Pukin, Goodio, Millennium, Geisha, Fancy, Quality Street, Aito, Millenium, Vanhankaupungin, Le |
| Chocolate-coated fruit | 6 | Trü Frü, Fruit Dips, Dave & Jon's |
| Sweets & liquorice | 873 | Malaco, Fazer, ?, Lindt, Finlandia, Haribo, Panda, Semu, Chupa Chups, Coop, BonBon, Fini, Kipparin, Kick, Maoam, Vidal, Hopeatoffee, Halva, Witor's, KitKat, BUBS, Tyrkisk Peber, Pirkka, Nidar, Marianne, Brynild, Omar, Skittles, Pihlaja, K-Menu, Tsinuskitoffee, Brunberg, Riesen, Mamba, Sahlman, Walkers, Puspuslaku, CandyKing, Dragster, Peacemärke, Sisu, Pändy, S-Märke, Tweek, Leijona, Cloetta, Marabou, Konfekta, Petit, Cosmo, Tupla, Makulaku, M&M's, Nellie, Skummis, Rois, Werther's, K-Market, Nick's, Goldbears, Maltesers, Porvoon, Kouvolan, Tuby, Gourmet, Bazooka, Daim, Juicy, Look-O-Look, Mieszko, Festivaldi, Pohjanmaan, Rimbies, Savitor, Sura, Evers, Ahlgrens, Kuumat, Dracula, Skipper's, Lakumesta, Dammenberg, Nestlé, Twix, Xtra, Smash!, Carletti, Prix, Elovena, Kotimaista, Keiju, Tofumoon, Atria, Arla, Valio, Snellman, Lohilo, Estrella, Rainbow, Juustoportti, Ben, Muumi, Miamor, Jyväbroiler, Fresh, Trolli, Treets, Brain, Pez, Casali, Kinder, Land, Prescott, Bip, Hultén, Töysäläinen, Oululainen, Danone, Mjau, Gårdschips, PrimaCat, God, Risifrutti, Läkerol, Emmi, Hau-Hau, Jenkki, Hannan, PataPata, Bong, Kuchenmeister, Maitokolmio, Pågen, Brit, Jalotofu, Lipsi, Meira, Taffel, Perniön, Saarioinen, Starbucks, Coca-Cola, Dovgan, Bridor, Tropicana, Forsman, Schlagfix, Premium, Leroy, Bavaria, Green, Noel, Segafredo, Coppola, Myllärin, Trube, Danvita, Don, Poppies, Mini, Lakrisal, Ifa, Funny, Halloween, Heaply, Favoritmix, C&b, Cartwright, Reese's |
| Sweet biscuits | 4 | Fazer, ?, Gullòn |
| Seasonal & gift | 187 | Brunberg, Fazer, Kinder, After Eight, ?, Toffifee, Guylian, Moomin, Marabou, Lindt, Zuru, Niederegger, Halva, Sorini, Mrs, Lemaître, Terry's, Anthon Berg, Baileys, Millennium, Balance, Riegelein, Ferrero, Goodio, Dammenberg, Wawi, Kultamuna, Risella, Valio, Snellman, Atria, Hultén, Tintin, Bong, Sysmän, Santa, Bonduelle, Jalostaja, Nocco, Golden, E., Vallila, Mummon, Nordqvist, Rosten, Pellini, Nick's, Allerum, Juustoportti, Brooklyn, Annas, Sheba, Havi, Dr., Marli, Sini, Arla, Kantolan, Panda, Zozole, Belfine, M&M's, Pernigotti, Apetit, Urtekram, Billys, Bonne, Airam, Mec, Impolan, Bolsius, Naturli', Sebahat, Lewandowski, Crest, Trolli, Funny, Fini, Zaini, Mercedes, Elit, Mirabell, Vergani, Baci |

Retailer-supplied brand field: empty for 495 of 593 products, so brands are derived from product-name prefixes (rules in `src/lib/taxonomy.ts`). Brand owners are curated reference data.

## 5. Valid listings, duplicates, inconsistencies

| Check | Result |
|---|---|
| Price snapshots imported | 88217 |
| Skipped (demo page, not a retailer) | -77704 |
| Missing or non-positive prices | 0 |
| Exact duplicates (same product, store, time, price) | 0 |
| Same EAN under two retailer product ids | 551 |
| …of which names differ | 305 |
| Confectionery listings in the demo scope (latest per product × store) | 3121 |

Name differences for the same EAN are word order, spacing or extra marks (`260g` vs `260 g`, `Arki®`, `RAC`), never a different product. Products are kept per retailer and linked by EAN for cross-retailer comparisons.

## 6. Package sizes and unit prices (confectionery)

| Issue | Products | Handling |
|---|---|---|
| Pack size is a range (280–340 g) | 3 | Kept in tables, excluded from unit-price comparisons |
| Pack size only in the product URL | 1 | Used, flagged |
| No pack size | 44 | No unit price |
| Lidl multi-buy: bundle total stored as 30-day low (4 × €3.85 = €15.40) | 1 | Converted to a per-pack regular price |
| Promotion without a stated reference price | 15 | No discount % shown |

## 7. History

Captures in the dashboard panel run from 2026-11-13T22:50:24.488Z to 2026-11-14T19:37:21.407Z (16 distinct capture times). 37 confectionery listings were captured more than once. Observed price changes: 4 (Marabou Schweizernöt suklaalevy 160g at S-market Arabia: €3.25 → €3.49; Marabou Salta Mandlar suklaalevy 160g at S-market Arabia: €3.25 → €3.49; Marabou Apelsinkrokant Suklaalevy 160g at S-market Arabia: €3.25 → €3.49; Marabou Japp suklaalevy 160g at S-market Arabia: €3.25 → €3.49). With under a day of history the app makes no trend claims.

Across all categories, 101 product × store pairs show different prices between captures (none in confectionery). Offer pages captured twice and available as labelled replays: K-Citymarket Espoo Iso Omena, Prisma Kaari Kannelmäki.

## 8. URLs that can be monitored with Context.dev

| Page | Type | Why |
|---|---|---|
| https://www.s-kaupat.fi/tuote/fazer-klassikot-suklaakonvehtirasia-260g/6416453026353 | S-kaupat product page (store via ?storeId) | Fazer's own box; price parsed from the embedded store-level pricing state |
| https://www.s-kaupat.fi/tuote/marabou-mjolkchoklad-suklaalevy-160g/7622202238475 | S-kaupat product page | Main competitor tablet; multi-buy stated to end 15.11. |
| https://www.lidl.fi/p/karl-fazer-suklaalevy/p11703918 | Lidl product page | Fazer in Lidl's weekly offers; read with Context.dev JSON extraction |
| https://www.s-kaupat.fi/tuotteet/kampanjat?storeId=… | S Group campaign page per store | Whole-page promotion changes (the source of most S Group seed rows) |
| https://www.k-ruoka.fi/k-supermarket/tarjouslehti | K-Supermarket offer flyer | Chain-wide confectionery offers (Fazer, Panda, Lindt, Malaco, calendars) |

Demo scope: sok-prisma-kannelmaki, smarket-arabia, alepa-kamppi, kesko-kcm-ruoholahti, ksupermarket-kamppi, kmarket-alppila, wolt-market-kamppi.
