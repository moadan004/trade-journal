"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useIsDarkMode } from "@/lib/useIsDarkMode";
import type { EquityPoint } from "@/types/summary";

interface EquityCurveChartProps {
  data: EquityPoint[];
}

export function EquityCurveChart({ data }: EquityCurveChartProps) {
  const isDark = useIsDarkMode();

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        No trades in this range yet.
      </div>
    );
  }

  const chartData = data.map((point, i) => ({
    index: i + 1,
    date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    cumulative_pnl: point.cumulative_pnl,
  }));

  const gridColor = isDark ? "#3f3f46" : "#e4e4e7";
  const tickColor = isDark ? "#71717a" : "#a1a1aa";
  const refLineColor = isDark ? "#52525b" : "#d4d4d8";
  const lineColor = isDark ? "#f4f4f5" : "#18181b";
  const tooltipBg = isDark ? "#18181b" : "#ffffff";

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: tickColor }} minTickGap={24} />
          <YAxis
            tick={{ fontSize: 11, fill: tickColor }}
            width={64}
            tickFormatter={(v: number) => `$${v}`}
          />
          <ReferenceLine y={0} stroke={refLineColor} />
          <Tooltip
            formatter={(value) => [`$${Number(value).toFixed(2)}`, "Cumulative P&L"]}
            contentStyle={{
              borderRadius: 8,
              borderColor: gridColor,
              backgroundColor: tooltipBg,
              color: lineColor,
              fontSize: 12,
            }}
          />
          <Line type="linear" dataKey="cumulative_pnl" stroke={lineColor} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
