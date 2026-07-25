from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.trade import Trade
from app.models.user import User
from app.schemas.stats import CalendarStatsResponse, DailyStat

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


@router.get("/calendar", response_model=CalendarStatsResponse)
def get_calendar_stats(
    month: str = Query(..., description="Target month in YYYY-MM format"),
    account_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start, end = _parse_month(month)

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
