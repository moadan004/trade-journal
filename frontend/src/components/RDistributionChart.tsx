"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useIsDarkMode } from "@/lib/useIsDarkMode";
import type { RBucket } from "@/types/summary";

interface RDistributionChartProps {
  buckets: RBucket[];
  /** Trades in range with no risk data; they are absent from every bar. */
  missing: number;
}

/** Buckets from "0R to 1R" upward are wins; everything below is a loss. */
function isWinBucket(label: string): boolean {
  return !label.startsWith("-") && !label.startsWith("<");
}

export function RDistributionChart({ buckets, missing }: RDistributionChartProps) {
  const isDark = useIsDarkMode();
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  if (total === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
        <p>No trades in this range have risk recorded.</p>
        {missing > 0 && (
          <p className="text-xs">
            Add a risk amount to a trade (edit it from the calendar) to start building this chart.
          </p>
        )}
      </div>
    );
  }

  const gridColor = isDark ? "#3f3f46" : "#e4e4e7";
  const tickColor = isDark ? "#71717a" : "#a1a1aa";
  const winColor = isDark ? "#34d399" : "#059669";
  const lossColor = isDark ? "#f87171" : "#dc2626";
  const tooltipBg = isDark ? "#18181b" : "#ffffff";
  const tooltipText = isDark ? "#f4f4f5" : "#18181b";

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: tickColor }} interval={0} />
          <YAxis tick={{ fontSize: 11, fill: tickColor }} width={32} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: isDark ? "#27272a" : "#f4f4f5" }}
            formatter={(value) => [`${value} trade${Number(value) === 1 ? "" : "s"}`, "Count"]}
            contentStyle={{
              borderRadius: 8,
              borderColor: gridColor,
              backgroundColor: tooltipBg,
              color: tooltipText,
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {buckets.map((bucket) => (
              <Cell key={bucket.label} fill={isWinBucket(bucket.label) ? winColor : lossColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
