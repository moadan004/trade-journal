"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, getSummaryStats, listAccounts } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import { getPresetRange, type DateRangePreset } from "@/lib/dateRanges";
import { AppHeader } from "@/components/AppHeader";
import { EquityCurveChart } from "@/components/EquityCurveChart";
import { StatCard } from "@/components/StatCard";
import { TagFilterInput } from "@/components/TagFilterInput";
import type { AccountRead } from "@/types/account";
import type { SummaryStatsResponse } from "@/types/summary";

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "all_time", label: "All time" },
];

export default function AnalyticsPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);

  const [accounts, setAccounts] = useState<AccountRead[]>([]);
  const [accountId, setAccountId] = useState<number | "all">("all");
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [tags, setTags] = useState<string[]>([]);
  const [summary, setSummary] = useState<SummaryStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(() => {
    const token = getToken();
    if (!token) return;

    listAccounts(token)
      .then((data) => setAccounts(data))
      .catch(() => {
        // non-fatal: the account selector just stays "All accounts"
      });
  }, []);

  const loadSummary = useCallback(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const range = getPresetRange(preset, today);
    getSummaryStats(token, {
      start: range.start,
      end: range.end,
      accountId: accountId === "all" ? undefined : accountId,
      tags,
    })
      .then((data) => {
        setSummary(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load analytics.");
      })
      .finally(() => setLoading(false));
  }, [preset, accountId, tags, today, router]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  function handlePresetChange(next: DateRangePreset) {
    setLoading(true);
    setPreset(next);
  }

  function handleAccountChange(next: number | "all") {
    setLoading(true);
    setAccountId(next);
  }

  function handleTagsChange(next: string[]) {
    setLoading(true);
    setTags(next);
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <AppHeader active="analytics" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center dark:border-zinc-800 dark:bg-zinc-900">
          <select
            value={accountId}
            onChange={(e) => handleAccountChange(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="all">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => handlePresetChange(p.value)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  preset === p.value
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="min-w-[14rem] flex-1">
            <TagFilterInput tags={tags} onChange={handleTagsChange} />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ) : (
          summary && (
            <>
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard
                  label="Win rate"
                  value={`${(summary.win_rate * 100).toFixed(0)}%`}
                  sub={`${summary.win_count}W / ${summary.loss_count}L / ${summary.breakeven_count}BE`}
                />
                <StatCard
                  label="Avg win / avg loss"
                  value={
                    <span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        ${summary.avg_win.toFixed(2)}
                      </span>
                      <span className="text-zinc-400 dark:text-zinc-500"> / </span>
                      <span className="text-red-600 dark:text-red-400">
                        ${Math.abs(summary.avg_loss).toFixed(2)}
                      </span>
                    </span>
                  }
                />
                <StatCard
                  label="Profit factor"
                  value={summary.profit_factor != null ? summary.profit_factor.toFixed(2) : "—"}
                  sub={summary.profit_factor == null ? "no losing trades in range" : undefined}
                />
              </div>

              <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Equity curve</h2>
                  <p
                    className={`text-sm font-semibold ${
                      summary.total_pnl > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : summary.total_pnl < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {summary.total_pnl >= 0 ? "+" : "-"}${Math.abs(summary.total_pnl).toFixed(2)} ·{" "}
                    {summary.trade_count} trades
                  </p>
                </div>
                <EquityCurveChart data={summary.equity_curve} />
              </div>
            </>
          )
        )}
      </main>
    </div>
  );
}
