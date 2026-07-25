import { getMonthLabel } from "@/lib/calendar";

interface MonthStatsHeaderProps {
  year: number;
  month: number;
  totalPnl: number;
  tradingDays: number;
  onPrev: () => void;
  onNext: () => void;
}

export function MonthStatsHeader({
  year,
  month,
  totalPnl,
  tradingDays,
  onPrev,
  onNext,
}: MonthStatsHeaderProps) {
  const pnlColor =
    totalPnl > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : totalPnl < 0
        ? "text-red-600 dark:text-red-400"
        : "text-zinc-500 dark:text-zinc-400";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous month"
          className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          &#8592;
        </button>
        <h2 className="min-w-[10rem] text-center text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {getMonthLabel(year, month)}
        </h2>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next month"
          className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          &#8594;
        </button>
      </div>

      <div className="flex gap-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Monthly P&amp;L</p>
          <p className={`text-lg font-semibold ${pnlColor}`}>
            {totalPnl >= 0 ? "+" : "-"}${Math.abs(totalPnl).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Trading Days</p>
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{tradingDays}</p>
        </div>
      </div>
    </div>
  );
}
