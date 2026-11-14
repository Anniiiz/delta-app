import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "./db";

/**
 * Daily refresh: once a day at DAILY_SWEEP_AT (local time, "HH:MM") the server starts scripts/daily-sweep.ts,
 * which re-reads every category page through Context.dev and imports it next to the history.
 * Off unless DAILY_SWEEP_AT is set. DAILY_SWEEP_LIMIT=N sweeps only the first N stores per chain.
 * Runs inside the app server, so it only fires while the server is running.
 */
const g = globalThis as unknown as { __sisweep?: ReturnType<typeof setInterval>; __sisweeping?: boolean };

export const sweepConfig = () => {
  const at = process.env.DAILY_SWEEP_AT?.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  const limit = Number(process.env.DAILY_SWEEP_LIMIT);
  return { at: at ? `${at[1].padStart(2, "0")}:${at[2]}` : null, limit: Number.isFinite(limit) && limit > 0 ? limit : null };
};

export interface LastSweep {
  day: string;
  at: string;
  runs: string[];
  credits: number;
  limit: number | null;
}
export const lastSweep = () => getSetting<LastSweep | null>("last_sweep", null);

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function tick() {
  const { at, limit } = sweepConfig();
  if (!at || g.__sisweeping) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const today = localDay(now);
  if (hhmm < at || getSetting<string | null>("sweep_started_day", null) === today) return;
  setSetting("sweep_started_day", today);
  g.__sisweeping = true;
  const logDir = path.join(process.cwd(), "data", "raw");
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, `daily-sweep-${today}.log`), "a");
  const child = spawn("npx", ["tsx", "--env-file=.env.local", "scripts/daily-sweep.ts", ...(limit ? ["--limit", String(limit)] : [])], { cwd: process.cwd(), stdio: ["ignore", log, log] });
  const done = (code: number | null) => {
    g.__sisweeping = false;
    fs.closeSync(log);
    console.log(`[shelfintel] daily sweep ${today} finished with code ${code}`);
  };
  child.on("exit", done);
  child.on("error", () => done(-1));
}

export function startSweepScheduler() {
  if (g.__sisweep || !sweepConfig().at) return;
  g.__sisweep = setInterval(tick, 60_000);
}
