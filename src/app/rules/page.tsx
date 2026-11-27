import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { RULE_ROLES } from "@/lib/notify/settings";
import { senderFor } from "@/lib/notify/runtime";
import { loadNotificationConfig } from "@/lib/queries/rules";
import { CLUSTER_DAYS } from "@/lib/signals/clusters";
import { loadRules } from "@/lib/signals/rules";

export const dynamic = "force-dynamic";

const field = "rounded border border-border bg-background px-2 py-1 text-sm";
const button = "rounded bg-secondary px-3 py-1 text-sm text-secondary-foreground";

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 border-t border-border py-1 text-sm">
      <span className="w-56 text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const Check = ({ name, on }: { name: string; on: boolean }) => <input type="checkbox" name={name} defaultChecked={on} />;

export default async function RulesPage({ searchParams }: PageProps<"/rules">) {
  const config = loadConfig();
  const db = getDb(config.DB_PATH);
  const rules = loadRules(db);
  const n = loadNotificationConfig(db);
  const { msg } = await searchParams;
  const configured = config.DATA_MODE === "live" && senderFor(config) !== null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Rules</h1>
      {typeof msg === "string" && (
        <p role="status" data-testid="rules-msg" className="rounded border border-border px-3 py-1 text-sm">{msg}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Changes apply to signals ingested from now on. Late filings, plan buys (10b5-1, ESPP, DRIP, 401(k)) and non-common securities never match.
        Clusters need 2+ distinct insiders within {CLUSTER_DAYS} days, at least one an officer.
      </p>

      {rules.map((r) => (
        <form key={r.id} action="/api/rules/save" method="post" data-testid="rule-form" className="space-y-0">
          <input type="hidden" name="id" value={r.id} />
          <h2 className="mb-1 font-semibold">{r.name} rule</h2>
          <Line label="Enabled"><Check name="enabled" on={r.enabled} /></Line>
          <Line label="Roles">
            <span className="flex flex-wrap gap-3">
              {RULE_ROLES.map((role) => (
                <span key={role} className="flex items-center gap-1">
                  <input type="checkbox" name="roles" value={role} defaultChecked={r.roles.includes(role)} aria-label={role} /> {role}
                </span>
              ))}
            </span>
          </Line>
          <Line label="Open-market buy of at least ($)">
            <input name="minValue" defaultValue={r.minValue} inputMode="decimal" className={`${field} w-32`} aria-label="Minimum value" />
          </Line>
          <Line label="or holdings increase of at least (%)">
            <input name="minPct" defaultValue={r.minPct} inputMode="decimal" className={`${field} w-24`} aria-label="Minimum increase percent" />
            <span className="text-xs text-muted-foreground">a new position counts</span>
          </Line>
          <Line label="Directors"><Check name="includeDirectors" on={r.includeDirectors} /></Line>
          <Line label="Director minimum ($)">
            <input name="directorMinValue" defaultValue={r.directorMinValue} inputMode="decimal" className={`${field} w-32`} aria-label="Director minimum value" />
          </Line>
          <Line label="10% owners"><Check name="includeTenPct" on={r.includeTenPct} /></Line>
          <Line label="Push clusters"><Check name="pushOnCluster" on={r.pushOnCluster} /></Line>
          <div className="pt-2"><button type="submit" className={button}>Save rule</button></div>
        </form>
      ))}

      {n && (
        <form action="/api/notifications/save" method="post" data-testid="notification-form">
          <h2 className="mb-1 font-semibold">Notifications</h2>
          <Line label="Pushover on"><Check name="pushoverEnabled" on={n.pushoverEnabled} /></Line>
          <Line label="Portfolio hint">
            <select name="portfolioHint" defaultValue={n.portfolioHint} className={field} aria-label="Portfolio hint">
              <option value="off">off</option>
              <option value="flag">flag (star after the ticker)</option>
              <option value="detail">detail (held directly or via funds)</option>
            </select>
          </Line>
          <Line label="Quiet hours (ET) from">
            <input name="quietStart" defaultValue={n.quietStart ?? ""} placeholder="22:00" className={`${field} w-24`} aria-label="Quiet hours start" />
            <span className="text-muted-foreground">to</span>
            <input name="quietEnd" defaultValue={n.quietEnd ?? ""} placeholder="07:00" className={`${field} w-24`} aria-label="Quiet hours end" />
          </Line>
          <Line label="Daily digest"><Check name="digest" on={n.digest} /></Line>
          <Line label="Digest time (ET)">
            <input name="digestTime" defaultValue={n.digestTime} className={`${field} w-24`} aria-label="Digest time" />
          </Line>
          <Line label="Daily cap">
            <input name="dailyCap" defaultValue={n.dailyCap} inputMode="numeric" className={`${field} w-20`} aria-label="Daily cap" />
            <span className="text-xs text-muted-foreground">alerts over the cap wait for the summary</span>
          </Line>
          <div className="pt-2"><button type="submit" className={button}>Save notification settings</button></div>
        </form>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Test push</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          {configured
            ? "Sends one real message to your Pushover now, ignoring quiet hours and the cap."
            : "Pushover is not configured here, so a test only records the would-be message (nothing is sent)."}
        </p>
        <form action="/api/push/test" method="post">
          <button type="submit" className={button}>Send test push</button>
        </form>
      </section>
    </div>
  );
}
