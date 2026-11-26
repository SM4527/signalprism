import Decimal from "decimal.js";

const ET = "America/New_York";

const etParts = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `2026-11-26 19:46 ET` for an ISO timestamp (the container runs UTC). A plain `YYYY-MM-DD` date is returned as is. */
export function formatEt(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const p = Object.fromEntries(etParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ET`;
}

/** `$1.2M`, `$250K`, `$900`. */
export function formatUsd(value: string): string {
  const v = new Decimal(value);
  if (v.gte(1_000_000)) return `$${v.div(1_000_000).toDecimalPlaces(1)}M`;
  if (v.gte(1_000)) return `$${v.div(1_000).toDecimalPlaces(0)}K`;
  return `$${v.toDecimalPlaces(0)}`;
}

/** Whole or fractional shares with thousands separators. */
export function formatShares(value: string): string {
  const [int, frac] = new Decimal(value).toFixed().split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
}

/** `+38.2%`, or "New position" when the holding was zero, or an em dash when unknown. */
export function formatIncrease(pct: string | null, newPosition: boolean): string {
  if (newPosition) return "New position";
  return pct === null ? "—" : `+${new Decimal(pct).toDecimalPlaces(1)}%`;
}
