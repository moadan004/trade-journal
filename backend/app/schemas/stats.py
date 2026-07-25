from datetime import date

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
