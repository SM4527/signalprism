import { describe, expect, it } from "vitest";
import { normalizeRole, type Role } from "@/lib/sec/roles";

const OFFICER = { isOfficer: true, isDirector: false, isTenPct: false };

const officerTitles: [string, Role][] = [
  ["Chief Executive Officer", "CEO"],
  ["CEO", "CEO"],
  ["President & CEO", "CEO"],
  ["President and Chief Executive Officer", "CEO"],
  ["Chairman and Chief Executive Officer", "CEO"],
  ["Co-CEO", "CEO"],
  ["Chief Financial Officer", "CFO"],
  ["EVP, Chief Financial Officer", "CFO"],
  ["EVP and CFO", "CFO"],
  ["Principal Financial Officer", "CFO"],
  ["SVP, Chief Financial Officer and Treasurer", "CFO"],
  ["Chief Operating Officer", "COO"],
  ["President and COO", "COO"],
  ["President", "PRESIDENT"],
  ["Vice President, Finance", "OTHER_OFFICER"],
  ["Senior Vice President", "OTHER_OFFICER"],
  ["EVP, General Counsel", "OTHER_OFFICER"],
  ["Chief Accounting Officer", "OTHER_OFFICER"],
  ["Principal Accounting Officer", "OTHER_OFFICER"],
  ["EVP, Chief Human Resources Off", "OTHER_OFFICER"],
  ["Chairman", "OTHER_OFFICER"],
  ["", "OTHER_OFFICER"],
];

describe("normalizeRole", () => {
  it.each(officerTitles)("officer title %j is %s", (title, role) => {
    expect(normalizeRole(title, OFFICER)).toBe(role);
  });

  it("treats a missing title on an officer as OTHER_OFFICER", () => {
    expect(normalizeRole(null, OFFICER)).toBe("OTHER_OFFICER");
  });

  it("director only is DIRECTOR", () => {
    expect(normalizeRole(null, { isOfficer: false, isDirector: true, isTenPct: false })).toBe("DIRECTOR");
  });

  it("10% owner only is HOLDER_10PCT", () => {
    expect(normalizeRole(null, { isOfficer: false, isDirector: false, isTenPct: true })).toBe("HOLDER_10PCT");
  });

  it("officer beats director beats 10% owner", () => {
    expect(normalizeRole("CFO", { isOfficer: true, isDirector: true, isTenPct: true })).toBe("CFO");
    expect(normalizeRole(null, { isOfficer: false, isDirector: true, isTenPct: true })).toBe("DIRECTOR");
  });

  it("an owner with only the isOther flag is OTHER", () => {
    expect(normalizeRole(null, { isOfficer: false, isDirector: false, isTenPct: false })).toBe("OTHER");
  });
});
