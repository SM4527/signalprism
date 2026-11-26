import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { getDb, schemaVersion } from "@/lib/db";
import { getPollStatus } from "@/lib/poll/poll-all";

export const dynamic = "force-dynamic";

export function GET() {
  const config = loadConfig();
  const db = getDb(config.DB_PATH);
  return NextResponse.json({
    status: "ok",
    mode: config.DATA_MODE,
    schema_version: schemaVersion(db),
    poll: getPollStatus(db, new Date()),
  });
}
