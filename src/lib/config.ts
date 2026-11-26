import { z } from "zod";

const schema = z
  .object({
    DATA_MODE: z.enum(["mock", "live"]).default("mock"),
    DB_PATH: z.string().default("data/signalprism.db"),
    SEC_USER_AGENT: z.string().optional(),
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
