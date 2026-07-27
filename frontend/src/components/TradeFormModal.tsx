"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError, createTrade, deleteScreenshot, updateTrade, uploadScreenshot } from "@/lib/api";
import { datetimeLocalToIso, toDatetimeLocalValue } from "@/lib/calendar";
import { computePnl, computeStatus } from "@/lib/pnl";
import { Modal } from "@/components/Modal";
import type { AccountRead } from "@/types/account";
import type { TradeRead, TradeSide } from "@/types/trade";

const inputClasses =
  "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500";
const labelClasses = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

// Mirrors the backend's allow-list. Checked here too so an unsupported file is
// rejected before it's uploaded, rather than after a round trip. SVG is absent
// on purpose - see app/services/uploads.py.
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

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
  const [riskAmount, setRiskAmount] = useState(trade?.risk_amount != null ? String(trade.risk_amount) : "");
  const [tagsInput, setTagsInput] = useState(trade?.tags?.join(", ") ?? "");
  const [notes, setNotes] = useState(trade?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Screenshot state. A new trade has no id yet, so the file is staged here and
  // uploaded after the trade is saved; editing an existing trade can also just
  // drop the current image.
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [existingScreenshot, setExistingScreenshot] = useState(trade?.screenshot_url ?? null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Object URLs are leaked memory until revoked. Cleaning up on unmount covers
  // closing the modal; replacing one mid-session is handled in the picker.
  useEffect(() => {
    return () => {
      if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    };
  }, [screenshotPreview]);

  function handleScreenshotPick(file: File | null) {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Screenshot must be a PNG, JPEG, GIF or WebP image.");
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError("Screenshot must be 5MB or smaller.");
      return;
    }
    setError(null);
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotFile(file);
    setScreenshotPreview(URL.createObjectURL(file));
    setRemoveExisting(false);
  }

  function clearScreenshot() {
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotFile(null);
    setScreenshotPreview(null);
    if (existingScreenshot) {
      setExistingScreenshot(null);
      setRemoveExisting(true);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // True while editing and none of the P&L inputs have been touched.
  //
  // P&L is normally derived from side/prices/size, but a CSV-imported trade
  // carries the broker's own figure, which includes swap and commission and so
  // won't reproduce from prices alone. Recomputing it on every save meant that
  // opening a trade purely to backfill its risk amount silently overwrote the
  // imported P&L - which is exactly the flow Phase 6 asks people to use.
  const pnlInputsUnchanged =
    isEdit &&
    side === trade.side &&
    entryPrice === String(trade.entry_price) &&
    exitPrice === (trade.exit_price != null ? String(trade.exit_price) : "") &&
    size === String(trade.size);

  const effectivePnl = (() => {
    if (pnlInputsUnchanged) return trade.pnl;
    const [entryNum, exitNum, sizeNum] = [entryPrice, exitPrice, size].map(parseFloat);
    if ([entryNum, exitNum, sizeNum].some(Number.isNaN)) return null;
    return computePnl(side, entryNum, exitNum, sizeNum);
  })();

  // Live R for the numbers currently in the form. Shown next to the risk field
  // so "50" reads as a decision ("that was a 2R winner") rather than as one
  // more number to fill in. Derived on each render - no state to keep in sync.
  const previewR = (() => {
    const riskNum = parseFloat(riskAmount);
    if (effectivePnl === null || Number.isNaN(riskNum) || riskNum <= 0) return null;
    return effectivePnl / riskNum;
  })();

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

    // Risk is optional, but a value that's present must be usable as a divisor -
    // the backend silently drops non-positive risk from R stats, so reject it
    // here rather than letting the trade look recorded but count for nothing.
    const trimmedRisk = riskAmount.trim();
    const riskNum = trimmedRisk === "" ? null : parseFloat(trimmedRisk);
    if (riskNum !== null && (Number.isNaN(riskNum) || riskNum <= 0)) {
      setError("Risk must be a positive number, or left blank.");
      return;
    }

    // Keep the stored P&L when nothing that feeds it was edited; see
    // pnlInputsUnchanged above.
    const pnl = pnlInputsUnchanged ? trade.pnl : computePnl(side, entryPriceNum, exitPriceNum, sizeNum);
    const tradeStatus = pnlInputsUnchanged ? trade.status : computeStatus(pnl);
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
      risk_amount: riskNum,
      status: tradeStatus,
      tags: tags.length > 0 ? tags : null,
      notes: notes.trim() || null,
    };

    setSaving(true);
    const request = isEdit
      ? updateTrade(trade.id, basePayload)
      : createTrade({ ...basePayload, account_id: accountId, fees: 0 });

    request
      .then((saved) => {
        // The screenshot is a separate call, and for a new trade it can only
        // happen once the trade exists and has an id.
        if (screenshotFile) return uploadScreenshot(saved.id, screenshotFile);
        if (removeExisting) return deleteScreenshot(saved.id);
        return saved;
      })
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
          <label htmlFor="trade-risk" className={labelClasses}>
            Risk <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
          </label>
          <input
            id="trade-risk"
            type="number"
            step="any"
            min="0"
            value={riskAmount}
            onChange={(e) => setRiskAmount(e.target.value)}
            placeholder="50"
            className={inputClasses}
          />
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Money at risk from entry to stop. Powers R-multiple analytics
            {previewR !== null && (
              <>
                {" — this trade is "}
                <span className={previewR >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                  {previewR >= 0 ? "+" : ""}
                  {previewR.toFixed(2)}R
                </span>
              </>
            )}
            .
          </p>
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
          <label htmlFor="trade-screenshot" className={labelClasses}>
            Screenshot <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
          </label>
          {screenshotPreview || existingScreenshot ? (
            <div className="mt-2 flex items-start gap-3">
              {/* Plain <img>: the source is either a blob: URL or a runtime
                  upload path, neither of which next/image can optimize. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshotPreview ?? existingScreenshot ?? ""}
                alt="Trade screenshot preview"
                className="h-24 w-40 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
              />
              <div className="flex flex-col gap-1 text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {screenshotFile ? `${screenshotFile.name} (not yet saved)` : "Currently attached"}
                </span>
                <button
                  type="button"
                  onClick={clearScreenshot}
                  className="self-start font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : null}
          <input
            id="trade-screenshot"
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            onChange={(e) => handleScreenshotPick(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800 dark:text-zinc-400 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-zinc-300"
          />
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            PNG, JPEG, GIF or WebP, up to 5MB.
          </p>
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
