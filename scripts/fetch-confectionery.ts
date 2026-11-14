/**
 * Fetches the chocolate & candy category pages of every priced store through Context.dev batch scraping
 * and stores the raw markdown with provenance. Parsing and import happen separately
 * (npm run data:import-categories), so the raw evidence is kept as captured.
 *
 *   npx tsx --env-file=.env.local scripts/fetch-confectionery.ts [--dry-run] [--limit N]
 *
 * Sources (category pages only; search URLs are disallowed by K-Ruoka's robots.txt and not used):
 *  - K-Ruoka   /kauppa/tuotehaku/makeiset-ja-naposteltavat/<sub>?kauppa=<store>   (≤100 products per page)
 *  - S-kaupat  /tuotteet/karkit-suklaat-ja-keksit/<sub>?storeId=<id>&page=N       (24 per page)
 *  - Lidl      /h/makeiset-ja-snacksit/h10096205                                   (national online range)
 * Resumable: batch ids are saved in progress.json, so a rerun downloads instead of paying again.
 */
import fs from "node:fs";
import path from "node:path";
import ContextDev from "context.dev";

const RUN = process.env.FETCH_RUN ?? "confectionery-2026-11-14";
const DIR = path.join(process.cwd(), "data", "raw", RUN);
const BB = path.join(process.cwd(), "..", "seed");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

const K_CATS = [
  "suklaat/suklaalevyt",
  "suklaat/suklaapatukat",
  "suklaat/konvehtirasiat",
  "suklaat/kaareelliset-konvehtirasiat",
  "karkkipussit/karkkipussit",
  "muut-makeiset/laku-ja-toffeepatukat",
  "muut-makeiset/makeisjoulukalenterit",
];
const S_CATS = ["suklaalevyt", "suklaa-ja-toffeepatukat", "karkkipussit", "karkkilaatikot", "lakut-ja-tikkarit", "sesonki-ja-lahjamakeiset"];
const LIDL = "https://www.lidl.fi/h/makeiset-ja-snacksit/h10096205";

export interface PageMeta {
  itemId: string;
  url: string;
  site: "k-ruoka" | "s-kaupat" | "lidl";
  storeId: string; // Delta store scope id
  category: string;
  page: number;
}
interface Captured extends PageMeta {
  status: "ok" | "error";
  markdown: string | null;
  requestId: string | null;
  error: string | null;
  capturedAt: string;
}

fs.mkdirSync(DIR, { recursive: true });
const progressFile = path.join(DIR, "progress.json");
const progress: Record<string, string> = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, "utf8")) : {};
const save = () => fs.writeFileSync(progressFile, JSON.stringify(progress, null, 1));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const client = () => new ContextDev({ apiKey: process.env.CONTEXT_DEV_API_KEY!, timeout: 120_000, maxRetries: 2 });

function storeList() {
  const ids = JSON.parse(fs.readFileSync(path.join(BB, "src", "data", "store-price-ids.json"), "utf8")).ids as Record<string, { site: string; storeId?: string; slug?: string }>;
  const exp = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "source", "seed-export.json"), "utf8"));
  // S Group: only stores that showed their own online prices before (others fall back to chain prices).
  const priced = new Set<string>(exp.price_snapshots.filter((s: { source_url: string }) => /storeId=/.test(s.source_url)).map((s: { store_scope: string }) => s.store_scope));
  const s = Object.entries(ids).filter(([k, v]) => v.site === "s-kaupat" && priced.has(k)).map(([k, v]) => ({ scope: k, id: v.storeId! }));
  s.unshift({ scope: "sok-prisma-kannelmaki", id: "513971200" });
  const k = Object.entries(ids).filter(([, v]) => v.site === "k-ruoka").map(([kk, v]) => ({ scope: kk, slug: v.slug! }));
  k.unshift({ scope: "kesko-kcm-iso-omena", slug: "k-citymarket-espoo-iso-omena" });
  return { s: s.slice(0, LIMIT), k: k.slice(0, LIMIT) };
}

/** Optional explicit store list (data/raw/<run>/stores.json), used for runs that add stores. */
interface ExtraStore { scope: string; site: "k-ruoka" | "s-kaupat"; id?: string; slug?: string; name: string; address?: string | null; city?: string | null; lat?: number | null; lon?: number | null }
function explicitStores(): { s: { scope: string; id: string }[]; k: { scope: string; slug: string }[] } | null {
  const f = path.join(DIR, "stores.json");
  if (!fs.existsSync(f)) return null;
  const xs = JSON.parse(fs.readFileSync(f, "utf8")) as ExtraStore[];
  return { s: xs.filter((x) => x.site === "s-kaupat").map((x) => ({ scope: x.scope, id: x.id! })), k: xs.filter((x) => x.site === "k-ruoka").map((x) => ({ scope: x.scope, slug: x.slug! })) };
}

