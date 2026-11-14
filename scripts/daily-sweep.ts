/**
 * One daily refresh of the whole dataset: re-reads every category page through Context.dev under a run
 * named for today, imports it next to the history, and records the credits against the local budget.
 *
 *   npx tsx --env-file=.env.local scripts/daily-sweep.ts [--limit N] [--dry-run]
 *
 *   --limit N   only the first N stores per chain (a cheaper sweep); skips the extra-store and Wolt runs
 *   --dry-run   print the plan and the credit estimate, fetch nothing
 *
 * Refuses to start when the estimate would take Delta past CONTEXT_DEV_CREDIT_BUDGET.
 * Safe to re-run on the same day: finished batches are downloaded again, not paid for again.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { creditBudget, creditsSpent, logUsage } from "../src/lib/contextdev";
import { setSetting, nowIso } from "../src/lib/db";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : null;
const day = new Date().toISOString().slice(0, 10);
const RAW = path.join(process.cwd(), "data", "raw");
/** Following pages and repair batches added about 1.4 credits per first page in the 14 Nov sweep (3,091 credits for 1,354 first pages). */
const CREDITS_PER_FIRST_PAGE = 2.4;

function run(script: string, extra: string[], env: Record<string, string>) {
  const r = spawnSync("npx", ["tsx", "--env-file=.env.local", `scripts/${script}`, ...extra], { env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.stdout) process.stdout.write(r.stdout.split("\n").slice(-6).join("\n") + "\n");
  if (r.status !== 0) throw new Error(`${script} exited with ${r.status}`);
  return r.stdout ?? "";
}

/** Credits a fetch run reported in its progress.json. */
function runCredits(runName: string): number {
  const f = path.join(RAW, runName, "progress.json");
  if (!fs.existsSync(f)) return 0;
  const p = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, string>;
  return Object.entries(p).filter(([k]) => k.startsWith("credits:")).reduce((s, [, v]) => s + (Number(v) || 0), 0);
}

/** The most recent run directory with this prefix that lists extra stores, if any. */
function latestStoresJson(prefix: string): string | null {
  const dirs = fs.readdirSync(RAW).filter((d) => d.startsWith(prefix) && fs.existsSync(path.join(RAW, d, "stores.json"))).sort();
  return dirs.length ? path.join(RAW, dirs[dirs.length - 1], "stores.json") : null;
}

function main() {
  const main = `confectionery-${day}`;
  const extra = `helsinki-additions-${day}`;
  const wolt = `wolt-${day}`;
  const limitArgs = LIMIT ? ["--limit", String(LIMIT)] : [];

  const dry = run("fetch-confectionery.ts", ["--dry-run", ...limitArgs], { FETCH_RUN: `estimate-${day}` });
  fs.rmSync(path.join(RAW, `estimate-${day}`), { recursive: true, force: true });
  const firstPages = Number(dry.match(/(\d+) first pages/)?.[1] ?? 0);
  const estimate = Math.round(firstPages * CREDITS_PER_FIRST_PAGE) + (LIMIT ? 0 : 130);
  const spent = creditsSpent();
  console.log(`Sweep ${day}: ${firstPages} first pages${LIMIT ? ` (first ${LIMIT} stores per chain)` : ""}, about ${estimate} credits. Budget: ${spent} of ${creditBudget()} used.`);
  if (spent + estimate > creditBudget()) {
    console.error(`Not started: this sweep would pass the local credit budget (${spent} + ${estimate} > ${creditBudget()}). Raise CONTEXT_DEV_CREDIT_BUDGET or use --limit.`);
    process.exit(2);
  }
  if (DRY) return;

  const runs = [main];
  run("fetch-confectionery.ts", limitArgs, { FETCH_RUN: main });
  run("fetch-lidl.ts", [], { FETCH_RUN: main });
  if (!LIMIT) {
    const stores = latestStoresJson("helsinki-additions-");
    if (stores) {
      fs.mkdirSync(path.join(RAW, extra), { recursive: true });
      if (!fs.existsSync(path.join(RAW, extra, "stores.json"))) fs.copyFileSync(stores, path.join(RAW, extra, "stores.json"));
      run("fetch-confectionery.ts", [], { FETCH_RUN: extra });
      runs.push(extra);
    }
    run("fetch-wolt.ts", [], { FETCH_RUN: wolt });
    runs.push(wolt);
  }
  for (const r of runs) run("import-categories.ts", [r], {});

  const credits = runs.reduce((s, r) => s + runCredits(r), 0);
  logUsage({ op: "sweep", url: runs.join(","), credits });
  setSetting("last_sweep", { day, at: nowIso(), runs, credits, limit: LIMIT });
  console.log(`Sweep ${day} done: ${runs.length} runs imported, ${credits} credits.`);
}

main();
