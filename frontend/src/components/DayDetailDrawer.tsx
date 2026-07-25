"use client";

import { useCallback, useEffect, useState } from "react";

import { deleteTrade, listTradesByDate } from "@/lib/api";
import { getToken } from "@/lib/auth";
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
    const token = getToken();
    if (!token) return;

    listTradesByDate(date, token)
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
    const token = getToken();
    if (!token) return;

    deleteTrade(id, token)
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
          <p className="text-sm text-zinc-500">
            {accounts.length === 0 ? "Create an account to start logging trades." : "Trades for this day"}
          </p>
          <button
            type="button"
            onClick={() => setFormMode("add")}
            disabled={accounts.length === 0}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            + Add trade
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        ) : trades.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">No trades logged for this day.</p>
        ) : (
          <ul className="space-y-2">
            {trades.map((trade) => (
              <li
                key={trade.id}
                className={`rounded-xl border p-3 ${
                  trade.pnl > 0
                    ? "border-emerald-200 bg-emerald-50"
                    : trade.pnl < 0
                      ? "border-red-200 bg-red-50"
                      : "border-zinc-200 bg-zinc-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-zinc-900">
                      {trade.symbol} <span className="font-normal text-zinc-500">· {trade.side}</span>
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatTime(trade.entry_time)} → {trade.exit_time ? formatTime(trade.exit_time) : "open"}
                    </p>
                  </div>
                  <p
                    className={`font-semibold ${
                      trade.pnl > 0 ? "text-emerald-700" : trade.pnl < 0 ? "text-red-700" : "text-zinc-600"
                    }`}
                  >
                    {trade.pnl >= 0 ? "+" : "-"}${Math.abs(trade.pnl).toFixed(2)}
                  </p>
                </div>

                <div className="mt-2 flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setFormMode(trade)}
                    className="font-medium text-zinc-500 transition-colors hover:text-zinc-900"
                  >
                    Edit
                  </button>
                  {confirmingId === trade.id ? (
                    <>
                      <span className="text-zinc-400">Delete this trade?</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(trade.id)}
                        className="font-medium text-red-600 hover:text-red-800"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="font-medium text-zinc-500 hover:text-zinc-900"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(trade.id)}
                      className="font-medium text-red-600 transition-colors hover:text-red-800"
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
