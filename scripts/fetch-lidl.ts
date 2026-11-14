/** Lidl's sweets page lazy-loads tiles: capture it once with scrolling and add it to the fetch run. */
import fs from "node:fs";
import path from "node:path";
import ContextDev from "context.dev";

const RUN = process.env.FETCH_RUN ?? "confectionery-2026-11-14";
const URL = "https://www.lidl.fi/h/makeiset-ja-snacksit/h10096205";

async function main() {
  const c = new ContextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY!, timeout: 240_000 });
  const actions = [
    { type: "scroll", direction: "down", amount: "max" },
    { type: "wait", milliseconds: 2000 },
    { type: "scroll", direction: "down", amount: "max" },
    { type: "wait", milliseconds: 2000 },
    { type: "scroll", direction: "down", amount: "max" },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await c.web.scrape({ url: URL, formats: { markdown: true }, sharedParams: { country: "FI", waitFor: 3000, actions, dismissCookies: true }, tags: ["shelfintel", "confectionery", "lidl"] } as never, { timeout: 240_000, maxRetries: 0 });
  const md = r.markdown?.data ?? null;
  const row = { itemId: "l|chain:lidl|makeiset-ja-snacksit|1", url: URL, site: "lidl", storeId: "chain:lidl", category: "makeiset-ja-snacksit", page: 1, status: md ? "ok" : "error", markdown: md, requestId: r.request_id ?? null, error: null, capturedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(process.cwd(), "data", "raw", RUN, "pages-lidl-scrolled.jsonl"), JSON.stringify(row) + "\n");
  console.log(`Lidl: ${md?.length ?? 0} chars, ${(md?.match(/ kohteelle /g) ?? []).length} tiles, credits ${r.key_metadata?.credits_consumed}`);
}
main();
