"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, getCalendarStats, getSummaryStats, listAccounts } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import { formatDateParam, formatMonthParam } from "@/lib/calendar";
import { getThisMonthRange, getThisWeekRange } from "@/lib/dateRanges";
import { AppHeader } from "@/components/AppHeader";
import { CalendarGrid } from "@/components/CalendarGrid";
import { MonthStatsHeader } from "@/components/MonthStatsHeader";
import { PeriodSummaryCards } from "@/components/PeriodSummaryCards";
import { TagFilterInput } from "@/components/TagFilterInput";
import { DayDetailDrawer } from "@/components/DayDetailDrawer";
import { TradeFormModal } from "@/components/TradeFormModal";
import { AccountFormModal } from "@/components/AccountFormModal";
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

  const monthParam = formatMonthParam(year, month);
  const todayParam = formatDateParam(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const loadStats = useCallback(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    getCalendarStats(monthParam, token, { tags })
      .then((data) => {
        setStats(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
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
    const token = getToken();
    if (!token) return;

    const weekRange = getThisWeekRange(today);
    const monthRange = getThisMonthRange(today);

    Promise.all([
      getSummaryStats(token, { start: weekRange.start, end: weekRange.end, tags }),
      getSummaryStats(token, { start: monthRange.start, end: monthRange.end, tags }),
    ])
      .then(([week, month]) => {
        setWeekSummary(week);
        setMonthSummary(month);
      })
      .catch(() => {
        // non-fatal: the period cards just keep showing the last good numbers
      });
  }, [today, tags]);

  const loadAccounts = useCallback(() => {
    const token = getToken();
    if (!token) return;

    listAccounts(token)
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
      setShowAddAccount(true);
    } else {
      setShowAddTrade(true);
    }
  }

  function handleAccountCreated(account: AccountRead) {
    setAccounts((prev) => [...prev, account]);
    setShowAddAccount(false);
    setShowAddTrade(true);
  }

  const statsByDate = useMemo(() => {
    const map = new Map<string, CalendarStatsResponse["days"][number]>();
    stats?.days.forEach((day) => map.set(day.date, day));
    return map;
  }, [stats]);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <AppHeader
        active="dashboard"
        right={
          <button
            type="button"
            onClick={handleAddTradeClick}
            disabled={!accountsLoaded}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            + Add Trade
          </button>
        }
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <PeriodSummaryCards week={weekSummary} month={monthSummary} />

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
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6">
          {loading ? (
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-zinc-100" />
              ))}
            </div>
          ) : (
            <>
              <CalendarGrid
                year={year}
                month={month}
                statsByDate={statsByDate}
                onDayClick={setSelectedDate}
              />
              {!error && stats && stats.trading_days === 0 && (
                <p className="mt-4 text-center text-sm text-zinc-400">
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
    </div>
  );
}
