import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseForm4 } from "@/lib/sec/form4-parser";

const DIR = join(process.cwd(), "tests", "fixtures", "form4");

export function fixtureXml(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

/** Parse a fixture and fail the test with the parse error if it is not ok. */
export function loadForm4(name: string) {
  const r = parseForm4(fixtureXml(name));
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.form4;
}
