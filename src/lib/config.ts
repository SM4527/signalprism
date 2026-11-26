import { z } from "zod";
import { DEFAULT_SEC_ARCHIVES_URL, DEFAULT_SEC_DATA_URL } from "./sec/hosts.ts";

export const DEFAULT_DB_PATH = "data/signalprism.db";

const schema = z
  .object({
    DATA_MODE: z.enum(["mock", "live"]).default("mock"),
    DB_PATH: z.string().default(DEFAULT_DB_PATH),
    SEC_USER_AGENT: z.string().optional(),
    SEC_DATA_URL: z.string().default(DEFAULT_SEC_DATA_URL),
    SEC_ARCHIVES_URL: z.string().default(DEFAULT_SEC_ARCHIVES_URL),
  })
  .refine((e) => e.DATA_MODE !== "live" || !!e.SEC_USER_AGENT, {
    message: "SEC_USER_AGENT is required when DATA_MODE=live",
    path: ["SEC_USER_AGENT"],
  });

export type Config = z.infer<typeof schema>;

/** Parse and validate the environment. Throws, so a bad live setup refuses to start. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
