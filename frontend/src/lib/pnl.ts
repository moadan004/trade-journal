import type { TradeSide, TradeStatus } from "@/types/trade";

export function computePnl(side: TradeSide, entryPrice: number, exitPrice: number, size: number): number {
  const diff = side === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
  return diff * size;
}

export function computeStatus(pnl: number): TradeStatus {
  if (pnl > 0) return "win";
  if (pnl < 0) return "loss";
  return "breakeven";
}
