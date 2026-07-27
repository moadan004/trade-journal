"use client";

import { useState } from "react";

import { ApiError, exportTrades, type ExportFilters } from "@/lib/api";

interface ExportMenuProps {
  filters: ExportFilters;
}

/**
 * CSV / PDF download for the trades currently in view.
 *
 * Takes the same filters the page is displaying, so what you export is what
 * you're looking at rather than the whole history.
 */
export function ExportMenu({ filters }: ExportMenuProps) {
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleExport(format: "csv" | "pdf") {
    setBusy(format);
    setError(null);
    exportTrades(format, filters)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : `Failed to export ${format.toUpperCase()}.`),
      )
      .finally(() => setBusy(null));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 dark:text-zinc-500">Export</span>
        {(["csv", "pdf"] as const).map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => handleExport(format)}
            disabled={busy !== null}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {busy === format ? "…" : format.toUpperCase()}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
