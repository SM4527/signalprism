const EMPTY = new Set(["", "NONE", "N/A", "NA"]);

/**
 * Canonical ticker: uppercase, dots as dashes (BRK.B and BRK-B both become BRK-B).
 * A missing or placeholder ticker falls back to `tickerByCik`, else null.
 */
export function normalizeTicker(
  raw: string | null,
  cik: string,
  tickerByCik: ReadonlyMap<string, string> = new Map(),
): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  if (EMPTY.has(t)) return tickerByCik.get(cik) ?? null;
  return t.replaceAll(".", "-");
}
