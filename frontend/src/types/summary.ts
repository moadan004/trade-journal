export interface EquityPoint {
  date: string;
  pnl: number;
  cumulative_pnl: number;
}

export interface SummaryStatsResponse {
  trade_count: number;
  win_count: number;
  loss_count: number;
  breakeven_count: number;
  win_rate: number;
  total_pnl: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number | null;
  equity_curve: EquityPoint[];
}
