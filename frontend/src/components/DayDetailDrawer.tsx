"use client";

import { useCallback, useEffect, useState } from "react";

import { deleteTrade, listTradesByDate } from "@/lib/api";
import { checklistScore } from "@/lib/checklist";
import { formatR, tradeR } from "@/lib/risk";
import { Modal } from "@/components/Modal";
import { TradeFormModal } from "@/components/TradeFormModal";
import type { AccountRead } from "@/types/account";
import type { TradeRead } from "@/types/trade";

interface DayDetailDrawerProps {
  date: string;
  accounts: AccountRead[];
  onClose: () => void;
  onChanged: () => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function DayDetailDrawer({ date, accounts, onClose, onChanged }: DayDetailDrawerProps) {
  const [trades, setTrades] = useState<TradeRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"add" | TradeRead | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const load = useCallback(() => {
    listTradesByDate(date)
      .then((data) => {
        setTrades(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load trades."))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  function handleSaved() {
    setFormMode(null);
    load();
    onChanged();
  }

  function handleDelete(id: number) {
    deleteTrade(id)
      .then(() => {
        setConfirmingId(null);
        load();
        onChanged();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to delete trade."));
  }

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <Modal title={dateLabel} onClose={onClose} widthClassName="max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {accounts.length === 0 ? "Create an account to start logging trades." : "Trades for this day"}
          </p>
          <button
            type="button"
            onClick={() => setFormMode("add")}
            disabled={accounts.length === 0}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            + Add trade
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
            ))}
          </div>
        ) : trades.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            No trades logged for this day.
          </p>
        ) : (
          <ul className="space-y-2">
            {trades.map((trade) => (
              <li
                key={trade.id}
                className={`rounded-xl border p-3 ${
                  trade.pnl > 0
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/40"
                    : trade.pnl < 0
                      ? "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40"
                      : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {trade.symbol}{" "}
                      <span className="font-normal text-zinc-500 dark:text-zinc-400">· {trade.side}</span>
                      {trade.setup_tag && (
                        <span className="ml-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {trade.setup_tag}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatTime(trade.entry_time)} → {trade.exit_time ? formatTime(trade.exit_time) : "open"}
                      {trade.checklist_json && (
                        <span className="ml-2">
                          · checklist {checklistScore(trade.checklist_json).checked}/
                          {checklistScore(trade.checklist_json).total}
                        </span>
                      )}
                    </p>
                  </div>
                  <p
                    className={`font-semibold ${
                      trade.pnl > 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : trade.pnl < 0
                          ? "text-red-700 dark:text-red-400"
                          : "text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    {trade.pnl >= 0 ? "+" : "-"}${Math.abs(trade.pnl).toFixed(2)}
                    {tradeR(trade) !== null && (
                      <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                        {formatR(tradeR(trade)!)}
                      </span>
                    )}
                  </p>
                </div>

                <div className="mt-2 flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setFormMode(trade)}
                    className="font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Edit
                  </button>
                  {confirmingId === trade.id ? (
                    <>
                      <span className="text-zinc-400 dark:text-zinc-500">Delete this trade?</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(trade.id)}
                        className="font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(trade.id)}
                      className="font-medium text-red-600 transition-colors hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {formMode && (
        <TradeFormModal
          accounts={accounts}
          defaultDate={date}
          trade={formMode === "add" ? null : formMode}
          onClose={() => setFormMode(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
