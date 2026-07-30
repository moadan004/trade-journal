export type TradeSide = "long" | "short";
export type TradeStatus = "win" | "loss" | "breakeven";

export interface TradeRead {
  id: number;
  account_id: number;
  symbol: string;
  side: TradeSide;
  entry_time: string;
  exit_time: string | null;
  entry_price: number;
  exit_price: number | null;
  size: number;
  pnl: number;
  fees: number;
  /** Money risked at entry. Null on every trade logged before Phase 6 and on CSV imports. */
  risk_amount: number | null;
  /** Explicit R override; normally null, in which case R is derived as pnl / risk_amount. */
  r_multiple: number | null;
  tags: string[] | null;
  /** The setup traded, e.g. "ORB". Single-valued, unlike `tags`. */
  setup_tag: string | null;
  /** Pre-trade discipline checklist answers, keyed by item (see lib/checklist.ts). */
  checklist_json: Record<string, boolean> | null;
  notes: string | null;
  screenshot_url: string | null;
  status: TradeStatus;
  created_at: string;
  updated_at: string;
}

export interface TradeCreateInput {
  account_id: number;
  symbol: string;
  side: TradeSide;
  entry_time: string;
  exit_time?: string | null;
  entry_price: number;
  exit_price?: number | null;
  size: number;
  pnl: number;
  fees?: number;
  risk_amount?: number | null;
  tags?: string[] | null;
  setup_tag?: string | null;
  checklist_json?: Record<string, boolean> | null;
  notes?: string | null;
  status: TradeStatus;
}

export type TradeUpdateInput = Partial<Omit<TradeCreateInput, "account_id">>;
