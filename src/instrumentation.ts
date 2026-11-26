/** Runs once at server start: validates config and opens the DB (applies migrations). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadConfig } = await import("@/lib/config");
  const { getDb } = await import("@/lib/db");
  getDb(loadConfig().DB_PATH);
}
