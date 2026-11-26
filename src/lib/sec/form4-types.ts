import type { Role } from "./roles";

/** One transaction line. Shares, prices and holdings are decimal strings, never numbers. */
export interface Line {
  table: 1 | 2;
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
}

export type ParseResult = { ok: true; form4: ParsedForm4 } | { ok: false; error: string };
