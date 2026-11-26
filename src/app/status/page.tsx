import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatEt } from "@/lib/format";
import { getPollStatus } from "@/lib/poll/poll-all";
import { parseErrors, parseWarnings, pendingFetchFailures, recentPollRuns, tickerMapInfo } from "@/lib/queries/status";
import { lastRefresh } from "@/lib/watchlist/refresh";

export const dynamic = "force-dynamic";

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="font-mono text-lg">{v}</div>
    </div>
  );
}

/** Result of the last FolioPrism refresh; no live call on page load. */
function FolioStatus({ configured }: { configured: boolean }) {
  const s = lastRefresh();
  const text = !configured
    ? "not configured"
    : !s
      ? "no refresh yet"
      : s.ok
        ? `reachable, last refresh ${formatEt(s.at)}: ${s.direct} direct, ${s.funds} through funds, ${s.notTracked.length} not tracked, ${s.noCoverage} skipped without coverage`
        : `unreachable or unreadable (${s.error}), last attempt ${formatEt(s.at)}`;
  return (
    <p className="text-sm text-muted-foreground" data-testid="folioprism-status">
      FolioPrism: {text}
    </p>
  );
}

export default function StatusPage() {
  const config = loadConfig();
  const db = getDb(config.DB_PATH);
  const { lastRun, pausedUntil } = getPollStatus(db, new Date());
  const runs = recentPollRuns(db);
  const errors = parseErrors(db);
  const warnings = parseWarnings(db);
  const tickerMap = tickerMapInfo(db);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Status</h1>
      <p className="text-sm text-muted-foreground">
        Mode: {config.DATA_MODE}.{" "}
        {pausedUntil ? `SEC polling paused until ${formatEt(pausedUntil)}.` : "SEC polling is not paused."}
      </p>

      <section>
        <h2 className="mb-2 font-semibold">Last poll</h2>
        {lastRun ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="last-poll">
            <Stat k="Started" v={formatEt(lastRun.started_at)} />
            <Stat k="Requests" v={lastRun.requests} />
            <Stat k="New filings" v={lastRun.filings_new} />
            <Stat k="New signals" v={lastRun.signals_new} />
            <Stat k="Errors" v={lastRun.errors} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No poll has run{config.DATA_MODE === "mock" ? " (the sample stack never polls SEC)" : " yet"}.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Fetches waiting for retry: {pendingFetchFailures(db)}</p>
      </section>

      {runs.length > 1 && (
        <section>
          <h2 className="mb-1 font-semibold">Recent runs</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="pr-3">Started</th><th className="pr-3 text-right">Requests</th><th className="pr-3 text-right">Filings</th><th className="pr-3 text-right">Signals</th><th className="text-right">Errors</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.startedAt} className="border-t border-border font-mono">
                  <td className="pr-3">{formatEt(r.startedAt)}</td>
                  <td className="pr-3 text-right">{r.requests}</td>
                  <td className="pr-3 text-right">{r.filingsNew}</td>
                  <td className="pr-3 text-right">{r.signalsNew}</td>
                  <td className="text-right">{r.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Parse errors ({errors.length})</h2>
        {errors.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        <ul className="space-y-1 text-sm" data-testid="parse-errors">
          {errors.map((e) => (
            <li key={e.accession} className="font-mono">
              {e.filedAt} {e.accession} <span className="text-muted-foreground">{e.error}</span>
            </li>
          ))}
        </ul>
      </section>

      {warnings.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold">Parse warnings ({warnings.length})</h2>
          <ul className="space-y-1 text-sm" data-testid="parse-warnings">
            {warnings.map((e) => (
              <li key={e.accession} className="font-mono">
                {e.filedAt} {e.accession} <span className="text-muted-foreground">{e.error}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Integrations</h2>
        <ul className="text-sm text-muted-foreground">
          <li>Pushover usage: not configured yet</li>
        </ul>
        <FolioStatus configured={!!config.FOLIOPRISM_URL} />
        <p className="text-sm text-muted-foreground" data-testid="ticker-map-status">
          Ticker map: {tickerMap.count === 0 ? "empty" : `${tickerMap.count} tickers, loaded ${formatEt(tickerMap.loadedAt!)}`}
        </p>
      </section>
    </div>
  );
}
