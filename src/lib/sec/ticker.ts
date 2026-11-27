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

/** Preferred (`-P`, `-PC`), warrant (`-W`, `-WS`, `-WT`), unit (`-U`, `-UN`) and rights (`-R`, `-RT`) suffixes. Share classes (`-A`, `-B`) are common. */
const NOT_COMMON_SUFFIX = /-(P[A-Z]?|WS?|WT|U|UN|R|RT)$/;

/** False for the preferred, warrant, unit and rights tickers of an issuer. */
export const isCommonTicker = (ticker: string): boolean => !NOT_COMMON_SUFFIX.test(ticker.toUpperCase());
