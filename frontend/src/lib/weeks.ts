import { formatDateParam } from "@/lib/calendar";

/**
 * Monday-based week helpers for /reviews.
 *
 * Deliberately Monday-based to match the backend, which normalizes every
 * WeeklyReview to that week's Monday. Note this differs from
 * `getThisWeekRange` in lib/dateRanges.ts, which is Sunday-based and drives
 * the dashboard's "this week's P&L" card - a pre-existing inconsistency this
 * file does not try to resolve, since changing the dashboard's week boundary
 * would silently shift a number people already read.
 */

function toParam(d: Date): string {
  return formatDateParam(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** The Monday of the week containing `d`, at local midnight. */
export function mondayOf(d: Date): Date {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay() is 0=Sunday..6=Saturday; Sunday belongs to the week that started
  // six days earlier, not the one about to start.
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return monday;
}

export function addWeeks(monday: Date, weeks: number): Date {
  const next = new Date(monday);
  next.setDate(next.getDate() + weeks * 7);
  return next;
}

export function sundayOf(monday: Date): Date {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return sunday;
}

/** Stats range for a week: Monday inclusive, following Monday exclusive. */
export function weekStatsRange(monday: Date): { start: string; end: string } {
  return { start: toParam(monday), end: toParam(addWeeks(monday, 1)) };
}

/** `YYYY-MM-DD` for the week's Monday - the path param every /reviews route takes. */
export function weekParam(monday: Date): string {
  return toParam(monday);
}

export function formatWeekLabel(monday: Date): string {
  const sunday = sundayOf(monday);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const monthDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const dayOnly = (d: Date) => d.toLocaleDateString("en-US", { day: "numeric" });
  return `${monthDay(monday)} – ${sameMonth ? dayOnly(sunday) : monthDay(sunday)}, ${sunday.getFullYear()}`;
}

export function isSameWeek(a: Date, b: Date): boolean {
  return mondayOf(a).getTime() === mondayOf(b).getTime();
}
