# Submissions fixtures

Hand-written `CIK##########.json` files (synthetic issuers, made-up accession numbers) in the `filings.recent` shape. `primaryDocument` names a file in `tests/fixtures/form4/`, which the fake SEC server serves.

- `CIK0009000001.json` - three Form 4s (a cluster), an 8-K, and two Form 4s older than the 13-month window (never fetched).
- `CIK0009000006.json` - a Form 4 and its 4/A, plus a Form 3 (ignored).
- `CIK0009000011.json` - one Form 4 whose XML is malformed (stored as `parse_error`).
