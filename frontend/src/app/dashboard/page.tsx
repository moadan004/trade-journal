"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, getCalendarStats, getSummaryStats, listAccounts } from "@/lib/api";
import { formatDateParam, formatMonthParam } from "@/lib/calendar";
import { getThisMonthRange, getThisWeekRange } from "@/lib/dateRanges";
import { AppHeader } from "@/components/AppHeader";
import { CalendarGrid } from "@/components/CalendarGrid";
import { MonthStatsHeader } from "@/components/MonthStatsHeader";
import { PeriodSummaryCards } from "@/components/PeriodSummaryCards";
import { SessionIndicator } from "@/components/SessionIndicator";
import { TagFilterInput } from "@/components/TagFilterInput";
import { DayDetailDrawer } from "@/components/DayDetailDrawer";
import { TradeFormModal } from "@/components/TradeFormModal";
import { AccountFormModal } from "@/components/AccountFormModal";
import { ImportCsvModal } from "@/components/ImportCsvModal";
import type { AccountRead } from "@/types/account";
import type { CalendarStatsResponse } from "@/types/stats";
import type { SummaryStatsResponse } from "@/types/summary";

export default function DashboardPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [stats, setStats] = useState<CalendarStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tags, setTags] = useState<string[]>([]);

  const [weekSummary, setWeekSummary] = useState<SummaryStatsResponse | null>(null);
  const [monthSummary, setMonthSummary] = useState<SummaryStatsResponse | null>(null);

  const [accounts, setAccounts] = useState<AccountRead[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAddTrade, setShowAddTrade] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [pendingAction, setPendingAction] = useState<"trade" | "import" | null>(null);

  const monthParam = formatMonthParam(year, month);
  const todayParam = formatDateParam(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const loadStats = useCallback(() => {
    // No pre-flight token check is possible now (the cookie is httpOnly), so an
    // unauthenticated visitor is detected by this request returning 401.
    getCalendarStats(monthParam, { tags })
      .then((data) => {
        setStats(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load calendar stats.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [monthParam, tags, router]);

  const loadPeriodSummaries = useCallback(() => {
    const weekRange = getThisWeekRange(today);
    const monthRange = getThisMonthRange(today);

    Promise.all([
      getSummaryStats({ start: weekRange.start, end: weekRange.end, tags }),
      getSummaryStats({ start: monthRange.start, end: monthRange.end, tags }),
    ])
      .then(([week, month]) => {
        setWeekSummary(week);
        setMonthSummary(month);
      })
      .catch(() => {
        // non-fatal: the period cards just keep showing the last good numbers.
        // A 401 here is handled by loadStats, which drives the redirect.
      });
  }, [today, tags]);

  const loadAccounts = useCallback(() => {
    listAccounts()
      .then((data) => setAccounts(data))
      .catch(() => {
        // non-fatal: worst case the "add trade" button asks to create an account first
      })
      .finally(() => setAccountsLoaded(true));
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadPeriodSummaries();
  }, [loadPeriodSummaries]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  function refreshAll() {
    loadStats();
    loadPeriodSummaries();
  }

  function goToPrevMonth() {
    setLoading(true);
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    setLoading(true);
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function handleTagsChange(next: string[]) {
    setLoading(true);
    setTags(next);
  }

  function handleAddTradeClick() {
    if (accounts.length === 0) {
      setPendingAction("trade");
      setShowAddAccount(true);
    } else {
      setShowAddTrade(true);
    }
  }

  function handleImportClick() {
    if (accounts.length === 0) {
      setPendingAction("import");
      setShowAddAccount(true);
    } else {
      setShowImportCsv(true);
    }
  }

  function handleAccountCreated(account: AccountRead) {
    setAccounts((prev) => [...prev, account]);
    setShowAddAccount(false);
    if (pendingAction === "import") {
      setShowImportCsv(true);
    } else {
      setShowAddTrade(true);
    }
    setPendingAction(null);
  }

  const statsByDate = useMemo(() => {
    const map = new Map<string, CalendarStatsResponse["days"][number]>();
    stats?.days.forEach((day) => map.set(day.date, day));
    return map;
  }, [stats]);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <AppHeader
        active="dashboard"
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleImportClick}
              disabled={!accountsLoaded}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Import CSV
            </button>
            <button
              type="button"
              onClick={handleAddTradeClick}
              disabled={!accountsLoaded}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              + Add Trade
            </button>
          </div>
        }
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <SessionIndicator />

        <div className="mt-4">
          <PeriodSummaryCards week={weekSummary} month={monthSummary} />
        </div>

        <div className="mt-4 max-w-sm">
          <TagFilterInput tags={tags} onChange={handleTagsChange} />
        </div>

        <div className="mt-4">
          <MonthStatsHeader
            year={year}
            month={month}
            totalPnl={stats?.total_pnl ?? 0}
            tradingDays={stats?.trading_days ?? 0}
            onPrev={goToPrevMonth}
            onNext={goToNextMonth}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-6">
          {loading ? (
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {Array.from({ length: 35 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded-lg bg-zinc-100 sm:rounded-xl dark:bg-zinc-800"
                />
              ))}
            </div>
          ) : (
            <>
              <CalendarGrid
                year={year}
                month={month}
                statsByDate={statsByDate}
                onDayClick={setSelectedDate}
                onSwipeNext={goToNextMonth}
                onSwipePrev={goToPrevMonth}
              />
              {!error && stats && stats.trading_days === 0 && (
                <p className="mt-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                  No trades logged for {monthParam}
                  {tags.length > 0 ? " with the selected tags" : ""} yet.
                </p>
              )}
            </>
          )}
        </div>
      </main>

      {selectedDate && (
        <DayDetailDrawer
          date={selectedDate}
          accounts={accounts}
          onClose={() => setSelectedDate(null)}
          onChanged={refreshAll}
        />
      )}

      {showAddTrade && (
        <TradeFormModal
          accounts={accounts}
          trade={null}
          defaultDate={todayParam}
          onClose={() => setShowAddTrade(false)}
          onSaved={() => {
            setShowAddTrade(false);
            refreshAll();
          }}
        />
      )}

      {showAddAccount && (
        <AccountFormModal onClose={() => setShowAddAccount(false)} onCreated={handleAccountCreated} />
      )}

      {showImportCsv && (
        <ImportCsvModal accounts={accounts} onClose={() => setShowImportCsv(false)} onImported={refreshAll} />
      )}
    </div>
  );
}
