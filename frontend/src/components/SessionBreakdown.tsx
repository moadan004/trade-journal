"use client";

import type { SessionStat } from "@/types/summary";

interface SessionBreakdownProps {
  sessions: SessionStat[];
}

function formatHours(start: number, end: number): string {
  const pad = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  return `${pad(start)}–${pad(end)}`;
}

/**
 * Per-session table. A table rather than a chart: there are only five rows and
 * the interesting comparison is across three different units (count, win rate,
 * average P&L), which a single bar chart can't show without picking one.
 *
 * Sessions with no trades are still listed, greyed out - "I never trade the
 * Asian session" is itself a finding, and dropping the row hides it.
 */
export function SessionBreakdown({ sessions }: SessionBreakdownProps) {
  const busiest = Math.max(...sessions.map((s) => s.trade_count), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="pb-2 pr-3 font-medium">Session (UTC)</th>
            <th className="pb-2 pr-3 text-right font-medium">Trades</th>
            <th className="pb-2 pr-3 text-right font-medium">Win rate</th>
            <th className="pb-2 pr-3 text-right font-medium">Avg P&amp;L</th>
            <th className="pb-2 text-right font-medium">Total P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const empty = session.trade_count === 0;
            return (
              <tr
                key={session.key}
                className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
                  empty ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                <td className="py-2 pr-3">
                  <span className="font-medium">{session.label}</span>
                  <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
                    {formatHours(session.start_hour, session.end_hour)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  <span className="inline-flex items-center gap-2">
                    {/* Bar scaled to the busiest session, so where the volume
                        actually sits is readable without doing arithmetic. */}
                    <span
                      aria-hidden
                      className="hidden h-1.5 rounded-full bg-zinc-300 sm:inline-block dark:bg-zinc-700"
                      style={{ width: `${(session.trade_count / busiest) * 3}rem` }}
                    />
                    {session.trade_count}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {empty ? "—" : `${(session.win_rate * 100).toFixed(0)}%`}
                </td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    empty
                      ? ""
                      : session.avg_pnl > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : session.avg_pnl < 0
                          ? "text-red-600 dark:text-red-400"
                          : ""
                  }`}
                >
                  {empty ? "—" : `${session.avg_pnl >= 0 ? "+" : "-"}$${Math.abs(session.avg_pnl).toFixed(2)}`}
                </td>
                <td
                  className={`py-2 text-right font-medium tabular-nums ${
                    empty
                      ? ""
                      : session.total_pnl > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : session.total_pnl < 0
                          ? "text-red-600 dark:text-red-400"
                          : ""
                  }`}
                >
                  {empty ? "—" : `${session.total_pnl >= 0 ? "+" : "-"}$${Math.abs(session.total_pnl).toFixed(2)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
