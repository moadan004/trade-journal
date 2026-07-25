"use client";

import { DayCell } from "@/components/DayCell";
import { formatDateParam, getCalendarCells } from "@/lib/calendar";
import { useSwipe } from "@/lib/useSwipe";
import type { DailyStat } from "@/types/stats";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarGridProps {
  year: number;
  month: number;
  statsByDate: Map<string, DailyStat>;
  onDayClick: (date: string) => void;
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
}

export function CalendarGrid({
  year,
  month,
  statsByDate,
  onDayClick,
  onSwipeNext,
  onSwipePrev,
}: CalendarGridProps) {
  const cells = getCalendarCells(year, month);
  const swipeHandlers = useSwipe(
    () => onSwipeNext?.(),
    () => onSwipePrev?.(),
  );

  return (
    <div {...swipeHandlers} data-testid="calendar-swipe-area">
      <div className="mb-2 grid grid-cols-7 gap-1 sm:gap-2">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[10px] font-medium uppercase tracking-wide text-zinc-400 sm:text-xs dark:text-zinc-500"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-2">
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
