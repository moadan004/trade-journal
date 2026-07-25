import type { DailyStat } from "@/types/stats";

interface DayCellProps {
  day: number;
  stat?: DailyStat;
  onClick?: () => void;
}

export function DayCell({ day, stat, onClick }: DayCellProps) {
  const hasTrades = (stat?.trade_count ?? 0) > 0;
  const pnl = stat?.pnl ?? 0;

  const colorClasses = !hasTrades
    ? "bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-600"
    : pnl > 0
      ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900/60 dark:text-emerald-300"
      : pnl < 0
        ? "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-300"
        : "bg-zinc-100 border-zinc-300 text-zinc-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex aspect-square flex-col justify-between rounded-lg border p-1 text-left transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-zinc-400 sm:rounded-xl sm:p-2 dark:hover:brightness-110 dark:focus:ring-zinc-600 ${colorClasses}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-medium sm:text-xs">{day}</span>
        {hasTrades && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-current opacity-60" />}
      </div>

      {hasTrades && stat && (
        <div className="space-y-0.5 overflow-hidden">
          <p className="truncate text-xs font-semibold leading-tight sm:text-sm">
            {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(0)}
          </p>
          <p className="hidden truncate text-[11px] leading-tight opacity-75 sm:block">
            {stat.trade_count} {stat.trade_count === 1 ? "trade" : "trades"}
          </p>
          <p className="hidden truncate text-[11px] leading-tight opacity-75 sm:block">
            {(stat.win_rate * 100).toFixed(0)}% win
          </p>
        </div>
      )}
    </button>
  );
}
