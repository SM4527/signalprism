import { notFound } from "next/navigation";
import { SignalBadges } from "@/components/badge";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { SecLink } from "@/components/sec-link";
import { SourceChips } from "@/components/source-chips";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatEt, formatIncrease, formatShares, formatUsd } from "@/lib/format";
import { companyByTicker } from "@/lib/queries/companies";
import { clustersForIssuer } from "@/lib/queries/rules";
import { auditLines, signalsForIssuer } from "@/lib/queries/signals";

export const dynamic = "force-dynamic";

export default async function TickerPage({ params }: PageProps<"/ticker/[ticker]">) {
  const { ticker } = await params;
  const db = getDb(loadConfig().DB_PATH);
  const company = companyByTicker(db, ticker);
  if (!company) notFound();
  const signals = signalsForIssuer(db, company.cik);
  const clusters = clustersForIssuer(db, company.cik);
  const audit = auditLines(db, company.cik);

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
                <span>{s.ownerName} <span className="text-muted-foreground">({s.titleRaw ?? s.role})</span></span>
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
        <h2 className="mb-1 font-semibold">Not alerted: stored lines ({audit.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pr-3">Filed</th><th className="pr-3">Insider</th><th className="pr-3">Code</th>
              <th className="pr-3">Security</th><th className="pr-3">Date</th><th className="pr-3 text-right">Shares</th>
              <th className="pr-3 text-right">Price</th><th className="pr-3">Why not a signal</th><th>Filing</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((l, i) => (
              <tr key={i} data-testid="audit-line" className="border-t border-border">
                <td className="pr-3 font-mono">{l.filedAt}</td>
                <td className="pr-3">{l.ownerName}</td>
                <td className="pr-3 font-mono">{l.code}</td>
                <td className="pr-3">{l.securityTitle}</td>
                <td className="pr-3 font-mono">{l.txnDate}</td>
                <td className="pr-3 text-right font-mono">{l.shares ? formatShares(l.shares) : ""}</td>
                <td className="pr-3 text-right font-mono">{l.price ?? ""}</td>
                <td className="pr-3 text-muted-foreground">{l.why}</td>
                <td><SecLink issuerCik={company.cik} accession={l.accession} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
