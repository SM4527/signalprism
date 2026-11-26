import type { Role } from "./roles";

/** Table value of a `nonDerivativeHolding` row: holdings reported without a transaction. */
export const HOLDING_TABLE = "I-holding";

/** One transaction line (or holding row). Shares, prices and holdings are decimal strings, never numbers. */
export interface Line {
  table: 1 | 2 | typeof HOLDING_TABLE;
  seq: number;
  securityTitle: string;
  code: string;
  txnDate: string;
  shares: string | null;
  price: string | null;
  acquiredDisposed: string | null;
  ownedAfter: string | null;
  ownershipForm: string | null;
  nature: string;
  footnotes: string[];
}

export interface Owner {
  cik: string | null;
  name: string;
  isOfficer: boolean;
  isDirector: boolean;
  isTenPct: boolean;
  titleRaw: string | null;
  role: Role;
  jointGroupId: string | null;
}

export interface ParsedForm4 {
  formType: "4" | "4/A";
  periodOfReport: string | null;
  /** 4/A only: the filing date of the amended original, when the XML says it. */
  originalSubmissionDate: string | null;
  issuerCik: string;
  issuerName: string | null;
  tickerRaw: string | null;
  plan10b51: boolean;
  planSuspected: boolean;
  owners: Owner[];
  lines: Line[];
  /** Problems that did not block the filing, e.g. a malformed Table II row. */
  warnings: string[];
}

export type ParseResult = { ok: true; form4: ParsedForm4 } | { ok: false; error: string };
