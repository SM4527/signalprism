/** Add calendar days to a `YYYY-MM-DD` date (UTC). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Subtract calendar months from a `YYYY-MM-DD` date (UTC); the day is kept when the month has it. */
export function monthsBefore(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
