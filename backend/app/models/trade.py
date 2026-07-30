import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TradeSide(str, enum.Enum):
    long = "long"
    short = "short"


class TradeStatus(str, enum.Enum):
    win = "win"
    loss = "loss"
    breakeven = "breakeven"


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)

    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    side: Mapped[TradeSide] = mapped_column(Enum(TradeSide, name="trade_side"), nullable=False)

    entry_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    entry_price: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False)
    exit_price: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)

    size: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False)
    pnl: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    fees: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)

    # Money at risk when the trade was opened (entry -> stop, in account currency).
    # Nullable: every trade created before Phase 6 - and every CSV import, which
    # has no risk column - predates this field. Risk stats derive R from it.
    risk_amount: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    # Explicit R override. Normally left NULL and R is derived as pnl/risk_amount;
    # set it only when R is known but the dollar risk isn't. See app/services/risk.py.
    r_multiple: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)

    # Instrument/context tags, free-form and many-per-trade ("scalp", "london").
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(50)), nullable=True)
    # The setup traded, exactly one per trade ("ORB", "liquidity sweep"). Kept
    # separate from `tags` rather than folded into it: "which setup was this" is a
    # single-valued question, and mixing it into a multi-valued array would make
    # "group by setup" ambiguous for trades carrying several tags.
    setup_tag: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    # Pre-trade discipline checklist, stored as {item_key: bool}. JSONB rather
    # than columns because the item list is expected to change, and a schema
    # migration per checklist edit would be absurd; nullable because every trade
    # logged before Phase 7, and every CSV import, has no answers.
    checklist_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    screenshot_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[TradeStatus] = mapped_column(Enum(TradeStatus, name="trade_status"), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    account: Mapped["Account"] = relationship(back_populates="trades")
