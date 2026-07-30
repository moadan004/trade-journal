from datetime import date, datetime

from pydantic import BaseModel


class DailyStat(BaseModel):
    date: date
    pnl: float
    trade_count: int
    win_rate: float


class CalendarStatsResponse(BaseModel):
    month: str
    days: list[DailyStat]
    total_pnl: float
    trading_days: int


class EquityPoint(BaseModel):
    date: datetime
    pnl: float
    cumulative_pnl: float


class AccountSummary(BaseModel):
    """One account's slice of a multi-account summary."""

    account_id: int
    account_name: str
    trade_count: int
    win_count: int
    loss_count: int
    breakeven_count: int
    win_rate: float
    total_pnl: float
    avg_win: float
    avg_loss: float
    profit_factor: float | None


class SummaryStatsResponse(BaseModel):
    trade_count: int
    win_count: int
    loss_count: int
    breakeven_count: int
    win_rate: float
    total_pnl: float
    avg_win: float
    avg_loss: float
    profit_factor: float | None
    equity_curve: list[EquityPoint]
    # Populated only when account_ids was supplied; empty otherwise, so existing
    # single-account callers see no change in shape they have to handle.
    by_account: list[AccountSummary] = []


class DrawdownPoint(BaseModel):
    date: datetime
    cumulative_pnl: float
    peak: float
    # Always <= 0: how far below the running peak equity sat after this trade.
    drawdown: float


class RBucket(BaseModel):
    label: str
    count: int


class StreakInfo(BaseModel):
    # "win" | "loss" | "none" - "none" when the last trade was a breakeven or
    # there are no trades at all.
    type: str
    count: int


class RiskStatsResponse(BaseModel):
    trade_count: int
    # R stats cover only trades that have risk data. The UI must show the gap:
    # after a CSV import these can differ by a lot.
    trades_with_risk: int
    trades_missing_risk: int

    max_drawdown: float
    max_drawdown_start: datetime | None
    max_drawdown_end: datetime | None
    drawdown_curve: list[DrawdownPoint]

    r_multiple_distribution: list[RBucket]
    avg_r: float | None
    best_r: float | None
    worst_r: float | None

    longest_win_streak: int
    longest_loss_streak: int
    current_streak: StreakInfo


class SessionStat(BaseModel):
    key: str
    label: str
    start_hour: int
    end_hour: int
    trade_count: int
    win_count: int
    loss_count: int
    win_rate: float
    avg_pnl: float
    total_pnl: float


class SessionStatsResponse(BaseModel):
    trade_count: int
    sessions: list[SessionStat]
