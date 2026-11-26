-- Failed Form 4 XML fetches per accession, tracked across polls; the third failure stores a parse_error row.
CREATE TABLE fetch_failure (
  accession_no TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0
);
