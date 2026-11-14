/**
 * Fetches the chocolate & sweets category pages of every Wolt Market venue in Helsinki through
 * Context.dev and stores the raw markdown (same format as fetch-confectionery.ts). wolt.com's robots.txt
 * allows all paths; venues come from wolt.com's public venue sitemap.
 *
 *   npx tsx --env-file=.env.local scripts/fetch-wolt.ts
 *
 * Each venue page is read first to find that venue's sweets category ids, then every sweets
 * (sub)category page is captured with scrolling so lazy-loaded tiles are included.
 */
import fs from "node:fs";
import path from "node:path";
import ContextDev from "context.dev";

const RUN = process.env.FETCH_RUN ?? "wolt-2026-11-14";
const DIR = path.join(process.cwd(), "data", "raw", RUN);
export const WOLT_VENUES = ["wolt-market-kamppi", "wolt-market-deli-kamppi", "wolt-market-hertsi", "wolt-market-kunkku", "wolt-market-vallila"];
const SWEETS = /\/items\/(suklaat-makeiset|suklaalevyt|suklaapatukat|karkkipussit[^)/]*|patukat-tikkarit|kausimakeiset)-\d+\)/g;

async function scrape(c: ContextDev, url: string, scroll: boolean) {
  const actions = scroll
    ? [
        { type: "scroll", direction: "down", amount: "max" },
        { type: "wait", milliseconds: 1500 },
        { type: "scroll", direction: "down", amount: "max" },
        { type: "wait", milliseconds: 1500 },
        { type: "scroll", direction: "down", amount: "max" },
      ]
    : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await c.web.scrape(
    { url, formats: { markdown: true }, sharedParams: { country: "FI", waitFor: 5000, ...(actions ? { actions } : {}) }, tags: ["shelfintel", "wolt"] } as never,
    { timeout: 240_000, maxRetries: 1 },
  );
  return { markdown: (r.markdown?.data as string) ?? null, requestId: (r.request_id as string) ?? null, credits: r.key_metadata?.credits_consumed ?? 0 };
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const c = new ContextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY!, timeout: 240_000 });
  const out: string[] = [];
  let credits = 0;
  for (const v of WOLT_VENUES) {
    const venueUrl = `https://wolt.com/fi/fin/helsinki/venue/${v}`;
    const home = await scrape(c, venueUrl, false);
    credits += home.credits;
    let cats = [...new Set([...(home.markdown ?? "").matchAll(SWEETS)].map((m) => m[0].slice(7, -1)))];
    // Subcategories are only linked from the main sweets page.
    if (cats.length) {
      const main = await scrape(c, `${venueUrl}/items/${cats[0]}`, false);
      credits += main.credits;
      cats = [...new Set([...cats, ...[...(main.markdown ?? "").matchAll(SWEETS)].map((m) => m[0].slice(7, -1))])];
    }
    console.log(`${v}: ${cats.length} sweets categories`);
    // Category pages one after another (Context.dev rate limit); scrolling loads every tile.
    const results = await Promise.all(
      cats.map(async (cat, i) => {
        await new Promise((r) => setTimeout(r, i * 1500));
        const url = `${venueUrl}/items/${cat}`;
        try {
          const p = await scrape(c, url, true);
          return { itemId: `w|${v}|${cat}|1`, url, site: "wolt", storeId: v, category: cat.replace(/-\d+$/, ""), page: 1, status: p.markdown ? "ok" : "error", markdown: p.markdown, requestId: p.requestId, error: null, capturedAt: new Date().toISOString(), credits: p.credits };
        } catch (e) {
          return { itemId: `w|${v}|${cat}|1`, url, site: "wolt", storeId: v, category: cat.replace(/-\d+$/, ""), page: 1, status: "error", markdown: null, requestId: null, error: (e as Error).message, capturedAt: new Date().toISOString(), credits: 0 };
        }
      }),
    );
    for (const r of results) {
      credits += r.credits;
      out.push(JSON.stringify(r));
      console.log(`  ${r.category}: ${r.status} ${r.markdown?.length ?? 0} chars`);
    }
  }
  fs.writeFileSync(path.join(DIR, "pages-wolt.jsonl"), out.join("\n") + "\n");
  fs.writeFileSync(path.join(DIR, "progress.json"), JSON.stringify({ "credits:wolt": String(credits) }, null, 1));
  console.log(`done · ${out.length} pages · ${credits} credits`);
}

if (process.argv[1]?.endsWith("fetch-wolt.ts")) void main();
