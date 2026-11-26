import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Line, Owner, ParseResult } from "./form4-types";
import { form4Schema, type RawTx } from "./form4-schema";
import { normalizeRole } from "./roles";

const ARRAY_TAGS = new Set([
  "reportingOwner", "nonDerivativeTransaction", "derivativeTransaction", "footnote", "footnoteId",
]);

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

const isTrue = (s: string | undefined) => s === "1" || s?.toLowerCase() === "true";

type ValueNode = "" | { value?: string } | undefined;
const val = (n: ValueNode): string | null => (n && n.value ? n.value : null);

/** Collect every `<footnoteId id=..>` anywhere inside a node. */
function footnoteIds(node: unknown): string[] {
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, child]) =>
    key === "footnoteId"
      ? (child as { "@_id": string }[]).map((f) => f["@_id"])
      : footnoteIds(child),
  );
}

function toLine(t: RawTx, table: 1 | 2, seq: number, notes: Map<string, string>): Line {
  return {
    table,
    seq,
    securityTitle: val(t.securityTitle) ?? "",
    code: t.transactionCoding.transactionCode,
    txnDate: (val(t.transactionDate) ?? "").slice(0, 10),
    shares: val(t.transactionAmounts?.transactionShares),
    price: val(t.transactionAmounts?.transactionPricePerShare),
    acquiredDisposed: val(t.transactionAmounts?.transactionAcquiredDisposedCode),
    ownedAfter: val(t.postTransactionAmounts?.sharesOwnedFollowingTransaction),
    ownershipForm: val(t.ownershipNature?.directOrIndirectOwnership),
    nature: val(t.ownershipNature?.natureOfOwnership) ?? "",
    footnotes: footnoteIds(t).flatMap((id) => notes.get(id) ?? []),
  };
}

/** Parse a Form 4 or 4/A XML document. Never throws: a surprise becomes `{ ok: false }`. */
export function parseForm4(source: string): ParseResult {
  const valid = XMLValidator.validate(source);
  if (valid !== true) return { ok: false, error: `malformed xml: ${valid.err.msg}` };

  const parsed = form4Schema.safeParse(xml.parse(source));
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const doc = parsed.data.ownershipDocument;

  const notes = new Map<string, string>();
  if (doc.footnotes) for (const f of doc.footnotes.footnote) notes.set(f["@_id"], f["#text"] ?? "");

  const lines = [
    ...(doc.nonDerivativeTable === "" ? [] : doc.nonDerivativeTable?.nonDerivativeTransaction ?? []).map(
      (t, i) => toLine(t, 1, i, notes),
    ),
    ...(doc.derivativeTable === "" ? [] : doc.derivativeTable?.derivativeTransaction ?? []).map(
      (t, i) => toLine(t, 2, i, notes),
    ),
  ];

  const joint = doc.reportingOwner.length > 1;
  const owners: Owner[] = doc.reportingOwner.map((o) => {
    const rel = o.reportingOwnerRelationship;
    const flags = {
      isOfficer: isTrue(rel?.isOfficer),
      isDirector: isTrue(rel?.isDirector),
      isTenPct: isTrue(rel?.isTenPercentOwner),
    };
    const titleRaw = rel?.officerTitle || null;
    return {
      cik: o.reportingOwnerId.rptOwnerCik || null,
      name: o.reportingOwnerId.rptOwnerName,
      ...flags,
      titleRaw,
      role: normalizeRole(titleRaw, flags),
      jointGroupId: null,
    };
  });
  if (joint) {
    const id = `joint:${owners.map((o) => o.cik ?? o.name).sort().join("+")}`;
    for (const o of owners) o.jointGroupId = id;
  }

  const plan10b51 = isTrue(doc.aff10b5One);
  const mentions10b5 = [...notes.values()].some((n) => /10b5-1/i.test(n));

  return {
    ok: true,
    form4: {
      formType: doc.documentType,
      periodOfReport: doc.periodOfReport ?? null,
      originalSubmissionDate: doc.dateOfOriginalSubmission?.slice(0, 10) ?? null,
      issuerCik: doc.issuer.issuerCik,
      issuerName: doc.issuer.issuerName ?? null,
      tickerRaw: doc.issuer.issuerTradingSymbol ?? null,
      plan10b51,
      planSuspected: !plan10b51 && mentions10b5,
      owners,
      lines,
    },
  };
}
