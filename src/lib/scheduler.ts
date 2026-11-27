import type Database from "better-sqlite3";
import type { Config } from "@/lib/config";
import { formatEt } from "@/lib/format";
import { pollAll } from "@/lib/poll/poll-all";
import type { PollOptions, SecUrls } from "@/lib/poll/poll-company";
import { releaseSending } from "@/lib/notify/deliver";
import { runRetentionIfDue } from "@/lib/retention";
import { deliverOnce } from "@/lib/notify/runtime";
import { SecClient, SecPaused } from "@/lib/sec/client";
import { getSecClient } from "@/lib/sec/shared-client";
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

const inWindow = (at: Date) => {
  const p = Object.fromEntries(eastern.formatToParts(at).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return p.weekday !== "Sat" && p.weekday !== "Sun" && minutes >= 6 * 60 && minutes <= 22 * 60 + 30;
};

/**
 * 30 minutes on weekdays 06:00-22:30 Eastern, otherwise 3 hours, shortened so a tick never lands
 * after the next window start (04:30 ET waits 90 minutes, not 3 hours).
 */
export function nextDelayMs(now: Date): number {
  if (inWindow(now)) return 30 * MINUTE_MS;
  for (let m = 1; m < 180; m++) {
    if (inWindow(new Date(now.getTime() + m * MINUTE_MS))) return m * MINUTE_MS;
  }
  return 180 * MINUTE_MS;
}

export interface SchedulerDeps {
  db: Database.Database;
  client: SecClient;
  urls: SecUrls;
  owner?: string;
  now?: () => Date;
  log?: (msg: string) => void;
  pollOptions?: PollOptions;
  /** Send held notifications. Called only while this process holds the lock: after each poll and on each heartbeat. */
  deliver?: () => Promise<unknown>;
  /** Runs when this process takes the lock (put 'sending' rows back to 'held'). */
  onClaim?: () => void;
  /** Weekly housekeeping, called after each poll while holding the lock; returns a line to log, or nothing. */
  maintain?: (now: Date) => string | void;
}

export type TickResult = "ran" | "skipped_running" | "not_owner" | "paused";

/**
 * Polls on a timer, only while it holds the `scheduler_lock` row, never two runs at once.
 * The next tick is always re-armed; while the lock is held by someone else the claim is retried every 30 s.
 */
export class Scheduler {
  private running = false;
  private stopped = false;
  /** Null until the first claim attempt, so the first outcome is always logged. */
  private held: boolean | null = null;
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

  /** Claim and log the change of state (claimed / waiting) once, not on every attempt. */
  private acquire(): boolean {
    const got = this.claim();
    if (got !== this.held) {
      this.held = got;
      if (got) this.d.onClaim?.();
      this.log(got ? "lock claimed" : "waiting for lock");
    }
    return got;
  }

  /** True while this process holds the scheduler lock. */
  get holdsLock(): boolean {
    return this.held === true;
  }

  /** One delivery pass, only for the lock holder; a failure is logged and never ends the chain. */
  private async runDelivery(): Promise<void> {
    if (!this.held || !this.d.deliver) return;
    try {
      await this.d.deliver();
    } catch (e) {
      this.log(`delivery failed: ${(e as Error).name}`);
    }
  }

  async tick(): Promise<TickResult> {
    if (this.running) {
      this.log("tick skipped: a poll is still running");
      return "skipped_running";
    }
    if (!this.acquire()) return "not_owner";
    this.running = true;
    try {
      const now = this.now();
      if (tickerMapStale(this.d.db, now)) {
        await refreshTickerMap(this.d.db, this.d.client, this.d.urls.archivesUrl, now);
      }
      const r = await pollAll(this.d.db, this.d.client, this.d.urls, now, this.d.pollOptions);
      if (r === "paused") {
        this.log("tick skipped: SEC polling is paused");
        return "paused";
      }
      this.log(`poll done: ${r.filingsNew} new filings, ${r.signalsNew} new signals, ${r.errors} errors`);
      return "ran";
    } catch (e) {
      if (e instanceof SecPaused) this.persistPause(e.until);
      this.log(`poll failed: ${(e as Error).name}`);
      return "ran";
    } finally {
      await this.runDelivery();
      this.runMaintenance();
      this.running = false;
    }
  }

  private runMaintenance(): void {
    if (!this.held || !this.d.maintain) return;
    try {
      const line = this.d.maintain(this.now());
      if (line) this.log(line);
    } catch (e) {
      this.log(`maintenance failed: ${(e as Error).name}`);
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
    this.log("started");
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS).unref();
    void this.loop();
  }

  /** One tick, then always the next one: a throw, a skip or an empty watch list never ends the chain. */
  private async loop(): Promise<void> {
    let delay = nextDelayMs(this.now());
    try {
      if ((await this.tick()) === "not_owner") delay = HEARTBEAT_MS;
    } catch (e) {
      this.log(`tick failed: ${(e as Error).name}`);
    } finally {
      if (!this.stopped) this.arm(delay);
    }
  }

  private arm(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loop(), ms).unref();
    this.log(`next tick ${formatEt(new Date(this.now().getTime() + ms).toISOString())}`);
  }

  /** Every 30 s: keep the lock fresh, notice a lost lock, and run a poll someone asked for (`poll:now`). */
  private beat(): void {
    try {
      if (!this.held) return;
      if (!this.acquire()) {
        this.arm(HEARTBEAT_MS);
        return;
      }
      if (this.takePollRequest()) {
        this.log("poll requested");
        void this.tick().catch((e) => this.log(`tick failed: ${(e as Error).name}`));
      }
      // Quiet hours end and digests fall due between polls, so delivery also runs on the heartbeat.
      void this.runDelivery();
    } catch (e) {
      this.log(`heartbeat failed: ${(e as Error).name}`);
    }
  }

  private takePollRequest(): boolean {
    return (
      this.d.db
        .prepare("UPDATE scheduler_lock SET poll_requested_at = NULL WHERE id = 1 AND poll_requested_at IS NOT NULL")
        .run().changes === 1
    );
  }

  stop(): void {
    this.stopped = true;
    this.held = false;
    if (g.__signalprismScheduler === this) g.__signalprismScheduler = undefined;
    clearInterval(this.heartbeat);
    clearTimeout(this.timer);
    this.d.db.prepare("UPDATE scheduler_lock SET owner = NULL WHERE id = 1 AND owner = ?").run(this.owner);
  }
}

