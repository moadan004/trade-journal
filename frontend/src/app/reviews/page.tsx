"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, getSummaryStats, getWeeklyReview, saveWeeklyReview } from "@/lib/api";
import { addWeeks, formatWeekLabel, isSameWeek, mondayOf, weekParam, weekStatsRange } from "@/lib/weeks";
import { AppHeader } from "@/components/AppHeader";
import { StatCard } from "@/components/StatCard";
import type { SummaryStatsResponse } from "@/types/summary";

export default function ReviewsPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [summary, setSummary] = useState<SummaryStatsResponse | null>(null);
  const [reflections, setReflections] = useState("");
  // What the server last confirmed. Compared against `reflections` to drive the
  // dirty indicator, so "Saved" can't linger after the textarea is edited again.
  const [savedReflections, setSavedReflections] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrentWeek = isSameWeek(weekStart, today);
  const isDirty = reflections !== savedReflections;

  const loadWeek = useCallback(() => {
    const range = weekStatsRange(weekStart);

    Promise.all([
      getWeeklyReview(weekParam(weekStart)),
      getSummaryStats({ start: range.start, end: range.end }),
    ])
      .then(([review, summaryData]) => {
        setReflections(review.reflections);
        setSavedReflections(review.reflections);
        setSummary(summaryData);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load this week.");
      })
      .finally(() => setLoading(false));
  }, [weekStart, router]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  function goToWeek(delta: number) {
    setLoading(true);
    setWeekStart((current) => addWeeks(current, delta));
  }

  function handleSave() {
    setSaving(true);
    setError(null);
    saveWeeklyReview(weekParam(weekStart), reflections)
      .then((review) => setSavedReflections(review.reflections))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to save your review.");
      })
      .finally(() => setSaving(false));
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <AppHeader active="reviews" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => goToWeek(-1)}
            aria-label="Previous week"
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            &#8592;
          </button>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {formatWeekLabel(weekStart)}
            </h2>
            {isCurrentWeek && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">This week</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => goToWeek(1)}
            aria-label="Next week"
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            &#8594;
          </button>
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
            <div className="h-56 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ) : (
          <>
            {summary && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard
                  label="Week P&L"
                  value={
                    <span
                      className={
                        summary.total_pnl > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : summary.total_pnl < 0
                            ? "text-red-600 dark:text-red-400"
                            : undefined
                      }
                    >
                      {summary.total_pnl >= 0 ? "+" : "-"}${Math.abs(summary.total_pnl).toFixed(2)}
                    </span>
                  }
                  sub={`${summary.trade_count} ${summary.trade_count === 1 ? "trade" : "trades"}`}
                />
                <StatCard
                  label="Win rate"
                  value={summary.trade_count > 0 ? `${(summary.win_rate * 100).toFixed(0)}%` : "—"}
                  sub={`${summary.win_count}W / ${summary.loss_count}L / ${summary.breakeven_count}BE`}
                />
                <StatCard
                  label="Profit factor"
                  value={summary.profit_factor != null ? summary.profit_factor.toFixed(2) : "—"}
                  sub={
                    summary.trade_count === 0
                      ? "no trades this week"
                      : summary.profit_factor == null
                        ? "no losing trades"
                        : undefined
                  }
                />
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Reflections</h3>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  {saving ? "Saving…" : isDirty ? "Unsaved changes" : savedReflections ? "Saved" : ""}
                </p>
              </div>
              <textarea
                rows={10}
                value={reflections}
                onChange={(e) => setReflections(e.target.value)}
                placeholder="What went well? What didn't? What will you do differently next week?"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {saving ? "Saving…" : "Save review"}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
