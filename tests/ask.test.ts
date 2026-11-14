import { beforeAll, describe, expect, it, vi } from "vitest";
import { importExport } from "@/lib/importer";
import {
  ask,
  AskError,
  MAX_MODEL_CALLS,
  NOT_CONFIGURED,
  TOOLS,
  accountSummaryTool,
  chainComparisonTool,
  day,
  listPromotionsTool,
  listingCoverageTool,
  priceSpreadsTool,
  productDetailTool,
  searchProductsTool,
} from "@/lib/ask";

// Captures are from 13–14 Nov 2026; evaluate "active" and "ending" at a fixed instant.
const NOW = Date.parse("2026-11-14T12:00:00Z");
const ctx = { now: NOW };
const KEY = "test-key-SECRET-1234567890";

describe("ask tools on the imported dataset", () => {
  beforeAll(() => {
    importExport();
  });

  it("account_summary returns the account totals and a link", () => {
    const s = accountSummaryTool({}, ctx);
    expect(s).toMatchObject({ company: "Fazer", storesSeen: 168, storeScopesCaptured: 181, bannersSeen: 7, link: "/account" });
    expect(s.widestSpread).toMatchObject({ key: "6410222009202", min: 1.25, max: 1.69 });
  });

  it("search_products finds own products by name and EAN, own first, capped", () => {
    const r = searchProductsTool({ query: "Klassikot" }, ctx);
    const rows = r.matches as { key: string; own: boolean; mostCommonPrice: number; link: string }[];
    expect(rows[0]).toMatchObject({ key: "6416453026353", own: true });
    expect(rows[0].link).toBe("/account?p=6416453026353");
    const byEan = searchProductsTool({ query: "6416453026353" }, ctx).matches as { key: string }[];
    expect(byEan.map((x) => x.key)).toContain("6416453026353");
    const many = searchProductsTool({ query: "Fazer", limit: 99 }, ctx).matches as unknown[];
    expect(many.length).toBeLessThanOrEqual(15);
  });

  it("search_products also returns competitor products, flagged not own", () => {
    const rows = searchProductsTool({ query: "Marabou" }, ctx).matches as { own: boolean; brand: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => !x.own)).toBe(true);
    const ownOnly = searchProductsTool({ query: "Marabou", include_competitors: false }, ctx).matches as unknown[];
    expect(ownOnly).toHaveLength(0);
  });

  it("product_detail returns per-banner stats and at most 5 stores each way", () => {
    const d = productDetailTool({ key: "6416453026353" }, ctx);
    expect(d).toMatchObject({ key: "6416453026353", own: true, link: "/account?p=6416453026353" });
    const banners = d.byBanner as { banner: string; storesSeen: number; mostCommonPrice: number; chainFeedOnly: boolean }[];
    expect(banners.find((b) => b.banner === "Alepa")).toMatchObject({ storesSeen: 14, mostCommonPrice: 4.99, chainFeedOnly: false });
    const top = d.mostExpensiveStores as { price: number }[];
    const low = d.cheapestStores as { price: number }[];
    expect(top.length).toBeLessThanOrEqual(5);
    expect(low.length).toBeLessThanOrEqual(5);
    expect(top[0].price).toBe(d.maxPrice);
    expect(low[0].price).toBe(d.minPrice);
    expect(productDetailTool({ key: "nope" }, ctx)).toHaveProperty("error");
  });

  it("list_promotions filters by scope, brand, banner and end date; discount only with a reference", () => {
    const own = listPromotionsTool({ scope: "own", limit: 50 }, ctx);
    const rows = own.promotions as { referencePrice: number | null; discountPct: number | null; active: boolean }[];
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows.every((p) => p.active)).toBe(true);
    for (const p of rows) if (p.referencePrice == null) expect(p.discountPct).toBeNull();
    expect(own.link).toBe("/account#promotions");

    const marabou = listPromotionsTool({ scope: "competitors", brand: "Marabou", limit: 15 }, ctx);
    const mrows = marabou.promotions as { brand: string; banner: string; mechanic: string }[];
    expect(mrows.length).toBeGreaterThan(0);
    expect(mrows.every((p) => p.brand === "Marabou")).toBe(true);
    expect(marabou.link).toBe("/account#competitors");

    const alepa = listPromotionsTool({ scope: "competitors", banner: "Alepa" }, ctx).promotions as { banner: string }[];
    expect(alepa.every((p) => p.banner === "Alepa")).toBe(true);

    const soon = listPromotionsTool({ scope: "competitors", ending_within_days: 1, limit: 15 }, ctx).promotions as { ends: string | null }[];
    for (const p of soon) expect(["14.11.", "15.11."]).toContain(p.ends);
  });

  it("price_spreads ranks by spread and respects min_stores and limit", () => {
    const r = priceSpreadsTool({ min_stores: 2, limit: 3 }, ctx);
    const rows = r.products as { spreadPct: number; storeLevelStores: number; minPrice: number; maxPrice: number }[];
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows.map((x) => x.spreadPct)).toEqual([...rows.map((x) => x.spreadPct)].sort((a, b) => b - a));
    for (const x of rows) expect(Math.round((x.maxPrice / x.minPrice - 1) * 1000) / 10).toBeCloseTo(x.spreadPct, 0);
    const strict = priceSpreadsTool({ min_stores: 70 }, ctx).products as { storeLevelStores: number }[];
    expect(strict.every((x) => x.storeLevelStores >= 70)).toBe(true);
  });

  it("chain_comparison counts products by chain and keeps the totals consistent", () => {
    const r = chainComparisonTool({ limit: 4 }, ctx);
    expect((r.widestStores as unknown[]).length).toBeLessThanOrEqual(4);
    expect((r.lowerMostCommonPriceAtSGroup as number) + (r.lowerMostCommonPriceAtKGroup as number) + (r.samePrice as number)).toBe(r.productsCompared);
    for (const x of r.widestStores as { kGroupStores: number; sGroupStores: number }[]) {
      expect(x.kGroupStores).toBeGreaterThan(0);
      expect(x.sGroupStores).toBeGreaterThan(0);
    }
  });

  it("listing_coverage orders by stores seen and supports fewest-first", () => {
    const most = listingCoverageTool({ limit: 5 }, ctx).products as { storesSeen: number; byBanner: { seen: number; captured: number }[] }[];
    expect(most.length).toBeLessThanOrEqual(5);
    expect(most.map((x) => x.storesSeen)).toEqual([...most.map((x) => x.storesSeen)].sort((a, b) => b - a));
    const fewest = listingCoverageTool({ order: "fewest", limit: 5 }, ctx).products as { storesSeen: number }[];
    expect(fewest.map((x) => x.storesSeen)).toEqual([...fewest.map((x) => x.storesSeen)].sort((a, b) => a - b));
  });

  it("every tool result carries an in-app link", () => {
    for (const [name, t] of Object.entries(TOOLS)) {
      const args = name === "search_products" ? { query: "Fazer" } : name === "product_detail" ? { key: "6416453026353" } : name === "list_promotions" ? { scope: "own" } : {};
      expect(t.run(args, ctx).link, name).toMatch(/^\//);
    }
    expect(day("2026-11-15")).toBe("15.11.");
  });
});

