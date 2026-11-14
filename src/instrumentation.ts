/** Starts the private Context.dev change poller when the Node server boots (no public URL needed). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.MONITOR_MODE !== "webhook") {
    const { startPoller } = await import("./lib/monitors");
    startPoller(Number(process.env.POLL_INTERVAL_MS ?? 60_000));
  }
  // Daily refresh of the whole dataset; off unless DAILY_SWEEP_AT is set.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSweepScheduler } = await import("./lib/sweep-scheduler");
    startSweepScheduler();
  }
}
