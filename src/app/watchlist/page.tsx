import Link from "next/link";
import { SourceChips } from "@/components/source-chips";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatEt } from "@/lib/format";
import { listWatchlist } from "@/lib/queries/companies";
import { SOFT_CAP, lastRefresh } from "@/lib/watchlist/refresh";

export const dynamic = "force-dynamic";

const field = "rounded border border-border bg-background px-2 py-1 text-sm";
const button = "rounded bg-secondary px-3 py-1 text-sm text-secondary-foreground";

export default async function WatchlistPage({ searchParams }: PageProps<"/watchlist">) {
  const config = loadConfig();
  const companies = listWatchlist(getDb(config.DB_PATH));
  const { msg } = await searchParams;
  const refresh = lastRefresh();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Watchlist</h1>
      {typeof msg === "string" && (
        <p role="status" data-testid="watchlist-msg" className="rounded border border-border px-3 py-1 text-sm">{msg}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {companies.length} tracked. Direct and fund sources come from FolioPrism; manual tickers are yours to add or remove.
      </p>
      {refresh?.overCap && (
        <p className="text-xs text-amber-300">More than {SOFT_CAP} companies are tracked; a poll cycle may take longer than planned.</p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <form action="/api/watchlist/add" method="post" className="flex items-center gap-2">
          <input name="tickers" required placeholder="Tickers, e.g. ACMR FLCN" aria-label="Tickers to add" className={`${field} w-56`} />
          <button type="submit" className={button}>Add</button>
        </form>
        {config.FOLIOPRISM_URL && (
          <form action="/api/watchlist/refresh" method="post">
            <button type="submit" className={button}>Refresh from FolioPrism</button>
          </form>
        )}
      </div>
      <table className="w-full text-sm" data-testid="watchlist-table">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pr-3">Ticker</th><th className="pr-3">Company</th><th className="pr-3">Sources</th>
            <th className="pr-3">Last filing seen</th><th className="pr-3">Last polled</th>
            <th className="pr-3 text-right">Signals</th><th className="pr-3">Last error</th><th />
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.cik} data-testid="watchlist-row" className="border-t border-border">
              <td className="pr-3 font-semibold"><Link href={`/ticker/${c.ticker}`} className="hover:underline">{c.ticker}</Link></td>
              <td className="pr-3">{c.name}</td>
              <td className="pr-3"><SourceChips c={c} /></td>
              <td className="pr-3 font-mono">{c.lastFiled ?? "none"}</td>
              <td className="pr-3 font-mono">{c.lastPolledAt ? formatEt(c.lastPolledAt) : "never"}</td>
              <td className="pr-3 text-right font-mono">{c.signalCount}</td>
              <td className="pr-3 text-muted-foreground">{c.lastError ?? ""}</td>
              <td>
                {c.inManual && (
                  <form action="/api/watchlist/remove" method="post">
                    <input type="hidden" name="tickers" value={c.ticker} />
                    <button type="submit" aria-label={`Remove ${c.ticker}`} className="text-xs text-muted-foreground hover:underline">Remove</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {refresh && refresh.notTracked.length > 0 && (
        <section data-testid="not-tracked">
          <h2 className="mb-1 font-semibold">Not tracked ({refresh.notTracked.length})</h2>
          <ul className="text-xs text-muted-foreground">
            {refresh.notTracked.map((n) => (
              <li key={`${n.ticker}-${n.reason}`} data-testid="not-tracked-row">
                <span className="font-mono">{n.ticker}</span>: {n.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
