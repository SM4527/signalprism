import type Database from "better-sqlite3";
import type { Config } from "@/lib/config";
import { deliverPending, type DeliverResult } from "./deliver";
import { pushoverFromEnv, type Sender } from "./pushover";

const g = globalThis as { __signalprismDelivery?: Promise<DeliverResult> };

/** The Pushover client in live mode when the token and user key are set; null otherwise (and always in mock mode). */
export function senderFor(config: Config): Sender | null {
  return config.DATA_MODE === "live" ? pushoverFromEnv(config) : null;
}

/**
 * One delivery pass for this process. A pass already running is awaited instead of starting a second one, so the
 * scheduler tick and its heartbeat never overlap. Callers outside the sample seed must hold the scheduler lock
 * (`canSend`). Would-be messages are written to the log only in mock mode; a live log carries counts only.
 */
export function deliverOnce(db: Database.Database, config: Config, canSend?: () => boolean): Promise<DeliverResult> {
  g.__signalprismDelivery ??= deliverPending({
    db,
    now: () => new Date(),
    sender: senderFor(config),
    canSend,
    logContent: config.DATA_MODE === "mock" ? (m) => console.log(`[notify] ${m}`) : undefined,
  }).finally(() => {
    g.__signalprismDelivery = undefined;
  });
  return g.__signalprismDelivery;
}
