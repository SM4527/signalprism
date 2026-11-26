/** Usage: npm run watch:remove -- TICKER [TICKER ...]. Tickers come from the command line only. */
import { DEFAULT_DB_PATH } from "../src/lib/config.ts";
import { openDb } from "../src/lib/db.ts";
import { removeTickers } from "../src/lib/watchlist/watch.ts";

const db = openDb(process.env.DB_PATH ?? DEFAULT_DB_PATH);
const { done, unknown } = removeTickers(db, process.argv.slice(2));
console.log(`removed: ${done.join(" ") || "none"}`);
if (unknown.length) console.log(`not on the manual watch list: ${unknown.join(" ")}`);
