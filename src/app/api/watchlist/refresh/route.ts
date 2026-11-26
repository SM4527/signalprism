import { getDb } from "@/lib/db";
import { watchlistAction } from "@/lib/watchlist/actions";
import { refreshFromFolioPrism } from "@/lib/watchlist/refresh";

export const dynamic = "force-dynamic";

export const POST = (req: Request) =>
  watchlistAction(req, async ({ config }) => {
    if (!config.FOLIOPRISM_URL) return "FolioPrism is not configured (FOLIOPRISM_URL).";
    const s = await refreshFromFolioPrism(getDb(config.DB_PATH), config, new Date());
    return s.ok ? `Refreshed from FolioPrism: ${s.direct} direct, ${s.funds} through funds.` : `FolioPrism refresh failed (${s.error}).`;
  });
