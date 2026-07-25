"use client";

import { useState, type FormEvent } from "react";

import { ApiError, createTrade, updateTrade } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { datetimeLocalToIso, toDatetimeLocalValue } from "@/lib/calendar";
import { computePnl, computeStatus } from "@/lib/pnl";
import { Modal } from "@/components/Modal";
import type { AccountRead } from "@/types/account";
import type { TradeRead, TradeSide } from "@/types/trade";

const inputClasses =
  "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500";
const labelClasses = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

interface TradeFormModalProps {
  accounts: AccountRead[];
  trade: TradeRead | null;
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function TradeFormModal({ accounts, trade, defaultDate, onClose, onSaved }: TradeFormModalProps) {
  const isEdit = trade !== null;

  const [accountId, setAccountId] = useState(trade?.account_id ?? accounts[0]?.id ?? 0);
  const [symbol, setSymbol] = useState(trade?.symbol ?? "");
  const [side, setSide] = useState<TradeSide>(trade?.side ?? "long");
  const [entryDateTime, setEntryDateTime] = useState(
    trade
      ? toDatetimeLocalValue(trade.entry_time)
      : defaultDate
        ? `${defaultDate}T09:30`
        : toDatetimeLocalValue(new Date().toISOString()),
  );
  const [exitDateTime, setExitDateTime] = useState(
    trade?.exit_time
      ? toDatetimeLocalValue(trade.exit_time)
      : defaultDate
        ? `${defaultDate}T10:00`
        : toDatetimeLocalValue(new Date().toISOString()),
  );
  const [entryPrice, setEntryPrice] = useState(trade ? String(trade.entry_price) : "");
  const [exitPrice, setExitPrice] = useState(trade?.exit_price != null ? String(trade.exit_price) : "");
  const [size, setSize] = useState(trade ? String(trade.size) : "");
  const [tagsInput, setTagsInput] = useState(trade?.tags?.join(", ") ?? "");
  const [notes, setNotes] = useState(trade?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const entryPriceNum = parseFloat(entryPrice);
    const exitPriceNum = parseFloat(exitPrice);
    const sizeNum = parseFloat(size);

    if ([entryPriceNum, exitPriceNum, sizeNum].some((n) => Number.isNaN(n))) {
      setError("Entry price, exit price, and size must be valid numbers.");
      return;
    }
    if (!symbol.trim()) {
      setError("Symbol is required.");
      return;
    }

    const token = getToken();
    if (!token) return;

    const pnl = computePnl(side, entryPriceNum, exitPriceNum, sizeNum);
    const tradeStatus = computeStatus(pnl);
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const basePayload = {
      symbol: symbol.trim().toUpperCase(),
      side,
      entry_time: datetimeLocalToIso(entryDateTime),
      exit_time: datetimeLocalToIso(exitDateTime),
      entry_price: entryPriceNum,
      exit_price: exitPriceNum,
      size: sizeNum,
      pnl,
      status: tradeStatus,
      tags: tags.length > 0 ? tags : null,
      notes: notes.trim() || null,
    };

    setSaving(true);
    const request = isEdit
      ? updateTrade(trade.id, basePayload, token)
      : createTrade({ ...basePayload, account_id: accountId, fees: 0 }, token);

    request
      .then(() => onSaved())
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save trade."))
      .finally(() => setSaving(false));
  }

  return (
    <Modal title={isEdit ? "Edit trade" : "Add trade"} onClose={onClose} widthClassName="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClasses}>Account</label>
          {isEdit ? (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {accounts.find((a) => a.id === trade.account_id)?.name ?? `Account #${trade.account_id}`}
            </p>
          ) : (
            <select
              value={accountId}
              onChange={(e) => setAccountId(Number(e.target.value))}
              className={inputClasses}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="trade-symbol" className={labelClasses}>
              Symbol
            </label>
            <input
              id="trade-symbol"
              type="text"
              required
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="XAUUSD"
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="trade-side" className={labelClasses}>
              Side
            </label>
            <select
              id="trade-side"
              value={side}
              onChange={(e) => setSide(e.target.value as TradeSide)}
              className={inputClasses}
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="trade-entry-time" className={labelClasses}>
              Entry time
            </label>
            <input
              id="trade-entry-time"
              type="datetime-local"
              required
              value={entryDateTime}
              onChange={(e) => setEntryDateTime(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="trade-exit-time" className={labelClasses}>
              Exit time
            </label>
            <input
              id="trade-exit-time"
              type="datetime-local"
              required
              value={exitDateTime}
              onChange={(e) => setExitDateTime(e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label htmlFor="trade-entry-price" className={labelClasses}>
              Entry price
            </label>
            <input
              id="trade-entry-price"
              type="number"
              step="any"
              required
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="trade-exit-price" className={labelClasses}>
              Exit price
            </label>
            <input
              id="trade-exit-price"
              type="number"
              step="any"
              required
              value={exitPrice}
              onChange={(e) => setExitPrice(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="trade-size" className={labelClasses}>
              Size
            </label>
            <input
              id="trade-size"
              type="number"
              step="any"
              required
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>

        <div>
          <label htmlFor="trade-tags" className={labelClasses}>
            Tags
          </label>
          <input
            id="trade-tags"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="scalp, breakout"
            className={inputClasses}
          />
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Comma-separated.</p>
        </div>

        <div>
          <label htmlFor="trade-notes" className={labelClasses}>
            Notes
          </label>
          <textarea
            id="trade-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClasses}
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add trade"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
