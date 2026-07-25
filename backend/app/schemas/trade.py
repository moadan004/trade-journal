from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.trade import TradeSide, TradeStatus


class TradeCreate(BaseModel):
    account_id: int
    symbol: str
    side: TradeSide
    entry_time: datetime
    exit_time: datetime | None = None
    entry_price: float
    exit_price: float | None = None
    size: float
    pnl: float = 0
    fees: float = 0
    r_multiple: float | None = None
    tags: list[str] | None = None
    notes: str | None = None
    screenshot_url: str | None = None
    status: TradeStatus


class TradeUpdate(BaseModel):
    symbol: str | None = None
    side: TradeSide | None = None
    entry_time: datetime | None = None
    exit_time: datetime | None = None
    entry_price: float | None = None
    exit_price: float | None = None
    size: float | None = None
    pnl: float | None = None
    fees: float | None = None
    r_multiple: float | None = None
    tags: list[str] | None = None
    notes: str | None = None
    screenshot_url: str | None = None
    status: TradeStatus | None = None


class TradeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    symbol: str
    side: TradeSide
    entry_time: datetime
    exit_time: datetime | None
    entry_price: float
    exit_price: float | None
    size: float
    pnl: float
    fees: float
    r_multiple: float | None
    tags: list[str] | None
    notes: str | None
    screenshot_url: str | None
    status: TradeStatus
    created_at: datetime
    updated_at: datetime
