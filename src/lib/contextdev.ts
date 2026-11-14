import ContextDev from "context.dev";
import { db, nowIso } from "./db";

/**
 * Server-only Context.dev client with credit accounting and a local budget guard
 * (CONTEXT_DEV_CREDIT_BUDGET, default 300) so development never drains the demo balance.
 */
let _client: ContextDev | null = null;

export function hasContextKey() {
  return Boolean(process.env.CONTEXT_DEV_API_KEY);
}

export function contextClient(): ContextDev {
  if (typeof window !== "undefined") throw new Error("Context.dev client is server-only");
  const apiKey = process.env.CONTEXT_DEV_API_KEY;
  if (!apiKey) throw new Error("CONTEXT_DEV_API_KEY is not set");
  if (!_client) _client = new ContextDev({ apiKey, timeout: 90_000, maxRetries: 1 });
  return _client;
}

export const creditBudget = () => Number(process.env.CONTEXT_DEV_CREDIT_BUDGET ?? 300);
export const creditsSpent = () => (db().prepare("SELECT COALESCE(SUM(credits),0) AS s FROM api_usage").get() as { s: number }).s;
export const lastKnownRemaining = () =>
  (db().prepare("SELECT credits_remaining AS r FROM api_usage WHERE credits_remaining IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { r: number } | undefined)?.r ?? null;

export function logUsage(e: { op: string; url?: string; credits?: number | null; remaining?: number | null; requestId?: string | null; ok?: boolean; error?: string | null; ms?: number | null }) {
  db()
    .prepare("INSERT INTO api_usage(at, op, url, credits, credits_remaining, request_id, ok, error, duration_ms) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(nowIso(), e.op, e.url ?? null, e.credits ?? 0, e.remaining ?? null, e.requestId ?? null, e.ok === false ? 0 : 1, e.error ?? null, e.ms ?? null);
}

function assertBudget(cost: number) {
  const spent = creditsSpent();
  if (spent + cost > creditBudget()) throw new Error(`Local Context.dev credit budget reached (${spent}/${creditBudget()}). Raise CONTEXT_DEV_CREDIT_BUDGET to continue.`);
}

export interface ScrapeResult {
  url: string;
  requestId: string | null;
  capturedAt: string;
  html: string | null;
  json: unknown;
}

/** Fresh page read used to verify a detected change. maxAgeMs 0 bypasses Context.dev's cache. */
export async function scrape(o: { url: string; html?: boolean; json?: { schema: Record<string, unknown>; instructions?: string }; waitForMs?: number; maxAgeMs?: number }): Promise<ScrapeResult> {
  assertBudget(1 + (o.json ? 4 : 0));
  const body: Record<string, unknown> = {
    url: o.url,
    formats: { ...(o.html ? { html: true } : {}), ...(o.json ? { json: true } : {}) },
    sharedParams: { country: "FI", ...(o.waitForMs ? { waitFor: o.waitForMs } : {}) },
    tags: ["shelfintel"],
  };
  if (o.maxAgeMs != null) body.maxAgeMs = o.maxAgeMs;
  if (o.json) body.jsonParams = o.json;
  const t0 = performance.now();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await contextClient().web.scrape(body as never);
    const km = res.key_metadata ?? {};
    logUsage({ op: "scrape", url: o.url, credits: km.credits_consumed ?? null, remaining: km.credits_remaining ?? null, requestId: res.request_id ?? null, ms: performance.now() - t0 });
    const out = (k: string) => (res[k]?.success ? res[k].data : null);
    return { url: res.url ?? o.url, requestId: res.request_id ?? null, capturedAt: nowIso(), html: out("html"), json: out("json") };
  } catch (err) {
    logUsage({ op: "scrape", url: o.url, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 500), ms: performance.now() - t0 });
    throw err;
  }
}
