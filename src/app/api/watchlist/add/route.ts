import { tickersOf, watchlistAction } from "@/lib/watchlist/actions";
import { ensureTickerMap } from "@/lib/watchlist/ensure-ticker-map";
import { addTickers } from "@/lib/watchlist/watch";

export const dynamic = "force-dynamic";

export const POST = (req: Request) =>
  watchlistAction(req, async ({ config, db, form }) => {
    const now = new Date();
    await ensureTickerMap(db, config, now);
    const { done, unknown } = addTickers(db, tickersOf(form, "tickers"), now.toISOString().slice(0, 10));
    return [done.length && `Added ${done.join(" ")}.`, unknown.length && `Unknown ticker: ${unknown.join(" ")}.`].filter(Boolean).join(" ") || "Nothing to add.";
  });
