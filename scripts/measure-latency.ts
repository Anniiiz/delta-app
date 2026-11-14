/**
 * Times a fresh Context.dev read (cache bypassed) of every page Delta monitors, and logs it to api_usage.
 * Costs about 1 credit per page. Run: npx tsx --env-file=.env.local scripts/measure-latency.ts
 */
import { scrape } from "../src/lib/contextdev";
import { listMonitors } from "../src/lib/monitors";

async function main() {
  for (const m of listMonitors("shelfintel")) {
    const t0 = performance.now();
    try {
      const r = await scrape({ url: m.target_url, html: true, maxAgeMs: 0 });
      console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s  ${r.html ? `${r.html.length} bytes` : "no html"}  ${m.name}`);
    } catch (e) {
      console.log(`failed after ${((performance.now() - t0) / 1000).toFixed(1)} s  ${m.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
main();
