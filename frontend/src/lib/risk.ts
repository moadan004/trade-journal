import type { TradeRead } from "@/types/trade";

/**
 * R for a saved trade, or null when it can't be determined.
 *
 * Mirrors `r_multiple()` in backend/app/services/risk.py, including the
 * precedence rule: an explicitly stored r_multiple wins, otherwise R is
 * derived as pnl / risk_amount. A non-positive risk_amount counts as missing.
 *
 * This exists so a trade row and the analytics histogram never disagree about
 * what R a trade was; if the backend rule changes, both places change together.
 */
export function tradeR(trade: TradeRead): number | null {
  if (trade.r_multiple != null) return trade.r_multiple;
  if (trade.risk_amount == null || trade.risk_amount <= 0) return null;
  return trade.pnl / trade.risk_amount;
}

export function formatR(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}
