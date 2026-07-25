import { formatDateParam } from "@/lib/calendar";

export type DateRangePreset = "30d" | "90d" | "this_month" | "all_time";

export interface DateRange {
  start?: string;
  end?: string;
}

function toParam(d: Date): string {
  return formatDateParam(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function daysBefore(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d;
}

/** End-exclusive upper bound that still includes all of `from`'s calendar day. */
function endExclusive(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  return d;
}

export function getPresetRange(preset: DateRangePreset, today: Date): DateRange {
  switch (preset) {
    case "30d":
      return { start: toParam(daysBefore(today, 30)), end: toParam(endExclusive(today)) };
    case "90d":
      return { start: toParam(daysBefore(today, 90)), end: toParam(endExclusive(today)) };
    case "this_month":
      return {
        start: toParam(new Date(today.getFullYear(), today.getMonth(), 1)),
        end: toParam(endExclusive(today)),
      };
    case "all_time":
    default:
      return {};
  }
}

export function getThisWeekRange(today: Date): Required<DateRange> {
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay());
  return { start: toParam(start), end: toParam(endExclusive(today)) };
}

export function getThisMonthRange(today: Date): Required<DateRange> {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { start: toParam(start), end: toParam(endExclusive(today)) };
}
