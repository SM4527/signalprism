import { tickersOf, watchlistAction } from "@/lib/watchlist/actions";
import { removeTickers } from "@/lib/watchlist/watch";

export const dynamic = "force-dynamic";

export const POST = (req: Request) =>
  watchlistAction(req, async ({ db, form }) => {
    const { done, unknown } = removeTickers(db, tickersOf(form, "tickers"));
    return [done.length && `Removed ${done.join(" ")}.`, unknown.length && `Not a manual ticker: ${unknown.join(" ")}.`].filter(Boolean).join(" ") || "Nothing to remove.";
  });
