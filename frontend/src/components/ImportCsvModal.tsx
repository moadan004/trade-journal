"use client";

import { useState, type FormEvent } from "react";

import { ApiError, importTradesCsv } from "@/lib/api";
import { Modal } from "@/components/Modal";
import type { AccountRead } from "@/types/account";
import type { ImportResult } from "@/types/importResult";

const inputClasses =
  "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500";
const labelClasses = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

interface ImportCsvModalProps {
  accounts: AccountRead[];
  onClose: () => void;
  onImported: () => void;
}

export function ImportCsvModal({ accounts, onClose, onImported }: ImportCsvModalProps) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const [tag, setTag] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    setImporting(true);
    importTradesCsv(file, accountId, tag.trim() || null)
      .then((data) => {
        setResult(data);
        onImported();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to import CSV."))
      .finally(() => setImporting(false));
  }

  return (
    <Modal title="Import trade history" onClose={onClose} widthClassName="max-w-lg">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Imported <span className="font-semibold">{result.imported}</span> of{" "}
            <span className="font-semibold">{result.total_rows}</span> rows.
          </p>
          {result.skipped.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              <p className="font-medium">{result.skipped.length} row(s) skipped:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {result.skipped.map((row) => (
                  <li key={row.row}>
                    Row {row.row}: {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Upload a trade history export (one row per closed trade, with open/close time,
            price, and profit columns).{" "}
            <a href="/sample-trade-import.csv" download className="font-medium underline">
              Download a sample CSV
            </a>{" "}
            to see the expected format.
          </p>

          <div>
            <label htmlFor="import-account" className={labelClasses}>
              Account
            </label>
            <select
              id="import-account"
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
          </div>

          <div>
            <label htmlFor="import-tag" className={labelClasses}>
              Tag imported trades (optional)
            </label>
            <input
              id="import-tag"
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="mt5-import"
              className={inputClasses}
            />
          </div>

          <div>
            <label htmlFor="import-file" className={labelClasses}>
              CSV file
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:text-zinc-300 dark:file:bg-zinc-800 dark:file:text-zinc-300 dark:hover:file:bg-zinc-700"
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
              disabled={importing}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
