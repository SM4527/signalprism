import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { rejectUnlessLoopback } from "@/lib/loopback";

/** Redirect back to the Watchlist with a one-line result (303, relative, so the Host header never matters). */
export const backToWatchlist = (msg: string) =>
  new Response(null, { status: 303, headers: { location: `/watchlist?msg=${encodeURIComponent(msg)}` } });

/** Run a watch list action for a loopback POST; anything else gets a 403. */
export async function watchlistAction(
  req: Request,
  act: (ctx: { config: ReturnType<typeof loadConfig>; db: ReturnType<typeof getDb>; form: FormData }) => Promise<string>,
): Promise<Response> {
  const denied = rejectUnlessLoopback(req);
  if (denied) return denied;
  const config = loadConfig();
  return backToWatchlist(await act({ config, db: getDb(config.DB_PATH), form: await req.formData() }));
}

export const tickersOf = (form: FormData, field: string): string[] =>
  String(form.get(field) ?? "").split(/[\s,]+/).filter(Boolean);
