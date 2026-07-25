import { DayCell } from "@/components/DayCell";
import { formatDateParam, getCalendarCells } from "@/lib/calendar";
import type { DailyStat } from "@/types/stats";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarGridProps {
  year: number;
  month: number;
  statsByDate: Map<string, DailyStat>;
  onDayClick: (date: string) => void;
}

export function CalendarGrid({ year, month, statsByDate, onDayClick }: CalendarGridProps) {
  const cells = getCalendarCells(year, month);

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-2">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-xs font-medium uppercase tracking-wide text-zinc-400"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} className="aspect-square" />;
          const dateStr = formatDateParam(year, month, day);
          return (
            <DayCell
              key={dateStr}
              day={day}
              stat={statsByDate.get(dateStr)}
              onClick={() => onDayClick(dateStr)}
            />
          );
        })}
      </div>
    </div>
  );
}
