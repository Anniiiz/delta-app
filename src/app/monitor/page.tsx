import { db, getSetting } from "@/lib/db";
import { listAlerts } from "@/lib/analytics";
import { pageContext } from "@/lib/context";
import { replayablePairs } from "@/lib/alerts";
import { listMonitors, monitorMode, recommendedMonitors } from "@/lib/monitors";
import { creditBudget, creditsSpent, hasContextKey, lastKnownRemaining } from "@/lib/contextdev";
import { AlertItem } from "@/components/AlertItem";
import { CreateMonitorButton, MarkReadOnView, MonitorRowActions, PollButton, ReplayControls } from "@/components/MonitorActions";
import { Card, Empty, PageHeader, SourceLink, ago, cls, stamp } from "@/components/ui";

export const dynamic = "force-dynamic";

const STEPS = [
  ["Watch", "Context.dev monitors a product page"],
  ["Receive", "Signed webhook or polling"],
  ["Verify", "Fresh scrape, prices re-extracted"],
  ["Compare", "Diff vs previous observation"],
  ["Alert", "Only price / offer / listing changes"],
];

export default async function Monitor({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await pageContext(searchParams);
  const key = hasContextKey();
  const mine = listMonitors("shelfintel");
  const recs = recommendedMonitors();
  const alerts = listAlerts(100);
  const pairs = replayablePairs();
  const events = db()
    .prepare("SELECT e.*, m.name AS monitor_name, m.target_url FROM monitor_events e LEFT JOIN monitors m ON m.id = e.monitor_id ORDER BY e.received_at DESC LIMIT 30")
    .all() as { id: string; event: string; status: string; received_at: string; outcome: string | null; origin: string; payload: string; monitor_name: string | null; target_url: string | null; error: string | null }[];
  const lastPoll = getSetting<string | null>("last_poll", null);

  return (
    <div className="space-y-5">
      <MarkReadOnView />
      <PageHeader
        title="Competitor Monitor"
       
      />

      <div className="grid gap-3 md:grid-cols-4">
        <div className="card px-4 py-3">
          <div className="label">Context.dev</div>
          <div className={cls("mt-1 flex items-center gap-2 text-[15px] font-semibold", key ? "text-ink" : "text-mute")}>
            <span className={cls("h-2 w-2 rounded-full", key ? "live-dot bg-leaf" : "bg-faint")} aria-hidden />
            {key ? "Connected" : "API key not set"}
          </div>
          <div className="mt-0.5 text-xs text-mute">{key ? `${monitorMode() === "webhook" ? "Webhook mode" : "Private polling mode"}${lastPoll ? ` · polled ${ago(lastPoll)}` : ""}` : "Add CONTEXT_DEV_API_KEY to .env.local"}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="label">Delta monitors</div>
          <div className="num mt-1 text-[22px] font-semibold text-ink">{mine.length}</div>
          <div className="text-xs text-mute">{recs.length} recommended not yet created</div>
        </div>
        <div className="card px-4 py-3">
          <div className="label">Credits used by Delta</div>
          <div className="num mt-1 text-[22px] font-semibold text-ink">{creditsSpent()}</div>
          <div className="text-xs text-mute">local budget {creditBudget()}{lastKnownRemaining() != null ? ` · ${lastKnownRemaining()} left on account` : ""}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="label">Alerts</div>
          <div className="num mt-1 text-[22px] font-semibold text-ink">{alerts.length}</div>
          <div className="text-xs text-mute">{alerts.filter((a) => a.origin === "monitor").length} live · {alerts.filter((a) => a.origin === "replay").length} replayed</div>
        </div>
      </div>

      <Card title="Pipeline" pad={false}>
        <ol className="grid divide-y divide-line-2 md:grid-cols-5 md:divide-x md:divide-y-0">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="px-4 py-3">
              <div className="text-xs text-faint">{i + 1}</div>
              <div className="text-[13px] font-semibold text-ink">{t}</div>
              <p className="mt-0.5 text-xs text-mute">{d}</p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Alert feed" pad={false}>
          {alerts.length ? (
            <ul className="divide-y divide-line-2">
              {alerts.map((a) => (
                <AlertItem key={a.id} a={a} company={company} />
              ))}
            </ul>
          ) : (
            <div className="p-4">
              <Empty>No alerts yet. Create a monitor or run a replay.</Empty>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Live monitors" right={<PollButton disabled={!key || !mine.length} />} pad={false}>
            <ul className="divide-y divide-line-2">
              {mine.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cls("h-1.5 w-1.5 rounded-full", m.status === "active" ? "live-dot bg-leaf" : "bg-faint")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.name}</span>
                    <MonitorRowActions id={m.id} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 pl-3.5 text-xs text-mute">
                    <span>every {m.schedule_minutes && m.schedule_minutes >= 60 ? `${m.schedule_minutes / 60} h` : `${m.schedule_minutes} min`}</span>
                    <span>last run {ago(m.last_run_at)}</span>
                    <span>last change {ago(m.last_change_at)}</span>
                    <SourceLink url={m.target_url} />
                  </div>
                </li>
              ))}
              {recs.map((r) => (
                <li key={r.productId + r.storeId} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-ink-2">{r.name}</div>
                    <div className="text-xs text-mute">{r.reason}</div>
                    <SourceLink url={r.url} />
                  </div>
                  <CreateMonitorButton productId={r.productId} storeId={r.storeId} disabled={!key} />
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Replay recorded captures">
            {pairs.length ? <ReplayControls pairs={pairs} hasReplay={alerts.some((a) => a.origin === "replay")} /> : <Empty>No offer page has been captured twice yet.</Empty>}
          </Card>

          <Card title="Event log" pad={false}>
            <ul className="divide-y divide-line-2">
              {events.map((e) => {
                const payload = (() => {
                  try {
                    return JSON.parse(e.payload);
                  } catch {
                    return {};
                  }
                })();
                const change = payload?.data?.change;
                const outcome = e.outcome ? JSON.parse(e.outcome) : null;
                return (
                  <li key={e.id} className="px-4 py-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-mute">{stamp(e.received_at)}</span>
                      <span className="font-medium text-ink-2">{e.event}</span>
                      <span className={cls("chip", e.status === "processed" ? "text-leaf" : e.status === "error" ? "text-berry" : "text-mute")}>{e.status}</span>
                      {e.origin !== "shelfintel" && <span className="chip text-faint">{e.origin === "seed" ? "imported history" : "replay"}</span>}
                    </div>
                    <div className="mt-0.5 truncate text-mute">{e.monitor_name ?? (e.origin === "replay" ? "Recorded capture pair" : e.id)}</div>
                    {change?.summary && <p className="mt-1 leading-relaxed text-ink-2">Context.dev: “{change.summary}”</p>}
                    {outcome && (
                      <p className="mt-0.5 text-mute">
                        → {outcome.verdict ?? outcome.note ?? (outcome.compared != null ? `${outcome.compared} compared · ${outcome.changes} changes · ${outcome.relevant} in tracked category` : "")}
                      </p>
                    )}
                    {e.error && <p className="mt-0.5 text-berry">{e.error}</p>}
                  </li>
                );
              })}
              {!events.length && <li className="px-4 py-4 text-xs text-mute">No events yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
