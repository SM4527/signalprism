import { HOLIDAYS } from "./holidays";

const DAY_MS = 86_400_000;

/** Parse `YYYY-MM-DD` as a UTC date. */
function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function isBusinessDay(iso: string): boolean {
  const weekday = utc(iso).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(iso);
}

/** Business days in (txnDate, filedAt]: the transaction day itself does not count. */
export function lagDays(txnDate: string, filedAt: string): number {
  let count = 0;
  const end = utc(filedAt).getTime();
  for (let t = utc(txnDate).getTime() + DAY_MS; t <= end; t += DAY_MS) {
    if (isBusinessDay(new Date(t).toISOString().slice(0, 10))) count++;
  }
  return count;
}

/** A Form 4 is due two business days after the transaction. */
export function isLate(lag: number): boolean {
  return lag > 2;
}
