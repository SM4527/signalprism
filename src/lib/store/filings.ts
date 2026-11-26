import { toId } from "./rowid";
import type Database from "better-sqlite3";
import type { ParsedForm4 } from "@/lib/sec/form4-types";
import { normalizeTicker } from "@/lib/sec/ticker";

export interface SavedFiling {
  filingId: number;
  /** reporting_owner ids in the same order as `form.owners`. */
  ownerIds: number[];
  isNew: boolean;
}

/** Store a parse failure on the filing so it is counted and never retried. */
export function saveParseError(
  db: Database.Database,
  accession: string,
  issuerCik: string,
  filedAt: string,
  error: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO filing (accession_no, form_type, issuer_cik, filed_at, parse_error)
     VALUES (?, '4', ?, ?, ?)`,
  ).run(accession, issuerCik, filedAt, error);
}

/** Store a parsed filing with its owners and every line (audit). Idempotent on accession. */
export function saveFiling(
  db: Database.Database,
  accession: string,
  filedAt: string,
  form: ParsedForm4,
): SavedFiling {
  const existing = db
    .prepare("SELECT id FROM filing WHERE accession_no = ?")
    .pluck()
    .get(accession) as number | undefined;
  if (existing !== undefined) return { filingId: existing, ownerIds: [], isNew: false };

  const ticker = normalizeTicker(form.tickerRaw, form.issuerCik);
  const filingId = toId(
    db
      .prepare(
        `INSERT INTO filing (accession_no, form_type, issuer_cik, ticker, filed_at, period_of_report,
                             original_submission_date, parse_warning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        accession, form.formType, form.issuerCik, ticker, filedAt, form.periodOfReport,
        form.originalSubmissionDate, form.warnings.join("; ") || null,
      )
      .lastInsertRowid,
  );

  const insertOwner = db.prepare(
    `INSERT INTO reporting_owner
       (filing_id, owner_cik, owner_name, is_officer, is_director, is_ten_pct, officer_title_raw, role, joint_group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ownerIds = form.owners.map((o) =>
    toId(
      insertOwner.run(
        filingId, o.cik, o.name, +o.isOfficer, +o.isDirector, +o.isTenPct, o.titleRaw, o.role, o.jointGroupId,
      ).lastInsertRowid,
    ),
  );

  const insertLine = db.prepare(
    `INSERT INTO transaction_line
       (filing_id, owner_id, seq, table_no, security_title, code, txn_date, shares, price,
        acquired_disposed, owned_after, ownership_form, nature_of_ownership, plan_10b51, footnotes_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const l of form.lines) {
    insertLine.run(
      filingId, ownerIds[0], l.seq, l.table, l.securityTitle, l.code, l.txnDate, l.shares, l.price,
      l.acquiredDisposed, l.ownedAfter, l.ownershipForm, l.nature, +form.plan10b51,
      JSON.stringify(l.footnotes),
    );
  }
  return { filingId, ownerIds, isNew: true };
}
