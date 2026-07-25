from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.trade import Trade, TradeStatus
from app.models.user import User
from app.schemas.stats import CalendarStatsResponse, DailyStat, EquityPoint, SummaryStatsResponse

router = APIRouter(prefix="/stats", tags=["stats"])


def _parse_month(month: str) -> tuple[date, date]:
    try:
        year_str, month_str = month.split("-")
        year, month_num = int(year_str), int(month_str)
        if not 1 <= month_num <= 12:
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month must be in YYYY-MM format")

    start = date(year, month_num, 1)
    end = date(year + 1, 1, 1) if month_num == 12 else date(year, month_num + 1, 1)
    return start, end


def _parse_tags(tags: str | None) -> list[str] | None:
    if not tags:
        return None
    parsed = [t.strip() for t in tags.split(",") if t.strip()]
    return parsed or None


@router.get("/calendar", response_model=CalendarStatsResponse)
def get_calendar_stats(
    month: str = Query(..., description="Target month in YYYY-MM format"),
    account_id: int | None = None,
    tags: str | None = Query(None, description="Comma-separated tags; matches trades with any of them"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start, end = _parse_month(month)
    tags_list = _parse_tags(tags)

    day_col = func.date(Trade.entry_time)
    wins_col = func.sum(case((Trade.pnl > 0, 1), else_=0))

    query = (
        db.query(
            day_col.label("day"),
            func.sum(Trade.pnl).label("pnl"),
            func.count(Trade.id).label("trade_count"),
            wins_col.label("wins"),
        )
        .join(Account)
        .filter(Account.user_id == current_user.id)
        .filter(Trade.entry_time >= start)
        .filter(Trade.entry_time < end)
    )
    if account_id is not None:
        query = query.filter(Trade.account_id == account_id)
    if tags_list:
        query = query.filter(Trade.tags.overlap(tags_list))

    rows = query.group_by(day_col).order_by(day_col).all()

    days = [
        DailyStat(
            date=row.day,
            pnl=float(row.pnl or 0),
            trade_count=row.trade_count,
            win_rate=(float(row.wins) / row.trade_count) if row.trade_count else 0.0,
        )
        for row in rows
    ]

    return CalendarStatsResponse(
        month=month,
        days=days,
        total_pnl=sum(d.pnl for d in days),
        trading_days=len(days),
    )


@router.get("/summary", response_model=SummaryStatsResponse)
def get_summary_stats(
    start: date | None = None,
    end: date | None = None,
    account_id: int | None = None,
    tags: str | None = Query(None, description="Comma-separated tags; matches trades with any of them"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tags_list = _parse_tags(tags)

    query = db.query(Trade).join(Account).filter(Account.user_id == current_user.id)
    if account_id is not None:
        query = query.filter(Trade.account_id == account_id)
    if tags_list:
        query = query.filter(Trade.tags.overlap(tags_list))
    if start is not None:
        query = query.filter(Trade.entry_time >= start)
    if end is not None:
        query = query.filter(Trade.entry_time < end)

    trades = query.order_by(func.coalesce(Trade.exit_time, Trade.entry_time)).all()

    trade_count = len(trades)
    win_count = sum(1 for t in trades if t.status == TradeStatus.win)
    loss_count = sum(1 for t in trades if t.status == TradeStatus.loss)
    breakeven_count = trade_count - win_count - loss_count

    pnls = [float(t.pnl) for t in trades]
    total_pnl = sum(pnls)
    win_rate = (win_count / trade_count) if trade_count else 0.0

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]

    avg_win = (sum(wins) / len(wins)) if wins else 0.0
    avg_loss = (sum(losses) / len(losses)) if losses else 0.0

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else None

    cumulative = 0.0
    equity_curve: list[EquityPoint] = []
    for trade in trades:
        cumulative += float(trade.pnl)
        equity_curve.append(
            EquityPoint(
                date=trade.exit_time or trade.entry_time,
                pnl=float(trade.pnl),
                cumulative_pnl=cumulative,
            )
        )

    return SummaryStatsResponse(
        trade_count=trade_count,
        win_count=win_count,
        loss_count=loss_count,
        breakeven_count=breakeven_count,
        win_rate=win_rate,
        total_pnl=total_pnl,
        avg_win=avg_win,
        avg_loss=avg_loss,
        profit_factor=profit_factor,
        equity_curve=equity_curve,
    )
