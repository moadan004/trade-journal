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

export interface DrawdownPoint {
  date: string;
  cumulative_pnl: number;
  peak: number;
  /** Always <= 0: how far below the running peak equity sat after this trade. */
  drawdown: number;
}

export interface RBucket {
  label: string;
  count: number;
}

export interface StreakInfo {
  type: "win" | "loss" | "none";
  count: number;
}

export interface RiskStatsResponse {
  trade_count: number;
  trades_with_risk: number;
  trades_missing_risk: number;

  max_drawdown: number;
  max_drawdown_start: string | null;
  max_drawdown_end: string | null;
  drawdown_curve: DrawdownPoint[];

  r_multiple_distribution: RBucket[];
  avg_r: number | null;
  best_r: number | null;
  worst_r: number | null;

  longest_win_streak: number;
  longest_loss_streak: number;
  current_streak: StreakInfo;
}

export interface SessionStat {
  key: string;
  label: string;
  start_hour: number;
  end_hour: number;
  trade_count: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  avg_pnl: number;
  total_pnl: number;
}

export interface SessionStatsResponse {
  trade_count: number;
  sessions: SessionStat[];
}
