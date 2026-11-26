import type Database from "better-sqlite3";
import Decimal from "decimal.js";
import { personKey, type SignalRow } from "./issuer-rows";

interface FilingOwner {
  filing_id: number;
  form_type: "4" | "4/A";
  filed_at: string;
  period: string | null;
  original_date: string | null;
  person: string;
}

const before = (a: FilingOwner, b: FilingOwner) =>
  a.filed_at < b.filed_at || (a.filed_at === b.filed_at && a.filing_id < b.filing_id);
const latest = (xs: FilingOwner[]) => xs.sort((a, b) => (before(a, b) ? 1 : -1))[0];

/**
 * The original a 4/A amends, for one person. With `dateOfOriginalSubmission`, the earlier filing made on
 * that date (preferring the same period). Otherwise the most recent earlier filing with the same period.
 */
function findOriginal(amend: FilingOwner, all: FilingOwner[]): FilingOwner | undefined {
  const earlier = all.filter((f) => f.person === amend.person && before(f, amend));
  if (amend.original_date) {
    const onDate = earlier.filter((f) => f.filed_at === amend.original_date);
    const samePeriod = onDate.filter((f) => f.period === amend.period);
    if (onDate.length) return latest(samePeriod.length ? samePeriod : onDate);
  }
  return amend.period ? latest(earlier.filter((f) => f.period === amend.period)) : undefined;
}

function loadFilingOwners(db: Database.Database, issuerCik: string): FilingOwner[] {
  const rows = db
    .prepare(
      `SELECT f.id AS filing_id, f.form_type, f.filed_at, f.period_of_report AS period,
              f.original_submission_date AS original_date, o.owner_cik, o.owner_name
       FROM filing f JOIN reporting_owner o ON o.filing_id = f.id
       WHERE f.issuer_cik = ? AND f.parse_error IS NULL`,
    )
    .all(issuerCik) as (Omit<FilingOwner, "person"> & { owner_cik: string | null; owner_name: string })[];
  return rows.map(({ owner_cik, owner_name, ...f }) => ({ ...f, person: personKey({ owner_cik, owner_name }) }));
}

/**
 * Recompute amendments for one issuer from scratch. Each 4/A supersedes the one original it names (per
 * person). The original's signal is replaced by the 4/A's signal when it has one; a 4/A with no
 * qualifying purchase just removes it. Returns, per amending signal id, the signal it replaced.
 */
export function recomputeSupersession(
  db: Database.Database,
  issuerCik: string,
  rows: SignalRow[],
): Map<number, SignalRow> {
  const all = loadFilingOwners(db, issuerCik);
  const find = (filingId: number, person: string) =>
    rows.find((r) => r.filing_id === filingId && personKey(r) === person);

  for (const r of rows) {
    r.superseded_by = null;
    r.superseded_by_filing = null;
  }
  const replaced = new Map<number, SignalRow>();
  const amendments = all.filter((f) => f.form_type === "4/A").sort((a, b) => (before(a, b) ? -1 : 1));
  for (const amend of amendments) {
    const original = findOriginal(amend, all);
    if (!original) continue;
    db.prepare("UPDATE filing SET amends_id = ? WHERE id = ?").run(original.filing_id, amend.filing_id);
    const old = find(original.filing_id, amend.person);
    if (!old) continue;
    const replacement = find(amend.filing_id, amend.person);
    old.superseded_by_filing = amend.filing_id;
    old.superseded_by = replacement?.id ?? null;
    if (replacement) replaced.set(replacement.id, old);
  }

  const set = db.prepare("UPDATE signal SET superseded_by = ?, superseded_by_filing_id = ? WHERE id = ?");
  for (const r of rows) set.run(r.superseded_by, r.superseded_by_filing, r.id);
  return replaced;
}

/** Push again only when the amended value is unknown before or moves by more than 20%. */
export function repushOnAmendment(old: SignalRow | undefined, after: SignalRow): boolean {
  if (!old?.value) return true;
  const was = new Decimal(old.value);
  if (was.isZero()) return true;
  return new Decimal(after.value).minus(was).abs().div(was).gt("0.2");
}
