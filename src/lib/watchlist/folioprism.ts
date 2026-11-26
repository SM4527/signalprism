import { z } from "zod";

const CACHE_MS = 60 * 60_000;
const TIMEOUT_MS = 10_000;

const holdingsSchema = z.array(z.object({ ticker: z.string() }));

/** Only the fields SignalPrism needs. `coverage.items[].source` is "direct" for a stock, anything else for a fund. */
const analysisSchema = z.object({
  intersection: z.object({
    rows: z.array(
      z.object({
        ticker: z.string(),
        name: z.string(),
        children: z.array(z.object({ sourceTicker: z.string(), portfolioPct: z.string() })),
      }),
    ),
    coverage: z.object({ items: z.array(z.object({ ticker: z.string(), source: z.string() })) }),
  }),
});

export type FolioHoldings = z.infer<typeof holdingsSchema>;
export type FolioAnalysis = z.infer<typeof analysisSchema>;
export interface FolioData {
  holdings: FolioHoldings;
  analysis: FolioAnalysis;
}

const g = globalThis as { __signalprismFolio?: { url: string; at: number; data: FolioData } };

async function getJson(base: string, path: string): Promise<unknown> {
  const res = await fetch(new URL(path, base), { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`FolioPrism ${path} answered ${res.status}`);
  return res.json();
}

/**
 * GET `/api/holdings` and `/api/analysis`, validated with zod and cached in memory for an hour.
 * `force` skips the cache. Nothing is written to disk.
 */
export async function fetchFolioData(baseUrl: string, now = Date.now(), force = false): Promise<FolioData> {
  const hit = g.__signalprismFolio;
  if (!force && hit && hit.url === baseUrl && now - hit.at < CACHE_MS) return hit.data;
  const [holdings, analysis] = await Promise.all([getJson(baseUrl, "/api/holdings"), getJson(baseUrl, "/api/analysis")]);
  const data = { holdings: holdingsSchema.parse(holdings), analysis: analysisSchema.parse(analysis) };
  g.__signalprismFolio = { url: baseUrl, at: now, data };
  return data;
}

/** Drop the cached data (tests). */
export function clearFolioCache(): void {
  g.__signalprismFolio = undefined;
}
