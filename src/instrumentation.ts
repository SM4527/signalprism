/** Runs once at server start: validates config, opens the DB (applies migrations), seeds defaults. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadConfig } = await import("@/lib/config");
  const { getDb } = await import("@/lib/db");
  const { seedDefaults } = await import("@/lib/signals/rules");
  const config = loadConfig();
  const db = getDb(config.DB_PATH);
  seedDefaults(db, config.PUSH_PORTFOLIO_HINT);
  const { reclassifyPlanBuys } = await import("@/lib/signals/reclassify");
  const reclassified = reclassifyPlanBuys(db, new Date().toISOString().slice(0, 10));
  if (reclassified > 0) console.log(`[startup] reclassified plan buys in ${reclassified} filings`);
  if (config.DATA_MODE === "mock") {
    const { seedSample } = await import("@/lib/seed-sample");
    seedSample(db, new Date().toISOString().slice(0, 10));
    // The sample stack has no scheduler: log the would-be messages once, here.
    const { deliverOnce } = await import("@/lib/notify/runtime");
    await deliverOnce(db, config);
  }
  const { startScheduler } = await import("@/lib/scheduler");
  startScheduler(db, config);
  const { startFolioRefresh } = await import("@/lib/watchlist/folio-timer");
  startFolioRefresh(db, config);
}
