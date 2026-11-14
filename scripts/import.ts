/**
 * (Re)imports scraped data into Delta's normalised database.
 *
 *   npm run data:import                  # data/source/seed-export.json
 *   npm run data:import -- <export.json> # another export
 *
 * Safe to re-run: observations are keyed by their source row, so history is appended, never overwritten.
 */
import path from "node:path";
import { importExport, DEFAULT_EXPORT } from "../src/lib/importer";

const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_EXPORT;
const s = importExport(file);
console.log(`Imported from ${s.source} (exported ${s.exportedAt})`);
console.log(`  products:      ${s.products} (${s.productsSkipped.length} skipped)`);
console.log(`  store scopes:  ${s.stores}`);
console.log(`  observations:  ${s.observationsAdded} new of ${s.observationsInFile} in file (${s.observationsSkipped.length} skipped)`);
console.log(`  promotions:    ${s.promotions} verified retailer-advertised offers`);
console.log(`  monitor events:${s.monitorEvents} (seed history)`);
const reasons = new Map<string, number>();
for (const x of [...s.productsSkipped, ...s.observationsSkipped]) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
for (const [r, n] of reasons) console.log(`  skipped: ${n} × ${r}`);
