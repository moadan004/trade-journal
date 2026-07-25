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
