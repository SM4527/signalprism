import type Database from "better-sqlite3";
import type { Config } from "@/lib/config";
import { pollAll } from "@/lib/poll/poll-all";
import type { SecUrls } from "@/lib/poll/poll-company";
import { SecClient, SecPaused } from "@/lib/sec/client";
import { refreshTickerMap, tickerMapStale } from "@/lib/sec/ticker-map";

const MINUTE_MS = 60_000;
const STALE_LOCK_MS = 2 * MINUTE_MS;
const HEARTBEAT_MS = 30_000;

const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** 30 minutes on weekdays 06:00-22:30 Eastern, otherwise 3 hours. */
export function nextDelayMs(now: Date): number {
  const p = Object.fromEntries(eastern.formatToParts(now).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const weekday = p.weekday !== "Sat" && p.weekday !== "Sun";
  return weekday && minutes >= 6 * 60 && minutes <= 22 * 60 + 30 ? 30 * MINUTE_MS : 180 * MINUTE_MS;
}

export interface SchedulerDeps {
  db: Database.Database;
  client: SecClient;
  urls: SecUrls;
  owner?: string;
  now?: () => Date;
  log?: (msg: string) => void;
}

export type TickResult = "ran" | "skipped_running" | "not_owner" | "paused";

/** Polls on a timer, only while it holds the `scheduler_lock` row, never two runs at once. */
export class Scheduler {
  private running = false;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private owner: string;
  private now: () => Date;
  private log: (msg: string) => void;

  private d: SchedulerDeps;

  constructor(d: SchedulerDeps) {
    this.d = d;
    this.owner = d.owner ?? `${process.pid}-${crypto.randomUUID()}`;
    this.now = d.now ?? (() => new Date());
    this.log = d.log ?? ((m) => console.log(`[scheduler] ${m}`));
  }

  /** Take or keep the lock row: free, already ours, or its heartbeat is stale. */
  claim(): boolean {
    const t = this.now();
    const stale = new Date(t.getTime() - STALE_LOCK_MS).toISOString();
    return (
      this.d.db
        .prepare(
          `UPDATE scheduler_lock SET owner = ?, heartbeat_at = ?
           WHERE id = 1 AND (owner IS NULL OR owner = ? OR heartbeat_at < ?)`,
        )
        .run(this.owner, t.toISOString(), this.owner, stale).changes === 1
    );
  }

  async tick(): Promise<TickResult> {
    if (this.running) {
      this.log("tick skipped: a poll is still running");
      return "skipped_running";
    }
    if (!this.claim()) return "not_owner";
    this.running = true;
    try {
      const now = this.now();
      if (tickerMapStale(this.d.db, now)) {
        await refreshTickerMap(this.d.db, this.d.client, this.d.urls.archivesUrl, now);
      }
      const r = await pollAll(this.d.db, this.d.client, this.d.urls, now);
      if (r === "paused") return "paused";
      this.log(`poll done: ${r.filingsNew} new filings, ${r.signalsNew} new signals, ${r.errors} errors`);
      return "ran";
    } catch (e) {
      if (e instanceof SecPaused) this.persistPause(e.until);
      this.log(`poll failed: ${(e as Error).name}`);
      return "ran";
    } finally {
      this.running = false;
    }
  }

  /** A pause that hit outside a company poll (the ticker map) is stored like any other. */
  private persistPause(until: number): void {
    const t = this.now().toISOString();
    this.d.db
      .prepare("INSERT INTO poll_run (started_at, finished_at, errors, backoff_until) VALUES (?, ?, 1, ?)")
      .run(t, t, new Date(until).toISOString());
  }

  start(): void {
    this.heartbeat = setInterval(() => this.claim(), HEARTBEAT_MS).unref();
    const loop = async () => {
      await this.tick();
      if (!this.stopped) this.timer = setTimeout(loop, nextDelayMs(this.now())).unref();
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (g.__signalprismScheduler === this) g.__signalprismScheduler = undefined;
    clearInterval(this.heartbeat);
    clearTimeout(this.timer);
    this.d.db.prepare("UPDATE scheduler_lock SET owner = NULL WHERE id = 1 AND owner = ?").run(this.owner);
  }
}

const g = globalThis as { __signalprismScheduler?: Scheduler };

/** Start the poller once per process, in live mode only. Mock mode never touches the network. */
export function startScheduler(db: Database.Database, config: Config): Scheduler | undefined {
  if (config.DATA_MODE !== "live" || g.__signalprismScheduler) return g.__signalprismScheduler;
  const client = new SecClient({ userAgent: config.SEC_USER_AGENT! });
  const urls = { dataUrl: config.SEC_DATA_URL, archivesUrl: config.SEC_ARCHIVES_URL };
  g.__signalprismScheduler = new Scheduler({ db, client, urls });
  g.__signalprismScheduler.start();
  return g.__signalprismScheduler;
}
