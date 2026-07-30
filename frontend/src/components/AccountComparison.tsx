"use client";

import type { AccountSummary } from "@/types/summary";

interface AccountComparisonProps {
  accounts: AccountSummary[];
}

function pnlClass(value: number): string {
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-zinc-500 dark:text-zinc-400";
}

/**
 * Side-by-side per-account cards for the selected period.
 *
 * The best and worst performer are marked so the comparison reads at a glance
 * instead of requiring you to scan the numbers - which is the whole point of
 * putting them side by side.
 */
export function AccountComparison({ accounts }: AccountComparisonProps) {
  if (accounts.length === 0) return null;

  const traded = accounts.filter((a) => a.trade_count > 0);
  // Only worth flagging when there's an actual comparison to make.
  const best = traded.length > 1 ? Math.max(...traded.map((a) => a.total_pnl)) : null;
  const worst = traded.length > 1 ? Math.min(...traded.map((a) => a.total_pnl)) : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((account) => {
        const isBest = best !== null && account.trade_count > 0 && account.total_pnl === best;
        const isWorst = worst !== null && account.trade_count > 0 && account.total_pnl === worst && !isBest;

        return (
          <div
            key={account.account_id}
            className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {account.account_name}
              </h4>
              {isBest && (
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                  Best
                </span>
              )}
              {isWorst && (
                <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/60 dark:text-red-400">
                  Worst
                </span>
              )}
            </div>

            <p className={`mt-2 text-2xl font-semibold tabular-nums ${pnlClass(account.total_pnl)}`}>
              {account.total_pnl >= 0 ? "+" : "-"}${Math.abs(account.total_pnl).toFixed(2)}
            </p>

            {account.trade_count === 0 ? (
              // Kept visible rather than dropped: "I haven't traded this account
              // this period" is itself worth seeing in a comparison.
              <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">No trades in this period.</p>
            ) : (
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-zinc-400 dark:text-zinc-500">Win rate</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {(account.win_rate * 100).toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-400 dark:text-zinc-500">Trades</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {account.trade_count}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-400 dark:text-zinc-500">Profit factor</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {account.profit_factor != null ? account.profit_factor.toFixed(2) : "—"}
                  </dd>
                </div>
              </dl>
            )}

            {account.trade_count > 0 && (
              <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                {account.win_count}W / {account.loss_count}L / {account.breakeven_count}BE
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
