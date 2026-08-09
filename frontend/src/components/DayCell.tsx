import type { DailyStat } from "@/types/stats";

interface DayCellProps {
  day: number;
  stat?: DailyStat;
  onClick?: () => void;
}

/**
 * Shared by real cells and the leading/trailing blanks.
 *
 * Grid rows size to their tallest item, so the blanks have to carry the same
 * aspect as the cells or they alone would hold every row at the old height.
 *
 * Square on mobile - at ~48px wide a shorter cell would drop under the ~44px
 * touch target - and deliberately wider than tall from `sm` up, where the cell
 * is ~133px and squareness is what made the grid feel enormous. Height is set by
 * the aspect, not by padding, so trimming padding alone would have changed
 * nothing but the whitespace.
 */
export const DAY_CELL_ASPECT = "aspect-square sm:aspect-[7/5]";

/**
 * Compact money for a cell that can be ~40px of usable width on a phone.
 *
 * Four-figure days used to truncate to "+$1…", which tells you nothing at all -
 * not the amount, not even the sign of the magnitude. "+$1.1k" is approximate
 * but legible; the exact figure is in the cell's tooltip and the day drawer.
 */
function compactMoney(pnl: number): string {
  const sign = pnl >= 0 ? "+" : "-";
  const abs = Math.abs(pnl);

  if (abs < 1000) return `${sign}$${abs.toFixed(0)}`;
  if (abs < 10000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs / 1000)}k`;
}

export function DayCell({ day, stat, onClick }: DayCellProps) {
  const hasTrades = (stat?.trade_count ?? 0) > 0;
  const pnl = stat?.pnl ?? 0;

  /*
   * Light mode is unchanged. The dark half is a deliberate palette rather than a
   * dimmed copy of the light one:
   *
   *  - solid `-950` grounds instead of the old `-950/40` washes. Translucent
   *    tints let the page background through, so a cell read differently
   *    depending on what sat behind it and never quite looked like a surface.
   *  - `-400` figures rather than `-300`. On a near-black ground the lighter
   *    shade goes chalky; -400 keeps the saturation that makes green and red
   *    separable at a glance, which is the entire job of this colour coding.
   *  - borders one step lighter than their own fill (`-900` on `-950`), so a
   *    cell is delineated by its own colour rather than by a neutral outline.
   *
   * These are the stock Tailwind ramps driven by the same `.dark` class the rest
   * of the app uses - see lib/theme.ts - not a palette private to the calendar.
   */
  const colorClasses = !hasTrades
    ? "bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400"
    : pnl > 0
      ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-900 dark:text-emerald-400"
      : pnl < 0
        ? "bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-900 dark:text-red-400"
        : "bg-zinc-100 border-zinc-300 text-zinc-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300";

  // The secondary line is hidden below `sm`, and even above it the counts are
  // abbreviated. Spelling the day out here keeps every number reachable on
  // hover, and on touch via long-press, rather than lost at the smaller size.
  const summary = hasTrades && stat
    ? `${day}: ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} · ${stat.trade_count} ${
        stat.trade_count === 1 ? "trade" : "trades"
      } · ${(stat.win_rate * 100).toFixed(0)}% win rate`
    : `${day}: no trades`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={summary}
      className={`flex ${DAY_CELL_ASPECT} flex-col justify-between rounded-lg border p-1 text-left transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-zinc-400 sm:rounded-xl sm:p-1.5 dark:hover:brightness-110 dark:focus:ring-zinc-600 ${colorClasses}`}
    >
      <div className="flex items-start justify-between leading-none">
        {/* Demoted to a corner marker so the P&L reads as the cell's headline.
            The dark bump is legibility, not emphasis: at 60% the day number came
            in under 4.5:1 on the new solid grounds. Light mode is left exactly as
            it was. Hierarchy still comes from size and weight, not dimming. */}
        <span className="text-[10px] font-medium opacity-60 dark:opacity-90">{day}</span>
        {hasTrades && <span className="h-1 w-1 rounded-full bg-current opacity-60 sm:h-1.5 sm:w-1.5" />}
      </div>

      {hasTrades && stat && (
        <div className="overflow-hidden">
          <p className="truncate text-[11px] font-semibold leading-tight sm:text-sm">
            {compactMoney(pnl)}
          </p>
          {/* Trade count and win rate on one line rather than two: same numbers,
              half the vertical space. Full wording is in the button's title. */}
          <p className="hidden truncate text-[10px] leading-tight opacity-70 sm:block dark:opacity-90">
            {stat.trade_count} · {(stat.win_rate * 100).toFixed(0)}%
          </p>
        </div>
      )}
    </button>
  );
}