// ----------------------------------------------------------------------- the Gemini loop, with fetch mocked

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fnCall = (name: string, args: Record<string, unknown>) => ({
  candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args, id: "call_1" }, thoughtSignature: "SIG-abc" }] }, finishReason: "STOP" }],
});
const text = (t: string) => ({ candidates: [{ content: { role: "model", parts: [{ text: t, thoughtSignature: "SIG-xyz" }] }, finishReason: "STOP" }] });

describe("ask loop", () => {
  beforeAll(() => {
    importExport();
  });

  it("runs the tool, sends the model content back unchanged, returns text and sources", async () => {
    const first = fnCall("product_detail", { key: "6416453026353" });
    const f = vi.fn().mockResolvedValueOnce(json(first)).mockResolvedValueOnce(json(text("Most expensive at **K-Supermarket**.")));
    const r = await ask([{ role: "user", text: "Where is Klassikot most expensive?" }], { apiKey: KEY, model: "m", fetchImpl: f as unknown as typeof fetch, now: NOW });
    expect(r.answer).toBe("Most expensive at **K-Supermarket**.");
    expect(r.tools).toEqual(["product_detail"]);
    expect(r.sources).toEqual([{ label: "Fazer Klassikot suklaakonvehtirasia 260g", href: "/account?p=6416453026353" }]);

    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/m:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(String(init.body));
    expect(body.contents[1]).toEqual(first.candidates[0].content); // unchanged, signature included
    const resp = body.contents[2];
    expect(resp.role).toBe("user");
    expect(resp.parts[0].functionResponse).toMatchObject({ name: "product_detail", id: "call_1" });
    expect(resp.parts[0].functionResponse.response.result).toMatchObject({ key: "6416453026353", own: true });
    expect(body.tools[0].functionDeclarations.map((d: { name: string }) => d.name)).toEqual(Object.keys(TOOLS));
    expect(body.generationConfig).toEqual({ temperature: 0.2 });
    expect(body.systemInstruction.parts[0].text).toContain("not captured");
  });

  it("stops after the model-call cap", async () => {
    const f = vi.fn().mockImplementation(async () => json(fnCall("account_summary", {})));
    await expect(ask([{ role: "user", text: "loop" }], { apiKey: KEY, fetchImpl: f as unknown as typeof fetch, now: NOW })).rejects.toMatchObject({ status: 502 });
    expect(f).toHaveBeenCalledTimes(MAX_MODEL_CALLS);
    expect(MAX_MODEL_CALLS).toBe(6);
  });

  it("reports a missing key as not configured, without calling the API", async () => {
    const f = vi.fn();
    const err = await ask([{ role: "user", text: "hi" }], { apiKey: "", fetchImpl: f as unknown as typeof fetch }).catch((e) => e);
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const err2 = await ask([{ role: "user", text: "hi" }], { fetchImpl: f as unknown as typeof fetch }).catch((e) => e);
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    for (const e of [err, err2]) {
      expect(e).toBeInstanceOf(AskError);
      expect(e).toMatchObject({ status: 503, message: NOT_CONFIGURED });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("surfaces API errors and empty candidates as readable messages without the key", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ error: { code: 400, message: `API key not valid: ${KEY}`, status: "INVALID_ARGUMENT" } }, 400));
    const e = await ask([{ role: "user", text: "hi" }], { apiKey: KEY, fetchImpl: f as unknown as typeof fetch }).catch((x) => x);
    expect(e).toBeInstanceOf(AskError);
    expect(e.message).toMatch(/returned an error \(400\): API key not valid/);
    expect(e.message).not.toContain(KEY);

    const g = vi.fn().mockResolvedValueOnce(json({ candidates: [{ finishReason: "SAFETY" }] }));
    await expect(ask([{ role: "user", text: "hi" }], { apiKey: KEY, fetchImpl: g as unknown as typeof fetch })).rejects.toThrow(/no answer \(SAFETY\)/);

    const h = vi.fn().mockResolvedValueOnce(json({ error: { message: "quota" } }, 429));
    await expect(ask([{ role: "user", text: "hi" }], { apiKey: KEY, fetchImpl: h as unknown as typeof fetch })).rejects.toMatchObject({ status: 503 });
  });

  it("never puts the API key in the returned payload", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(fnCall("search_products", { query: "Dumle" })))
      .mockResolvedValueOnce(json(text(`Here you go ${KEY}`)));
    const r = await ask([{ role: "user", text: "Dumle?" }], { apiKey: KEY, fetchImpl: f as unknown as typeof fetch, now: NOW });
    expect(JSON.stringify(r)).not.toContain(KEY);
    // The key travels only in the header, never in a request body.
    for (const [, init] of f.mock.calls as [string, RequestInit][]) expect(String(init.body)).not.toContain(KEY);
  });

  it("drops thought parts from the answer and keeps only the last 8 turns", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ candidates: [{ content: { role: "model", parts: [{ text: "thinking", thought: true }, { text: "Answer." }] } }] }));
    const history = Array.from({ length: 12 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `t${i}` }));
    const r = await ask(history, { apiKey: KEY, fetchImpl: f as unknown as typeof fetch, now: NOW });
    expect(r.answer).toBe("Answer.");
    const body = JSON.parse(String((f.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.contents).toHaveLength(8);
    expect(body.contents[1]).toEqual({ role: "model", parts: [{ text: "t5" }] });
  });
});
