/** Usage: npm run watch:add -- TICKER [TICKER ...]. Tickers come from the command line only. */
import { loadConfig } from "../src/lib/config.ts";
import { openDb } from "../src/lib/db.ts";
import { addTickers } from "../src/lib/watchlist/watch.ts";
import { ensureTickerMap } from "../src/lib/watchlist/ensure-ticker-map.ts";

const config = loadConfig();
const db = openDb(config.DB_PATH);
const now = new Date();
if (await ensureTickerMap(db, config, now)) console.log("ticker map refreshed");
const { done, unknown } = addTickers(db, process.argv.slice(2), now.toISOString().slice(0, 10));
console.log(`added: ${done.join(" ") || "none"}`);
if (unknown.length) console.log(`not added, unknown ticker: ${unknown.join(" ")}`);
