/** Collects S-kaupat's store directory (name → storeId) by following each banner list's "Näytä lisää" cursor. */
import fs from "node:fs";
import ContextDev from "context.dev";
const BANNERS = ["prisma", "s-market", "alepa", "herkku", "sokos-herkku", "mestarin-herkku", "sale"];
async function main() {
  const c = new ContextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY!, timeout: 180_000 });
  const out: { banner: string; name: string; slug: string; storeId: string }[] = [];
  let credits = 0;
  await Promise.all(
    BANNERS.map(async (b, bi) => {
      await new Promise((r) => setTimeout(r, bi * 1500));
      let url: string | null = `https://www.s-kaupat.fi/myymalat/${b}`;
      for (let page = 0; url && page < 40; page++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = await c.web.scrape({ url, formats: { markdown: true }, sharedParams: { country: "FI", waitFor: 'a[href*="/myymala/"]' }, tags: ["shelfintel", "stores"] } as never);
        credits += r.key_metadata?.credits_consumed ?? 1;
        const md: string = r.markdown?.data ?? "";
        for (const m of md.matchAll(/\[\*\*([^*]+)\*\*\]\(https:\/\/www\.s-kaupat\.fi\/myymala\/([^/]+)\/(\d+)\)/g)) out.push({ banner: b, name: m[1].trim(), slug: m[2], storeId: m[3] });
        url = md.match(/\[Näytä lisää\]\((https:\/\/www\.s-kaupat\.fi\/myymalat\/[^)]+)\)/)?.[1] ?? null;
      }
      console.log(b, out.filter((x) => x.banner === b).length);
    }),
  );
  const uniq = [...new Map(out.map((x) => [x.storeId, x])).values()];
  fs.writeFileSync("data/raw/stores/s-directory.json", JSON.stringify(uniq, null, 1));
  console.log(`${uniq.length} S stores · ${credits} credits`);
}
main();
