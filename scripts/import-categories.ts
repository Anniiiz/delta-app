/**
 * Imports a category fetch run into data/shelfintel.db.
 *   npm run data:import-categories -- confectionery-2026-11-14
 */
import { importCategoryRun } from "../src/lib/import-categories";

const run = process.argv[2] ?? "confectionery-2026-11-14";
console.log(JSON.stringify(importCategoryRun(run), null, 1));
