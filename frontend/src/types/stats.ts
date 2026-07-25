export interface DailyStat {
  date: string;
  pnl: number;
  trade_count: number;
  win_rate: number;
}

export interface CalendarStatsResponse {
  month: string;
  days: DailyStat[];
  total_pnl: number;
  trading_days: number;
}