interface SignalSource {
  pid: number;
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  kill(pid: number, signal: NodeJS.Signals): unknown;
}

/** On SIGTERM or SIGINT release the lock row, then re-raise the signal so the process ends as before. */
export function installSignalHandlers(s: Scheduler, proc: SignalSource = process): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    proc.once(signal, () => {
      s.stop();
      proc.kill(proc.pid, signal);
    });
  }
}

const g = globalThis as { __signalprismScheduler?: Scheduler };

/** Start the poller once per process, in live mode only. Mock mode never touches the network. */
export function startScheduler(db: Database.Database, config: Config): Scheduler | undefined {
  if (config.DATA_MODE !== "live" || g.__signalprismScheduler) return g.__signalprismScheduler;
  const urls = { dataUrl: config.SEC_DATA_URL, archivesUrl: config.SEC_ARCHIVES_URL };
  const scheduler: Scheduler = new Scheduler({
    db,
    client: getSecClient(config),
    urls,
    pollOptions: { maxAgeDays: config.ALERT_MAX_AGE_DAYS },
    deliver: () => deliverOnce(db, config, () => scheduler.holdsLock),
    onClaim: () => releaseSending(db),
    maintain: (now) => {
      const r = runRetentionIfDue(db, config, now);
      if (r) return `retention: ${r.pollRuns} poll runs, ${r.notifications} notifications, ${r.auditLines} audit lines, ${r.companies} companies removed`;
    },
  });
  g.__signalprismScheduler = scheduler;
  g.__signalprismScheduler.start();
  installSignalHandlers(g.__signalprismScheduler);
  return g.__signalprismScheduler;
}
