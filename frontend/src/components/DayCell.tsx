import type { DailyStat } from "@/types/stats";

interface DayCellProps {
  day: number;
  stat?: DailyStat;
}

export function DayCell({ day, stat }: DayCellProps) {
  const hasTrades = (stat?.trade_count ?? 0) > 0;
  const pnl = stat?.pnl ?? 0;

  const colorClasses = !hasTrades
    ? "bg-zinc-50 border-zinc-200 text-zinc-400"
    : pnl > 0
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : pnl < 0
        ? "bg-red-50 border-red-200 text-red-900"
        : "bg-zinc-100 border-zinc-300 text-zinc-700";

  return (
    <div
      className={`flex aspect-square flex-col justify-between rounded-xl border p-2 transition-colors ${colorClasses}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium">{day}</span>
        {hasTrades && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-current opacity-60" />}
      </div>

      {hasTrades && stat && (
        <div className="space-y-0.5 overflow-hidden">
          <p className="truncate text-sm font-semibold leading-tight">
            {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(0)}
          </p>
          <p className="truncate text-[11px] leading-tight opacity-75">
            {stat.trade_count} {stat.trade_count === 1 ? "trade" : "trades"}
          </p>
          <p className="truncate text-[11px] leading-tight opacity-75">
            {(stat.win_rate * 100).toFixed(0)}% win
          </p>
        </div>
      )}
    </div>
  );
}
