export const ROLES = [
  "CEO", "CFO", "COO", "PRESIDENT", "OTHER_OFFICER", "DIRECTOR", "HOLDER_10PCT", "OTHER",
] as const;
export type Role = (typeof ROLES)[number];

export interface OwnerFlags {
  isOfficer: boolean;
  isDirector: boolean;
  isTenPct: boolean;
}

const CEO = /\bchief\s+executive\b|\bceo\b|\bprincipal\s+executive\b/i;
const CFO = /\bchief\s+financial\b|\bcfo\b|\bprincipal\s+financial\b/i;
const COO = /\bchief\s+operating\b|\bcoo\b/i;
const PRESIDENT = /(^|[^a-z])president\b/i;
const VICE_PRESIDENT = /\bvice[\s-]+president\b|\bvp\b|\bsvp\b|\bevp\b/i;

/** Map a free-text officer title to a role; null when the title is not a named C-level or president. */
function officerRole(title: string): Role | null {
  if (CEO.test(title)) return "CEO";
  if (CFO.test(title)) return "CFO";
  if (COO.test(title)) return "COO";
  const withoutVp = title.replace(VICE_PRESIDENT, "");
  if (PRESIDENT.test(withoutVp)) return "PRESIDENT";
  return null;
}

/** Normalize an owner to one role. Officer beats director beats 10% owner; no flag at all is OTHER. */
export function normalizeRole(title: string | null, flags: OwnerFlags): Role {
  if (flags.isOfficer) return officerRole(title ?? "") ?? "OTHER_OFFICER";
  if (flags.isDirector) return "DIRECTOR";
  if (flags.isTenPct) return "HOLDER_10PCT";
  return "OTHER";
}
