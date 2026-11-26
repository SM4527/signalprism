import type Database from "better-sqlite3";
import { fixtureXml } from "../sec/fixtures";
import type { IngestInput } from "@/lib/ingest";

export function input(file: string, accession: string, filedAt: string, issuerCik = "0000000000"): IngestInput {
  return { accession, filedAt, issuerCik, xml: fixtureXml(file) };
}

/** Everything recompute owns, keyed by accession so row ids do not matter. */
export function snapshot(db: Database.Database) {
  const signals = db
    .prepare(
      `SELECT f.accession_no AS acc, o.owner_name AS owner, s.score, s.score_parts_json AS parts,
              (SELECT f2.accession_no FROM signal s2 JOIN filing f2 ON f2.id = s2.filing_id
               WHERE s2.id = s.superseded_by) AS superseded_by,
              (SELECT f3.accession_no FROM filing f3 WHERE f3.id = s.superseded_by_filing_id) AS superseded_by_filing
       FROM signal s JOIN filing f ON f.id = s.filing_id JOIN reporting_owner o ON o.id = s.owner_id
       ORDER BY acc, owner`,
    )
    .all();
  const clusters = db
    .prepare(
      `SELECT c.issuer_cik, c.window_start, c.window_end, c.insider_count, c.total_value,
              (SELECT group_concat(f.accession_no) FROM
                 (SELECT f.accession_no FROM cluster_member m JOIN signal s ON s.id = m.signal_id
                  JOIN filing f ON f.id = s.filing_id WHERE m.cluster_id = c.id ORDER BY f.accession_no) f) AS members
       FROM cluster c ORDER BY c.issuer_cik, c.window_start`,
    )
    .all();
  return { signals, clusters };
}

/** The ACME cluster fixtures plus the amendment pair, with filing dates. */
export const FIXTURES = [
  input("synthetic_ceo_multi_p.xml", "A-1", "2026-11-06"),
  input("synthetic_p_mixed_codes.xml", "A-2", "2026-11-10"),
  input("synthetic_cluster_director.xml", "A-3", "2026-11-17"),
  input("synthetic_amendment_original.xml", "F-1", "2026-10-22"),
  input("synthetic_amendment_4a.xml", "F-2", "2026-10-26"),
];
