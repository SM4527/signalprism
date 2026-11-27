import { z } from "zod";
import { DEFAULT_PUSHOVER_URL } from "./notify/hosts.ts";
import { DEFAULT_SEC_ARCHIVES_URL, DEFAULT_SEC_DATA_URL } from "./sec/hosts.ts";

export const DEFAULT_DB_PATH = "data/signalprism.db";

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]", "host.docker.internal"];

/** True when the URL parses and its host is local, `host.docker.internal`, or listed in `PRISM_NET_HOSTS` (comma separated). */
export function folioPrismHostAllowed(url: string, prismNetHosts = ""): boolean {
  const extra = prismNetHosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const host = URL.canParse(url) ? new URL(url).hostname.toLowerCase() : null;
  return host !== null && [...LOCAL_HOSTS, ...extra].includes(host);
}

const schema = z
  .object({
    DATA_MODE: z.enum(["mock", "live"]).default("mock"),
    DB_PATH: z.string().default(DEFAULT_DB_PATH),
    SEC_USER_AGENT: z.string().optional(),
    SEC_DATA_URL: z.string().default(DEFAULT_SEC_DATA_URL),
    SEC_ARCHIVES_URL: z.string().default(DEFAULT_SEC_ARCHIVES_URL),
    FOLIOPRISM_URL: z.string().optional(),
    PRISM_NET_HOSTS: z.string().optional(),
    /** Read only by the Pushover client and never logged or stored. */
    PUSHOVER_APP_TOKEN: z.string().optional(),
    PUSHOVER_USER_KEY: z.string().optional(),
    PUSHOVER_URL: z.string().default(DEFAULT_PUSHOVER_URL),
    /** Seeds the Rules page setting on first start. */
    PUSH_PORTFOLIO_HINT: z.enum(["off", "flag", "detail"]).default("off"),
    /** A signal whose filing is older than this many days at ingest is historical and never alerted. */
    ALERT_MAX_AGE_DAYS: z.coerce.number().int().min(0).default(3),
    RETENTION_POLL_RUN_DAYS: z.coerce.number().int().min(1).default(90),
    RETENTION_NOTIFICATION_DAYS: z.coerce.number().int().min(1).default(365),
    RETENTION_AUDIT_DAYS: z.coerce.number().int().min(1).default(1095),
    RETENTION_INACTIVE_DAYS: z.coerce.number().int().min(1).default(90),
  })
  .refine((e) => e.DATA_MODE !== "live" || !!e.SEC_USER_AGENT, {
    message: "SEC_USER_AGENT is required when DATA_MODE=live",
    path: ["SEC_USER_AGENT"],
  })
  .refine((e) => !e.FOLIOPRISM_URL || folioPrismHostAllowed(e.FOLIOPRISM_URL, e.PRISM_NET_HOSTS), {
    message: "FOLIOPRISM_URL host must be local, host.docker.internal or listed in PRISM_NET_HOSTS",
    path: ["FOLIOPRISM_URL"],
  });

export type Config = z.infer<typeof schema>;

/** Parse and validate the environment. Throws, so a bad live setup refuses to start. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
