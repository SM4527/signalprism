/** Runs once at server start: validates config, opens the DB (applies migrations), seeds defaults. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadConfig } = await import("@/lib/config");
  const { getDb } = await import("@/lib/db");
  const { seedDefaults } = await import("@/lib/signals/rules");
  const config = loadConfig();
  const db = getDb(config.DB_PATH);
  seedDefaults(db);
  if (config.DATA_MODE === "mock") {
    const { seedSample } = await import("@/lib/seed-sample");
    seedSample(db, new Date().toISOString().slice(0, 10));
  }
}
