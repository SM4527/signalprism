import type Database from "better-sqlite3";
import Decimal from "decimal.js";
import { z } from "zod";
import { FormError } from "@/lib/form-action";

/** Officer roles a rule can list. Directors and 10% owners have their own switches. */
export const RULE_ROLES = ["CEO", "CFO", "COO", "PRESIDENT", "OTHER_OFFICER"] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A decimal string, 0 or more, kept as text (never a JS number). */
const money = z
  .string()
  .trim()
  .refine((v) => {
    try {
      return new Decimal(v).gte(0);
    } catch {
      return false;
    }
  }, "must be a number, 0 or more")
  .transform((v) => new Decimal(v).toFixed());

const percent = money.refine((v) => new Decimal(v).lte(1000), "must be at most 1000");
const time = z.string().trim().regex(HHMM, "must be HH:MM, for example 22:00");

const ruleSchema = z.object({
  id: z.coerce.number().int().positive(),
  roles: z.array(z.enum(RULE_ROLES)).min(1, "pick at least one role"),
  minValue: money,
  minPct: percent,
  directorMinValue: money,
  includeDirectors: z.boolean(),
  includeTenPct: z.boolean(),
  pushOnCluster: z.boolean(),
  enabled: z.boolean(),
});

const notificationSchema = z
  .object({
    pushoverEnabled: z.boolean(),
    portfolioHint: z.enum(["off", "flag", "detail"]),
    quietStart: time.or(z.literal("")),
    quietEnd: time.or(z.literal("")),
    digest: z.boolean(),
    digestTime: time,
    dailyCap: z.coerce.number().int().min(1, "must be at least 1").max(100, "must be at most 100"),
  })
  .refine((v) => (v.quietStart === "") === (v.quietEnd === ""), { message: "set both quiet hours times, or neither", path: ["quietStart"] });

const text = (form: FormData, key: string) => String(form.get(key) ?? "");
const flag = (form: FormData, key: string) => form.get(key) === "on";

/** The first problem, as "field: message". */
function fail(e: z.ZodError): never {
  const issue = e.issues[0];
  throw new FormError(`${issue.path.join(".") || "form"}: ${issue.message}`);
}

/** Validate and store one alert rule from the Rules page form. Returns the message to show. */
export function saveRule(db: Database.Database, form: FormData): string {
  const parsed = ruleSchema.safeParse({
    id: text(form, "id"),
    roles: form.getAll("roles").map(String),
    minValue: text(form, "minValue"),
    minPct: text(form, "minPct"),
    directorMinValue: text(form, "directorMinValue"),
    includeDirectors: flag(form, "includeDirectors"),
    includeTenPct: flag(form, "includeTenPct"),
    pushOnCluster: flag(form, "pushOnCluster"),
    enabled: flag(form, "enabled"),
  });
  if (!parsed.success) fail(parsed.error);
  const r = parsed.data;
  const changed = db
    .prepare(
      `UPDATE alert_rule SET roles_json = ?, min_value = ?, min_pct = ?, director_min_value = ?, include_directors = ?,
              include_ten_pct = ?, push_on_cluster = ?, enabled = ? WHERE id = ?`,
    )
    .run(JSON.stringify(r.roles), r.minValue, r.minPct, r.directorMinValue, +r.includeDirectors, +r.includeTenPct, +r.pushOnCluster, +r.enabled, r.id).changes;
  if (changed !== 1) throw new FormError("id: no such rule");
  return "Rule saved. It applies to signals ingested from now on.";
}

/** Validate and store the notification settings. Returns the message to show. */
export function saveNotifications(db: Database.Database, form: FormData): string {
  const parsed = notificationSchema.safeParse({
    pushoverEnabled: flag(form, "pushoverEnabled"),
    portfolioHint: text(form, "portfolioHint"),
    quietStart: text(form, "quietStart"),
    quietEnd: text(form, "quietEnd"),
    digest: flag(form, "digest"),
    digestTime: text(form, "digestTime"),
    dailyCap: text(form, "dailyCap"),
  });
  if (!parsed.success) fail(parsed.error);
  const n = parsed.data;
  db.prepare(
    `UPDATE notification_config SET pushover_enabled = ?, portfolio_hint = ?, quiet_start = ?, quiet_end = ?,
            digest = ?, digest_time = ?, daily_cap = ? WHERE id = 1`,
  ).run(+n.pushoverEnabled, n.portfolioHint, n.quietStart || null, n.quietEnd || null, +n.digest, n.digestTime, n.dailyCap);
  return "Notification settings saved.";
}
