import { DEFAULT_SEC_ARCHIVES_URL } from "./hosts.ts";

/** The filing index page on sec.gov. A plain link for the browser; no request is made from here. */
export const filingIndexUrl = (issuerCik: string, accession: string, base = DEFAULT_SEC_ARCHIVES_URL) =>
  `${base}/Archives/edgar/data/${Number(issuerCik)}/${accession.replaceAll("-", "")}/${accession}-index.htm`;
