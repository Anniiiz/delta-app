/**
 * Which S Group stores publish their own online prices? S-kaupat falls back to a chain-wide price for
 * stores that don't sell online. For each candidate store, one product page is read with ?storeId= and
 * the embedded pricing state says whether the price is the store's own (same test the seed captures used).
 *
 *   npx tsx --env-file=.env.local scripts/s-price-check.ts data/raw/stores/s-candidates.json
 * Writes <input>.checked.json with { ...store, ownPrices: boolean, reason }.
 */
import fs from "node:fs";
import ContextDev from "context.dev";
import { parseSkaupatProductHtml } from "../src/lib/parsers/skaupat";

const PRODUCT = "https://www.s-kaupat.fi/tuote/marabou-mjolkchoklad-suklaalevy-160g/7622202238475";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const file = process.argv[2];
  const stores = JSON.parse(fs.readFileSync(file, "utf8")) as { storeId: string; name: string }[];
  const c = new ContextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY!, timeout: 120_000 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub: any = await c.batch.submit(
    { input: { mode: "scrape", data: { urls: stores.map((s) => ({ url: `${PRODUCT}?storeId=${s.storeId}`, itemId: s.storeId })), formats: { html: true }, sharedParams: { country: "FI", waitFor: 2000 } } }, tags: ["shelfintel", "s-price-check"] } as never,
    { timeout: 120_000 },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let st: any;
  for (;;) {
    await sleep(10_000);
    st = await c.batch.retrieve(sub.id);
    if (["completed", "failed", "cancelled"].includes(st.status)) break;
  }
  const res = new Map<string, string | null>();
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await c.batch.getResults(sub.id, { cursor, limit: 100 });
    for (const x of r.data ?? []) res.set(x.itemId, x.status === "ok" && x.result?.html?.success ? x.result.html.data : null);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  const out = stores.map((s) => {
    const html = res.get(s.storeId);
    if (!html) return { ...s, ownPrices: false, reason: "page failed" };
    const p = parseSkaupatProductHtml(html, PRODUCT);
    if (!p) return { ...s, ownPrices: false, reason: "no product data" };
    if (p.isGlobalFallback) return { ...s, ownPrices: false, reason: "chain-wide fallback price" };
    if (p.storeId && p.storeId !== s.storeId) return { ...s, ownPrices: false, reason: `page priced store ${p.storeId}` };
    return { ...s, ownPrices: true, reason: `store price €${p.currentPrice.toFixed(2)}` };
  });
  fs.writeFileSync(file.replace(/\.json$/, ".checked.json"), JSON.stringify(out, null, 1));
  console.log(`${out.filter((x) => x.ownPrices).length}/${out.length} stores have their own online prices · ${st.credits?.net ?? "?"} credits`);
  for (const x of out) console.log(`${x.ownPrices ? "✓" : "✗"} ${x.name} (${x.storeId}): ${x.reason}`);
}
main();
