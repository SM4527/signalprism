import { formatEt } from "@/lib/format";
import { addDays } from "@/lib/signals/dates";

/** Eastern wall-clock time: `date` is `YYYY-MM-DD`, `minutes` since midnight. */
export interface EtTime {
  date: string;
  minutes: number;
}

export function etTime(iso: string): EtTime {
  const s = formatEt(iso);
  return { date: s.slice(0, 10), minutes: parseInt(s.slice(11, 13), 10) * 60 + parseInt(s.slice(14, 16), 10) };
}

/** `HH:MM` to minutes since midnight. */
export const toMinutes = (hhmm: string): number => parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3, 5), 10);

const pad = (n: number) => String(n).padStart(2, "0");
const wall = (t: EtTime) => `${t.date} ${pad(Math.floor(t.minutes / 60))}:${pad(t.minutes % 60)}`;

/** Quiet hours `[start, end)` in ET, wrapping midnight when start is after end. Off when either is missing or they are equal. */
export function inQuietHours(start: string | null, end: string | null, minutes: number): boolean {
  if (!start || !end) return false;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** True once `now` has reached the first `at` (`HH:MM` ET) after `created`. Wall-clock strings compare in order. */
export function dueAfter(createdIso: string, at: string, now: EtTime): boolean {
  const created = etTime(createdIso);
  const target = toMinutes(at);
  const due: EtTime = created.minutes < target ? { date: created.date, minutes: target } : { date: addDays(created.date, 1), minutes: target };
  return wall(now) >= wall(due);
}
