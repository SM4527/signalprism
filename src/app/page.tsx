import Link from "next/link";
import { Fragment } from "react";
import { SignalBadges } from "@/components/badge";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { SecLink } from "@/components/sec-link";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatEt, formatIncrease, formatShares, formatUsd } from "@/lib/format";
import { MAX_ROWS, listSignals, parseFilters } from "@/lib/queries/signals";
import { ROLES } from "@/lib/sec/roles";

export const dynamic = "force-dynamic";

const DAYS = [7, 30, 90, 365];
const field = "rounded border border-border bg-background px-2 py-1 text-sm";

export default async function SignalsPage({ searchParams }: PageProps<"/">) {
  const filters = parseFilters(await searchParams);
  const today = formatEt(new Date().toISOString()).slice(0, 10);
  const rows = listSignals(getDb(loadConfig().DB_PATH), filters, today);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Signals</h1>
      <form className="flex flex-wrap items-center gap-3 text-sm" aria-label="Filters">
        <label className="flex items-center gap-1">
          Filed in last
          <select name="days" defaultValue={filters.days} className={field}>
            {DAYS.map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Min score
          <input name="min" type="number" min={0} defaultValue={filters.minScore} className={`${field} w-16`} />
        </label>
        <label className="flex items-center gap-1">
          Role
          <select name="role" defaultValue={filters.role ?? ""} className={field}>
            <option value="">All</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Sort
          <select name="sort" defaultValue={filters.sort} className={field}>
            <option value="filed">Newest filed</option>
            <option value="score">Score</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input name="held" type="checkbox" value="1" defaultChecked={filters.heldOnly} /> Held now
        </label>
        <label className="flex items-center gap-1">
          <input name="rule" type="checkbox" value="1" defaultChecked={filters.matchesRule} /> Matches default rule
        </label>
        <label className="flex items-center gap-1">
          {/* Sent first, so an unchecked box still submits hideplan=0 and the default (on) is not reapplied. */}
          <input name="hideplan" type="hidden" value="0" />
          <input name="hideplan" type="checkbox" value="1" defaultChecked={filters.hidePlan} /> Hide plan buys
        </label>
        <button type="submit" className="rounded bg-secondary px-3 py-1 text-secondary-foreground">Apply</button>
      </form>

      <p className="text-xs text-muted-foreground">
        {rows.length} signal{rows.length === 1 ? "" : "s"} (max {MAX_ROWS})
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No signals match.</p>
      ) : (
        <table className="w-full text-sm" data-testid="signals-table">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3">Score</th>
              <th className="pr-3">Ticker</th>
              <th className="pr-3">Insider</th>
              <th className="pr-3">Role</th>
              <th className="pr-3 text-right">Value</th>
              <th className="pr-3 text-right">Increase</th>
              <th className="pr-3">Bought</th>
              <th className="pr-3">Filed</th>
              <th className="pr-3">Badges</th>
              <th>Filing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Fragment key={s.id}>
                <tr data-testid="signal-row" className="border-t border-border align-top">
                  <td className="py-1 pr-3 font-mono font-semibold">
                    {s.score}
                    {s.matchesRule && <span title="Matches the default rule" className="ml-1 text-emerald-400">&#10003;</span>}
                  </td>
                  <td className="pr-3 font-semibold">
                    {s.ticker ? <Link href={`/ticker/${s.ticker}`} className="hover:underline">{s.ticker}</Link> : s.issuerCik}
                  </td>
                  <td className="pr-3" title={s.titleRaw ?? undefined}>{s.ownerNames.join(", ")}</td>
                  <td className="pr-3">{s.role}</td>
                  <td className="pr-3 text-right font-mono" title={`${formatShares(s.shares)} sh at $${s.avgPrice}`}>
                    {formatUsd(s.value)}
                  </td>
                  <td className="pr-3 text-right font-mono">{formatIncrease(s.pctIncrease, s.newPosition)}</td>
                  <td className="pr-3 font-mono">{s.txnDate}</td>
                  <td className="pr-3 font-mono">{formatEt(s.filedAt)}</td>
                  <td className="pr-3"><SignalBadges s={s} /></td>
                  <td><SecLink issuerCik={s.issuerCik} accession={s.accession} /></td>
                </tr>
                <tr>
                  <td />
                  <td colSpan={9} className="pb-1"><ScoreBreakdown score={s.score} parts={s.parts} /></td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
