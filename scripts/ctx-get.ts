/** Saves Context.dev captures of the given URLs to data/raw/stores/ (markdown, or raw HTML with --html). */
import fs from "node:fs";
import ContextDev from "context.dev";
async function main() {
  const html = process.argv.includes("--html");
  const c = new ContextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY!, timeout: 180_000 });
  await Promise.all(
    process.argv.slice(2).filter((u) => u.startsWith("http")).map(async (url, i) => {
      await new Promise((r) => setTimeout(r, i * 1200));
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = await c.web.scrape({ url, formats: html ? { html: true } : { markdown: true }, sharedParams: { country: "FI", waitFor: 4000 }, tags: ["shelfintel", "stores"] } as never);
        const body = (html ? r.html?.data : r.markdown?.data) ?? "";
        const f = `data/raw/stores/${url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 100)}.${html ? "html" : "md"}`;
        fs.writeFileSync(f, body);
        console.log(url, "→", f, body.length);
      } catch (e) {
        console.log(url, "failed", (e as Error).message.slice(0, 120));
      }
    }),
  );
}
main();
