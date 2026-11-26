import { z } from "zod";

const schema = z.object({
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()),
      filingDate: z.array(z.string()),
      form: z.array(z.string()),
      primaryDocument: z.array(z.string()),
    }),
  }),
});

export interface Form4Entry {
  accession: string;
  /** `YYYY-MM-DD`. */
  filedAt: string;
  /** Raw XML file name (the `xslF345X05/` rendering prefix removed), or null when the entry has none. */
  doc: string | null;
}

export const submissionsUrl = (base: string, cik: string) => `${base}/submissions/CIK${cik.padStart(10, "0")}.json`;

export const form4Url = (base: string, cik: string, accession: string, doc: string) =>
  `${base}/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/${doc}`;

/** Form 4 and 4/A entries filed on or after `since`, from a submissions JSON body. Throws on a surprise shape. */
export function form4Entries(body: string, since: string): Form4Entry[] {
  const r = schema.parse(JSON.parse(body)).filings.recent;
  return r.accessionNumber.flatMap((accession, i) => {
    const filedAt = r.filingDate[i];
    if ((r.form[i] !== "4" && r.form[i] !== "4/A") || filedAt < since) return [];
    const doc = r.primaryDocument[i].split("/").pop() ?? "";
    return [{ accession, filedAt, doc: doc.endsWith(".xml") ? doc : null }];
  });
}
