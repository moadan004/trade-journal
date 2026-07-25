import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  sub?: ReactNode;
}

export function StatCard({ label, value, valueClassName, sub }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClassName ?? "text-zinc-900 dark:text-zinc-100"}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>}
    </div>
  );
}
