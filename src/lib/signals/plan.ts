/** Why a code P line is not a discretionary open-market buy. */
export type PlanKind = "10b5-1" | "espp" | "drip" | "401k";

export const PLAN_LABEL: Record<PlanKind, string> = {
  "10b5-1": "10b5-1 plan",
  espp: "ESPP",
  drip: "DRIP",
  "401k": "401(k)",
};

/** Checked in this order when a line matches more than one. */
const FOOTNOTE_PATTERNS: [PlanKind, RegExp][] = [
  ["espp", /employee stock purchase plan|\bespp\b|terms predetermined by the issuer/i],
  ["drip", /dividend reinvestment|\bdrip\b/i],
  ["401k", /401\(k\)/i],
];

/** The non-discretionary plan a line's footnotes describe, or null. The 10b5-1 box is not a footnote and is handled by the caller. */
export function planKindOfFootnotes(footnotes: string[]): PlanKind | null {
  const text = footnotes.join(" ");
  return FOOTNOTE_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** Only a 10b5-1 buy still counts as an earlier buy by the person; ESPP, DRIP and 401(k) buys are not their decisions. */
export const countsAsEarlierBuy = (kind: PlanKind | null) => kind === null || kind === "10b5-1";
