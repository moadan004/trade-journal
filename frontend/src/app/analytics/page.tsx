"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, getRiskStats, getSessionStats, getSummaryStats, listAccounts } from "@/lib/api";
import { getPresetRange, type DateRangePreset } from "@/lib/dateRanges";
import { formatR } from "@/lib/risk";
import { AccountComparison } from "@/components/AccountComparison";
import { AppHeader } from "@/components/AppHeader";
import { DrawdownChart } from "@/components/DrawdownChart";
import { ExportMenu } from "@/components/ExportMenu";
import { EquityCurveChart } from "@/components/EquityCurveChart";
import { RDistributionChart } from "@/components/RDistributionChart";
import { SessionBreakdown } from "@/components/SessionBreakdown";
import { StatCard } from "@/components/StatCard";
import { TagFilterInput } from "@/components/TagFilterInput";
import type { AccountRead } from "@/types/account";
import type { RiskStatsResponse, SessionStatsResponse, SummaryStatsResponse } from "@/types/summary";

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "all_time", label: "All time" },
];

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function streakColor(type: "win" | "loss" | "none"): string | undefined {
  if (type === "win") return "text-emerald-600 dark:text-emerald-400";
  if (type === "loss") return "text-red-600 dark:text-red-400";
  return undefined;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);

  const [accounts, setAccounts] = useState<AccountRead[]>([]);
  // "all" aggregates every account into one set of numbers; "compare" keeps the
  // same combined totals but also asks for the per-account breakdown.
  const [accountId, setAccountId] = useState<number | "all" | "compare">("all");
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [tags, setTags] = useState<string[]>([]);
  const [setupTag, setSetupTag] = useState("");
  const [summary, setSummary] = useState<SummaryStatsResponse | null>(null);
  const [risk, setRisk] = useState<RiskStatsResponse | null>(null);
  const [sessions, setSessions] = useState<SessionStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(() => {
    listAccounts()
      .then((data) => setAccounts(data))
      .catch(() => {
        // non-fatal: the account selector just stays "All accounts"
      });
  }, []);

  const loadStats = useCallback(() => {
    // No pre-flight token check is possible now (the cookie is httpOnly), so an
    // unauthenticated visitor is detected by these requests returning 401.
    //
    // All three take identical filters and are fetched together so the page can
    // never show a summary from one range next to a session table from another.
    const range = getPresetRange(preset, today);
    const singleAccount = typeof accountId === "number" ? accountId : undefined;
    const filters = {
      start: range.start,
      end: range.end,
      accountId: singleAccount,
      tags,
      setupTag: setupTag || undefined,
    };
    // Only /summary understands account_ids; risk and sessions stay on the
    // combined set, which is what their panels describe either way.
    const summaryFilters =
      accountId === "compare" ? { ...filters, accountIds: accounts.map((a) => a.id) } : filters;

    Promise.all([getSummaryStats(summaryFilters), getRiskStats(filters), getSessionStats(filters)])
      .then(([summaryData, riskData, sessionData]) => {
        setSummary(summaryData);
        setRisk(riskData);
        setSessions(sessionData);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load analytics.");
      })
      .finally(() => setLoading(false));
  }, [preset, accountId, tags, setupTag, today, router]);
  }, [preset, accountId, accounts, tags, today, router]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  function handlePresetChange(next: DateRangePreset) {
    setLoading(true);
    setPreset(next);
  }

  function handleAccountChange(next: number | "all" | "compare") {
    setLoading(true);
    setAccountId(next);
  }

  function handleTagsChange(next: string[]) {
    setLoading(true);
    setTags(next);
  }

  function handleSetupTagChange(next: string) {
    setLoading(true);
    setSetupTag(next);
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <AppHeader active="analytics" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center dark:border-zinc-800 dark:bg-zinc-900">
          <select
            value={accountId}
            onChange={(e) => {
              const raw = e.target.value;
              handleAccountChange(raw === "all" || raw === "compare" ? raw : Number(raw));
            }}
            aria-label="Account"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="all">All accounts</option>
            {accounts.length > 1 && <option value="compare">Compare accounts</option>}
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

          {/* Separate control from the tag filter, matching the model: one
              setup per trade, so this is a single value rather than a chip list. */}
          <input
            type="text"
            list="analytics-setup-options"
            value={setupTag}
            onChange={(e) => handleSetupTagChange(e.target.value)}
            placeholder="Filter by setup…"
            aria-label="Filter by setup"
            className="min-w-[10rem] rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <datalist id="analytics-setup-options">
            <option value="ORB" />
            <option value="Liquidity sweep" />
            <option value="Trend continuation" />
            <option value="Reversal" />
            <option value="Range breakout" />
          </datalist>

          {/* Same date range and account the page is showing, so the download
              matches what's on screen. Tags aren't part of it - the export
              endpoint doesn't filter by them. */}
          <ExportMenu
            filters={{
              start: getPresetRange(preset, today).start,
              end: getPresetRange(preset, today).end,
              accountId: typeof accountId === "number" ? accountId : undefined,
            }}
          />
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

              {summary.by_account.length > 0 && (
                <>
                  <h2 className="mt-8 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Account comparison
                  </h2>
                  <p className="mt-1 mb-3 text-xs text-zinc-400 dark:text-zinc-500">
                    The cards below break down the combined totals above; they always sum to them.
                  </p>
                  <AccountComparison accounts={summary.by_account} />
                </>
              )}

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

              {risk && (
                <>
                  <h2 className="mt-8 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Risk</h2>

                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <StatCard
                      label="Max drawdown"
                      value={
                        <span className={risk.max_drawdown > 0 ? "text-red-600 dark:text-red-400" : undefined}>
                          {risk.max_drawdown > 0 ? `-$${risk.max_drawdown.toFixed(2)}` : "$0.00"}
                        </span>
                      }
                      sub={
                        risk.max_drawdown_end
                          ? `peak-to-trough, ending ${formatShortDate(risk.max_drawdown_end)}`
                          : "never below the starting peak"
                      }
                    />
                    <StatCard
                      label="Average R"
                      value={risk.avg_r != null ? formatR(risk.avg_r) : "—"}
                      sub={
                        risk.trades_with_risk > 0
                          ? `best ${formatR(risk.best_r!)} · worst ${formatR(risk.worst_r!)}`
                          : "no trades with risk recorded"
                      }
                    />
                    <StatCard
                      label="Current streak"
                      value={
                        <span className={streakColor(risk.current_streak.type)}>
                          {risk.current_streak.type === "none"
                            ? "—"
                            : `${risk.current_streak.count} ${risk.current_streak.type === "win" ? "win" : "loss"}${
                                risk.current_streak.count === 1 ? "" : risk.current_streak.type === "win" ? "s" : "es"
                              }`}
                        </span>
                      }
                      sub={`best run ${risk.longest_win_streak}W · worst ${risk.longest_loss_streak}L`}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                      <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Drawdown
                      </h3>
                      <DrawdownChart data={risk.drawdown_curve} />
                    </div>

                    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                      <div className="mb-4 flex items-baseline justify-between gap-3">
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          R-multiple distribution
                        </h3>
                        {/* The excluded count is not a footnote: after a CSV
                            import most trades have no risk, and a histogram
                            built from a handful of them is easy to over-read. */}
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                          {risk.trades_with_risk} of {risk.trade_count} trades
                          {risk.trades_missing_risk > 0 && ` · ${risk.trades_missing_risk} without risk`}
                        </p>
                      </div>
                      <RDistributionChart
                        buckets={risk.r_multiple_distribution}
                        missing={risk.trades_missing_risk}
                      />
                    </div>
                  </div>
                </>
              )}

              {sessions && (
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-4 flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Session breakdown
                    </h3>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      by entry time, UTC
                    </p>
                  </div>
                  <SessionBreakdown sessions={sessions.sessions} />
                </div>
              )}
            </>
          )
        )}
      </main>
    </div>
  );
}
