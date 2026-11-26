import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");
const ENTRY = /^(page|layout|route)\.tsx?$/;
const READS_DB = /@\/lib\/db|@\/lib\/queries\//;
const FORCE_DYNAMIC = /export const dynamic\s*=\s*["']force-dynamic["']/;

function entries(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? entries(join(dir, e.name)) : ENTRY.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe("pages that read the DB are never prerendered", () => {
  const files = entries(APP).filter((f) => READS_DB.test(readFileSync(f, "utf8")));

  it("finds the DB-reading pages", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files.map((f) => [f.slice(APP.length + 1), f]))("%s exports dynamic = force-dynamic", (_name, file) => {
    expect(readFileSync(file, "utf8")).toMatch(FORCE_DYNAMIC);
  });
});
