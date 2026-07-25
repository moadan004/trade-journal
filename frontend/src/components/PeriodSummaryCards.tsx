import { StatCard } from "@/components/StatCard";
import type { SummaryStatsResponse } from "@/types/summary";

interface PeriodSummaryCardsProps {
  week: SummaryStatsResponse | null;
  month: SummaryStatsResponse | null;
}

function pnlClass(pnl: number): string {
  return pnl > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : pnl < 0
      ? "text-red-600 dark:text-red-400"
      : "text-zinc-500 dark:text-zinc-400";
}

function formatPnl(pnl: number): string {
  return `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`;
}

export function PeriodSummaryCards({ week, month }: PeriodSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <StatCard
        label="This week's P&L"
        value={formatPnl(week?.total_pnl ?? 0)}
        valueClassName={pnlClass(week?.total_pnl ?? 0)}
        sub={`${week?.trade_count ?? 0} ${(week?.trade_count ?? 0) === 1 ? "trade" : "trades"}`}
      />
      <StatCard
        label="This month's P&L"
        value={formatPnl(month?.total_pnl ?? 0)}
        valueClassName={pnlClass(month?.total_pnl ?? 0)}
        sub={`${month?.trade_count ?? 0} ${(month?.trade_count ?? 0) === 1 ? "trade" : "trades"}`}
      />
    </div>
  );
}
