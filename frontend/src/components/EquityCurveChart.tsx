"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { EquityPoint } from "@/types/summary";

interface EquityCurveChartProps {
  data: EquityPoint[];
}

export function EquityCurveChart({ data }: EquityCurveChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
        No trades in this range yet.
      </div>
    );
  }

  const chartData = data.map((point, i) => ({
    index: i + 1,
    date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    cumulative_pnl: point.cumulative_pnl,
  }));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} minTickGap={24} />
          <YAxis
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            width={64}
            tickFormatter={(v: number) => `$${v}`}
          />
          <ReferenceLine y={0} stroke="#d4d4d8" />
          <Tooltip
            formatter={(value) => [`$${Number(value).toFixed(2)}`, "Cumulative P&L"]}
            contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7", fontSize: 12 }}
          />
          <Line type="linear" dataKey="cumulative_pnl" stroke="#18181b" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
