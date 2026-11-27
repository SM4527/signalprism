import type Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadConfig, type Config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { rejectUnlessLoopback } from "@/lib/loopback";

/** Shared GET handler body: loopback guard, query validation (400 on a bad parameter), JSON out. */
export function mcpGet<Q extends z.ZodType>(
  req: Request,
  schema: Q | null,
  run: (ctx: { db: Database.Database; config: Config; query: z.infer<Q> }) => unknown,
): Response {
  const denied = rejectUnlessLoopback(req);
  if (denied) return denied;
  const parsed = (schema ?? z.strictObject({})).safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const config = loadConfig();
  const body = run({ db: getDb(config.DB_PATH), config, query: parsed.data as z.infer<Q> });
  return body === null ? NextResponse.json({ error: "Not found" }, { status: 404 }) : NextResponse.json(body);
}
