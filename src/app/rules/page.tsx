import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { formatUsd } from "@/lib/format";
import { loadNotificationConfig } from "@/lib/queries/rules";
import { CLUSTER_DAYS } from "@/lib/signals/clusters";
import { loadRules } from "@/lib/signals/rules";

export const dynamic = "force-dynamic";

const yesNo = (b: boolean) => (b ? "on" : "off");

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-t border-border py-1 text-sm">
      <dt className="w-56 text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

export default function RulesPage() {
  const db = getDb(loadConfig().DB_PATH);
  const rules = loadRules(db);
  const n = loadNotificationConfig(db);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Rules</h1>
      <p className="text-xs text-muted-foreground">Read-only. Editing and Send test push arrive in a later milestone.</p>

      {rules.map((r) => (
        <section key={r.id}>
          <h2 className="mb-1 font-semibold">{r.name} rule ({yesNo(r.enabled)})</h2>
          <dl>
            <Row k="Roles" v={r.roles.join(", ")} />
            <Row k="Open-market buy of at least" v={formatUsd(r.minValue)} />
            <Row k="or holdings increase of at least" v={`${r.minPct}% (a new position counts)`} />
            <Row k="Excluded" v="late filings, 10b5-1 trades, non-common securities" />
            <Row k="Directors" v={`${yesNo(r.includeDirectors)} (at least ${formatUsd(r.directorMinValue)} when on)`} />
            <Row k="10% owners" v={yesNo(r.includeTenPct)} />
            <Row k="Clusters" v={`${yesNo(r.pushOnCluster)}: 2+ distinct insiders within ${CLUSTER_DAYS} days, at least one officer`} />
          </dl>
        </section>
      ))}

      {n && (
        <section>
          <h2 className="mb-1 font-semibold">Notifications</h2>
          <dl>
            <Row k="Pushover" v={yesNo(n.pushoverEnabled)} />
            <Row k="Portfolio hint" v={n.portfolioHint} />
            <Row k="Quiet hours" v={n.quietStart && n.quietEnd ? `${n.quietStart} to ${n.quietEnd} ET` : "none"} />
            <Row k="Daily digest" v={yesNo(n.digest)} />
            <Row k="Daily cap" v={n.dailyCap} />
          </dl>
        </section>
      )}
    </div>
  );
}
