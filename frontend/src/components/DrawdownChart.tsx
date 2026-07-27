"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useIsDarkMode } from "@/lib/useIsDarkMode";
import type { DrawdownPoint } from "@/types/summary";

interface DrawdownChartProps {
  data: DrawdownPoint[];
}

/**
 * Underwater curve: distance below the running equity peak after each trade.
 *
 * Plotted as an area hanging off zero rather than as an equity line, because
 * the question this answers is "how deep did it get and how long did it stay
 * there", and a flat run along zero reads instantly as "at highs".
 */
export function DrawdownChart({ data }: DrawdownChartProps) {
  const isDark = useIsDarkMode();

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        No trades in this range yet.
      </div>
    );
  }

  const chartData = data.map((point) => ({
    date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    drawdown: point.drawdown,
  }));

  const gridColor = isDark ? "#3f3f46" : "#e4e4e7";
  const tickColor = isDark ? "#71717a" : "#a1a1aa";
  const refLineColor = isDark ? "#52525b" : "#d4d4d8";
  const areaColor = isDark ? "#f87171" : "#dc2626";
  const tooltipBg = isDark ? "#18181b" : "#ffffff";
  const tooltipText = isDark ? "#f4f4f5" : "#18181b";

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: tickColor }} minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: tickColor }} width={64} tickFormatter={(v: number) => `$${v}`} />
          <ReferenceLine y={0} stroke={refLineColor} />
          <Tooltip
            formatter={(value) => [`-$${Math.abs(Number(value)).toFixed(2)}`, "Drawdown"]}
            contentStyle={{
              borderRadius: 8,
              borderColor: gridColor,
              backgroundColor: tooltipBg,
              color: tooltipText,
              fontSize: 12,
            }}
          />
          {/* type="linear" to match the equity curve: equity moves in discrete
              jumps at each close, and a smoothed curve would invent intermediate
              drawdown levels that never existed. */}
          <Area
            type="linear"
            dataKey="drawdown"
            stroke={areaColor}
            fill={areaColor}
            fillOpacity={0.2}
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
