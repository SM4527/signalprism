import type { Config } from "../config.ts";
import { SecClient } from "./client.ts";

const g = globalThis as { __signalprismSecClient?: SecClient };

/**
 * The one SecClient (and so the one 8 req/s limiter) of this process. The scheduler, the ticker-map refresh
 * and the watch list routes all use it; nothing else constructs a client. Created on first use.
 */
export function getSecClient(config: Pick<Config, "SEC_USER_AGENT">): SecClient {
  return (g.__signalprismSecClient ??= new SecClient({ userAgent: config.SEC_USER_AGENT! }));
}
