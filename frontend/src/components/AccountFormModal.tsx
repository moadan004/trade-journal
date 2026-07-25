"use client";

import { useState, type FormEvent } from "react";

import { ApiError, createAccount } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { Modal } from "@/components/Modal";
import type { AccountRead } from "@/types/account";

const inputClasses =
  "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500";
const labelClasses = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

interface AccountFormModalProps {
  onClose: () => void;
  onCreated: (account: AccountRead) => void;
}

export function AccountFormModal({ onClose, onCreated }: AccountFormModalProps) {
  const [name, setName] = useState("");
  const [broker, setBroker] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const token = getToken();
    if (!token) return;

    setSaving(true);
    createAccount({ name: name.trim(), broker: broker.trim() || null, currency }, token)
      .then((account) => onCreated(account))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create account."))
      .finally(() => setSaving(false));
  }

  return (
    <Modal title="Create trading account" onClose={onClose} widthClassName="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="account-name" className={labelClasses}>
            Name
          </label>
          <input
            id="account-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="MT5 Live"
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="account-broker" className={labelClasses}>
            Broker (optional)
          </label>
          <input
            id="account-broker"
            type="text"
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
            placeholder="Exness"
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="account-currency" className={labelClasses}>
            Currency
          </label>
          <input
            id="account-currency"
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={10}
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
            {saving ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
