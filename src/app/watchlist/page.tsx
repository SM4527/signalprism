import Link from "next/link";
import { SourceChips } from "@/components/source-chips";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatEt } from "@/lib/format";
import { listWatchlist } from "@/lib/queries/companies";

export const dynamic = "force-dynamic";

export default function WatchlistPage() {
  const companies = listWatchlist(getDb(loadConfig().DB_PATH));
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Watchlist</h1>
      <p className="text-xs text-muted-foreground">
        {companies.length} tracked. Add or remove with npm run watch:add / watch:remove.
      </p>
      <table className="w-full text-sm" data-testid="watchlist-table">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pr-3">Ticker</th><th className="pr-3">Company</th><th className="pr-3">Sources</th>
            <th className="pr-3">Last filing seen</th><th className="pr-3">Last polled</th>
            <th className="pr-3 text-right">Signals</th><th>Last error</th>
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
              <td className="text-muted-foreground">{c.lastError ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