function firstPages(): PageMeta[] {
  const explicit = explicitStores();
  const { s, k } = explicit ?? storeList();
  const pages: PageMeta[] = [];
  for (const st of k)
    for (const c of K_CATS)
      pages.push({ itemId: `k|${st.scope}|${c}|1`, site: "k-ruoka", storeId: st.scope, category: c, page: 1, url: `https://www.k-ruoka.fi/kauppa/tuotehaku/makeiset-ja-naposteltavat/${c}?kauppa=${st.slug}` });
  for (const st of s)
    for (const c of S_CATS)
      pages.push({ itemId: `s|${st.scope}|${c}|1`, site: "s-kaupat", storeId: st.scope, category: c, page: 1, url: `https://www.s-kaupat.fi/tuotteet/karkit-suklaat-ja-keksit/${c}?storeId=${st.id}` });
  if (!explicit) pages.push({ itemId: "l|chain:lidl|makeiset-ja-snacksit|1", site: "lidl", storeId: "chain:lidl", category: "makeiset-ja-snacksit", page: 1, url: LIDL });
  return pages;
}

async function retry<T>(what: string, fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`${what} failed (${(e as Error).message}); retry ${i}`);
      await sleep(Math.min(60_000, 5_000 * i));
    }
  }
}

async function runBatch(name: string, pages: PageMeta[], waitFor: number | string = 3000): Promise<Captured[]> {
  if (!pages.length) return [];
  const c = client();
  const key = `batch:${name}`;
  let id = progress[key];
  if (!id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub: any = await retry(`[${name}] submit`, () =>
      c.batch.submit(
        { input: { mode: "scrape", data: { urls: pages.map((p) => ({ url: p.url, itemId: p.itemId })), formats: { markdown: true }, sharedParams: { country: "FI", waitFor } } }, tags: ["shelfintel", "confectionery", name] } as never,
        { timeout: 120_000 },
      ),
    );
    id = sub.id;
    progress[key] = id;
    save();
    console.log(`[${name}] batch ${id} submitted: ${pages.length} pages`);
  } else console.log(`[${name}] reusing batch ${id}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let st: any;
  let last = "";
  for (;;) {
    st = await retry(`[${name}] status`, () => c.batch.retrieve(id, { timeout: 60_000 }));
    const line = `[${name}] ${st.status}: ${st.progress?.succeeded ?? 0} ok, ${st.progress?.failed ?? 0} failed, ${st.progress?.pending ?? 0} waiting`;
    if (line !== last) console.log(`${new Date().toLocaleTimeString("en-GB")} ${line}`);
    last = line;
    if (["completed", "cancelled", "failed"].includes(st.status)) break;
    await sleep(15_000);
  }
  progress[`credits:${name}`] = String(st.credits?.net ?? "?");
  save();
  const byId = new Map(pages.map((p) => [p.itemId, p]));
  const out: Captured[] = [];
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await retry(`[${name}] results`, () => c.batch.getResults(id, { cursor, limit: 100 }, { timeout: 120_000 }));
    for (const r of res.data ?? []) {
      const meta = byId.get(r.itemId);
      if (!meta) continue;
      const ok = r.status === "ok" && r.result?.markdown?.success;
      out.push({
        ...meta,
        status: ok ? "ok" : "error",
        markdown: ok ? r.result.markdown.data : null,
        requestId: r.result?.request_id ?? null,
        error: ok ? null : (r.error?.message ?? r.error?.code ?? "page failed"),
        capturedAt: r.completed_at ?? r.result?.completed_at ?? new Date().toISOString(),
      });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  fs.writeFileSync(path.join(DIR, `${name}.jsonl`), out.map((x) => JSON.stringify(x)).join("\n") + "\n");
  console.log(`[${name}] ${out.filter((x) => x.status === "ok").length}/${pages.length} pages ok · ${st.credits?.net ?? "?"} credits`);
  return out;
}

/** "113 tuotettaSivu 1 / 5" → 5 */
export function skaupatPageCount(md: string): number {
  const m = md.match(/Sivu\s+1\s*\/\s*(\d+)/);
  return m ? Math.min(20, Number(m[1])) : 1;
}

async function main() {
  const p1 = firstPages();
  console.log(`${p1.length} first pages (K-Ruoka ${p1.filter((p) => p.site === "k-ruoka").length}, S-kaupat ${p1.filter((p) => p.site === "s-kaupat").length}, Lidl ${p1.filter((p) => p.site === "lidl").length})`);
  if (DRY) return;
  const first = await withRetry("pages-1", p1);
  const more: PageMeta[] = [];
  for (const r of first) {
    if (r.site !== "s-kaupat" || !r.markdown) continue;
    const n = skaupatPageCount(r.markdown);
    for (let pg = 2; pg <= n; pg++) more.push({ ...r, itemId: `s|${r.storeId}|${r.category}|${pg}`, page: pg, url: `${r.url}&page=${pg}` });
  }
  console.log(`${more.length} further S-kaupat pages`);
  // A rerun may find more follow-up pages (first pages that only succeeded on retry): fetch just those.
  const doneFile = path.join(DIR, "pages-n.jsonl");
  const already = new Set(fs.existsSync(doneFile) ? fs.readFileSync(doneFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).itemId) : []);
  if (progress["batch:pages-n"]) {
    await withRetry("pages-n", more.filter((p) => already.has(p.itemId)));
    await withRetry("pages-n-extra", more.filter((p) => !already.has(p.itemId)));
  } else await withRetry("pages-n", more);
  console.log("done");
}

/** Runs a batch, then resubmits failed or empty pages once more as "<name>-retry". */
async function withRetry(name: string, pages: PageMeta[]): Promise<Captured[]> {
  const res = await runBatch(name, pages);
  const bad = new Set(res.filter((r) => r.status !== "ok" || !r.markdown || r.markdown.length < 3000).map((r) => r.itemId));
  for (const p of pages) if (!res.some((r) => r.itemId === p.itemId)) bad.add(p.itemId);
  if (!bad.size) return res;
  console.log(`[${name}] retrying ${bad.size} failed pages`);
  const again = await runBatch(`${name}-retry`, pages.filter((p) => bad.has(p.itemId)));
  const fixed = new Map(again.filter((r) => r.status === "ok").map((r) => [r.itemId, r]));
  return res.map((r) => fixed.get(r.itemId) ?? r).concat(again.filter((r) => !res.some((x) => x.itemId === r.itemId)));
}

/**
 * --repair: recapture pages that came back without products (S-kaupat tiles still loading, K-Ruoka
 * error pages), waiting for product links instead of a fixed delay, then fetch the follow-up pages of
 * S-kaupat categories whose first page was among them.
 */
async function repair() {
  const { parseKruokaCategory, parseSkaupatCategory } = await import("../src/lib/parsers/categories");
  const best = new Map<string, Captured>();
  for (const f of fs.readdirSync(DIR).filter((x) => /^pages-.*\.jsonl$/.test(x)).sort())
    for (const l of fs.readFileSync(path.join(DIR, f), "utf8").trim().split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as Captured;
      const n = (x: Captured) => (x.status !== "ok" || !x.markdown ? -1 : x.site === "k-ruoka" ? parseKruokaCategory(x.markdown).length : x.site === "s-kaupat" ? parseSkaupatCategory(x.markdown).length : 1);
      const p = best.get(r.itemId);
      if (!p || n(r) > n(p)) best.set(r.itemId, r);
    }
  const empty = [...best.values()].filter((r) => r.status === "ok" && r.markdown && r.site !== "lidl" && (r.site === "k-ruoka" ? parseKruokaCategory(r.markdown).length : parseSkaupatCategory(r.markdown).length) === 0);
  console.log(`${empty.length} pages without products`);
  const tag = `repair-${Date.now().toString(36)}`;
  const k = await runBatch(`pages-${tag}-k`, empty.filter((r) => r.site === "k-ruoka"), 6000);
  const sres = await runBatch(`pages-${tag}-s`, empty.filter((r) => r.site === "s-kaupat"), 'a[href*="/tuote/"]');
  const more: PageMeta[] = [];
  for (const r of sres)
    if (r.page === 1 && r.markdown)
      for (let pg = 2; pg <= skaupatPageCount(r.markdown); pg++) if (!best.has(`s|${r.storeId}|${r.category}|${pg}`)) more.push({ ...r, itemId: `s|${r.storeId}|${r.category}|${pg}`, page: pg, url: `${r.url}&page=${pg}` });
  console.log(`${more.length} follow-up pages`);
  await runBatch(`pages-${tag}-more`, more, 'a[href*="/tuote/"]');
  console.log(`repaired: K ${k.filter((x) => x.status === "ok").length}, S ${sres.filter((x) => x.status === "ok").length}`);
}

if (process.argv[1]?.endsWith("fetch-confectionery.ts")) void (args.includes("--repair") ? repair() : main());
