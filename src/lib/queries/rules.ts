import type Database from "better-sqlite3";

export interface NotificationConfig {
  pushoverEnabled: boolean;
  portfolioHint: string;
  quietStart: string | null;
  quietEnd: string | null;
  digest: boolean;
  /** `HH:MM` ET when the daily summary goes out. */
  digestTime: string;
  dailyCap: number;
  /** Last Pushover usage headers seen; null until a message was sent. */
  usage: { limit: number; remaining: number; resetAt: string; seenAt: string } | null;
}

export function loadNotificationConfig(db: Database.Database): NotificationConfig | null {
  const r = db.prepare("SELECT * FROM notification_config WHERE id = 1").get() as Record<string, string | number | null> | undefined;
  if (!r) return null;
  return {
    pushoverEnabled: !!r.pushover_enabled,
    portfolioHint: r.portfolio_hint as string,
    quietStart: r.quiet_start as string | null,
    quietEnd: r.quiet_end as string | null,
    digest: !!r.digest,
    digestTime: r.digest_time as string,
    dailyCap: r.daily_cap as number,
    usage:
      r.usage_limit === null || r.usage_remaining === null || r.usage_reset_at === null
        ? null
        : {
            limit: r.usage_limit as number,
            remaining: r.usage_remaining as number,
            resetAt: r.usage_reset_at as string,
            seenAt: r.usage_seen_at as string,
          },
  };
}

export interface ClusterRow {
  windowStart: string;
  windowEnd: string;
  insiderCount: number;
  totalValue: string;
}

export function clustersForIssuer(db: Database.Database, issuerCik: string): ClusterRow[] {
  const rows = db
    .prepare("SELECT window_start, window_end, insider_count, total_value FROM cluster WHERE issuer_cik = ? ORDER BY window_start DESC")
    .all(issuerCik) as { window_start: string; window_end: string; insider_count: number; total_value: string }[];
  return rows.map((r) => ({
    windowStart: r.window_start,
    windowEnd: r.window_end,
    insiderCount: r.insider_count,
    totalValue: r.total_value,
  }));
}
