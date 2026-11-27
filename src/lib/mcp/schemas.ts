import { z } from "zod";
import { ROLES } from "@/lib/sec/roles";

/**
 * Response contract of `/api/mcp/*`. The prism-mcp repo mirrors these schemas.
 * Units: money is US dollars and percentages are percent, both as decimal strings; dates are ET.
 */

const usd = (what: string) => z.string().describe(`${what}, US dollars, decimal string`);
const etDate = (what: string) => z.string().describe(`${what}, YYYY-MM-DD, Eastern Time`);
const etTime = (what: string) => z.string().describe(`${what}, "YYYY-MM-DD HH:MM ET", Eastern Time`);

const asOf = etTime("When this response was produced");
const role = z.enum(ROLES);
const heldVia = z.enum(["direct", "funds"]).nullable().describe("How the stock is held now in the portfolio, or null; never amounts");
const mode = z.enum(["sample", "personal"]);

export const ScorePart = z.strictObject({ label: z.string(), points: z.number().int() });

export const SignalItem = z.strictObject({
  ticker: z.string().nullable(),
  company: z.string().nullable(),
  insiders: z.array(z.string()).describe("Owner names; more than one for a joint filing"),
  role: role.describe("Highest role among the owners"),
  title_raw: z.string().nullable().describe("Officer title as filed"),
  shares: z.string().describe("Shares bought, decimal string"),
  value_usd: usd("Total value of the open-market purchase lines (shares x price)"),
  avg_price: usd("Weighted average price per share"),
  pct_increase: z
    .string()
    .nullable()
    .describe('Holdings increase as a percentage string: "4.1553" means 4.1553%, not 0.041553; null when unknown or new position'),
  new_position: z.boolean().describe("True when the insider held nothing of this security before; pct_increase is then null"),
  txn_date: etDate("Earliest purchase date"),
  filed_at: etDate("SEC filing date"),
  form_type: z.string().describe('"4" or "4/A"'),
  score: z.number().int(),
  score_parts: z.array(ScorePart).describe("Score breakdown; the points sum to score"),
  badges: z.array(z.string()).describe("late, indirect, non-common, plan:<kind>, plan-suspected, cluster"),
  rule_match: z.boolean().describe("Matches the default alert rule"),
  held_via: heldVia,
  sec_url: z.string().describe("Link to the filing index on sec.gov"),
});

export const SignalsResponse = z.strictObject({
  as_of: asOf,
  filters: z.strictObject({
    days: z.number().int().describe("Filed within this many days before today (ET)"),
    min_score: z.number().int(),
    role: role.nullable(),
    held_only: z.boolean(),
    include_plan: z.boolean().describe("Include plan buys (10b5-1, ESPP, DRIP, 401(k)); off by default"),
  }),
  count: z.number().int(),
  truncated: z.boolean().describe("True when the 200-row cap was reached, so older or lower rows may be missing"),
  signals: z.array(SignalItem),
});

export const ClusterMember = z.strictObject({
  insider: z.string(),
  role,
  value_usd: usd("Value of this insider's purchase"),
  txn_date: etDate("Purchase date"),
});

export const ClusterItem = z.strictObject({
  ticker: z.string().nullable(),
  company: z.string().nullable(),
  window_start: etDate("First purchase in the cluster"),
  window_end: etDate("Last purchase in the cluster"),
  insider_count: z.number().int().describe("Distinct insiders; at least 2, at least one officer"),
  total_value_usd: usd("Total value of all member purchases"),
  held_via: heldVia,
  members: z.array(ClusterMember),
});

export const ClustersResponse = z.strictObject({
  as_of: asOf,
  filters: z.strictObject({ days: z.number().int().describe("Window ended within this many days before today (ET)") }),
  clusters: z.array(ClusterItem),
});

export const TickerResponse = z.strictObject({
  as_of: asOf,
  ticker: z.string(),
  company: z.string().nullable(),
  held_via: heldVia,
  since: etDate("Signals filed on or after this date (last 12 months)"),
  plan_count: z.number().int().describe("How many of the signals are plan buys"),
  signals: z.array(SignalItem).describe("Includes plan buys, flagged by a plan:<kind> badge"),
  clusters: z.array(ClusterItem),
});

export const StatusResponse = z.strictObject({
  as_of: asOf,
  stack: mode.describe("sample (mock data) or personal"),
  companies_watched: z.number().int(),
  last_poll: z
    .strictObject({
      started_at: etTime("Poll start"),
      finished_at: etTime("Poll end").nullable(),
      new_filings: z.number().int(),
      new_signals: z.number().int(),
      errors: z.number().int(),
    })
    .nullable(),
  paused_until: etTime("SEC polling is paused until").nullable(),
  parse_errors: z.number().int().describe("Filings stored with a parse error"),
});

export type SignalItem = z.infer<typeof SignalItem>;
export type SignalsResponse = z.infer<typeof SignalsResponse>;
export type ClusterItem = z.infer<typeof ClusterItem>;
export type ClustersResponse = z.infer<typeof ClustersResponse>;
export type TickerResponse = z.infer<typeof TickerResponse>;
export type StatusResponse = z.infer<typeof StatusResponse>;
