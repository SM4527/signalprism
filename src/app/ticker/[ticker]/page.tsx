import Link from "next/link";
import { notFound } from "next/navigation";
import { SignalBadges } from "@/components/badge";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { SecLink } from "@/components/sec-link";
import { SourceChips } from "@/components/source-chips";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatEt, formatIncrease, formatShares, formatUsd } from "@/lib/format";
import { companyByTicker } from "@/lib/queries/companies";
import { groupAudit } from "@/lib/queries/audit";
import { clustersForIssuer } from "@/lib/queries/rules";
import { auditLines, signalsForIssuer } from "@/lib/queries/signals";
import { monthsBefore } from "@/lib/signals/dates";

export const dynamic = "force-dynamic";

export default async function TickerPage({ params, searchParams }: PageProps<"/ticker/[ticker]">) {
  const { ticker } = await params;
  const showAll = (await searchParams).all === "1";
  const db = getDb(loadConfig().DB_PATH);
  const company = companyByTicker(db, ticker);
  if (!company) notFound();
  const signals = signalsForIssuer(db, company.cik);
  const clusters = clustersForIssuer(db, company.cik);
  const allGroups = groupAudit(auditLines(db, company.cik));
  const cutoff = monthsBefore(formatEt(new Date().toISOString()).slice(0, 10), 12);
  const audit = showAll ? allGroups : allGroups.filter((g) => g.filedAt >= cutoff);
  const hidden = allGroups.length - audit.length;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{company.ticker}</h1>
        <span className="text-muted-foreground">{company.name}</span>
        <SourceChips c={company} />
      </header>

      {clusters.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold">Clusters</h2>
          <ul className="text-sm">
            {clusters.map((c) => (
              <li key={c.windowStart} data-testid="cluster">
                {c.insiderCount} insiders, {formatUsd(c.totalValue)}, {c.windowStart} to {c.windowEnd}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Signals ({signals.length})</h2>
        {signals.length === 0 && <p className="text-sm text-muted-foreground">No signals.</p>}
        <ul className="space-y-2">
          {signals.map((s) => (
            <li key={s.id} data-testid="ticker-signal" className="rounded border border-border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-mono font-semibold">{s.score}</span>
                <span>{s.ownerNames.join(", ")} <span className="text-muted-foreground">({s.titleRaw ?? s.role})</span></span>
                <span className="font-mono">{formatUsd(s.value)}</span>
                <span className="font-mono">{formatShares(s.shares)} sh at ${s.avgPrice}</span>
                <span className="font-mono">{formatIncrease(s.pctIncrease, s.newPosition)}</span>
                <span className="font-mono">bought {s.txnDate}, filed {formatEt(s.filedAt)}</span>
                <SignalBadges s={s} />
                <SecLink issuerCik={s.issuerCik} accession={s.accession} />
              </div>
              <ScoreBreakdown score={s.score} parts={s.parts} />
              {s.footnotes.map((n) => (
                <p key={n} className="text-xs text-muted-foreground">Footnote: {n}</p>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Not alerted: stored lines ({audit.length} filings)</h2>
        {audit.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        <div className="text-sm">
          {audit.map((g) => (
            <details key={`${g.accession}|${g.ownerName}`} data-testid="audit-group" className="border-t border-border py-1">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4">
                <span className="font-mono">{g.filedAt}</span>
                <span>{g.ownerName}</span>
                <span className="font-mono">{g.codes.join(", ") || "-"}</span>
                <span className="font-mono">{g.totalShares ? `${formatShares(g.totalShares)} sh` : ""}</span>
                <span className="font-mono">{g.avgPrice ? `avg $${g.avgPrice}` : ""}</span>
                <span className="text-muted-foreground">{g.reasons.join("; ")}</span>
                <SecLink issuerCik={company.cik} accession={g.accession} />
              </summary>
              <table className="mt-1 ml-4 text-xs">
                <tbody>
                  {g.lines.map((l, i) => (
                    <tr key={i} data-testid="audit-line">
                      <td className="pr-3 font-mono">{l.code}</td>
                      <td className="pr-3">{l.securityTitle}</td>
                      <td className="pr-3 font-mono">{l.txnDate}</td>
                      <td className="pr-3 text-right font-mono">{l.shares ? formatShares(l.shares) : ""}</td>
                      <td className="pr-3 text-right font-mono">{l.price ?? ""}</td>
                      <td className="text-muted-foreground">{l.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
        {hidden > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the last 12 months; {hidden} older {hidden === 1 ? "filing" : "filings"} hidden.{" "}
            <Link href={`/ticker/${company.ticker}?all=1`} className="text-sky-400 hover:underline">Show all</Link>
          </p>
        )}
        {showAll && allGroups.length > 0 && (
          <p className="mt-2 text-xs"><Link href={`/ticker/${company.ticker}`} className="text-sky-400 hover:underline">Last 12 months only</Link></p>
        )}
      </section>
    </div>
  );
}
