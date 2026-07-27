from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.trade import Trade, TradeStatus
from app.models.user import User
from app.schemas.stats import (
    AccountSummary,
    CalendarStatsResponse,
    DailyStat,
    DrawdownPoint,
    EquityPoint,
    RBucket,
    RiskStatsResponse,
    SessionStat,
    SessionStatsResponse,
    StreakInfo,
    SummaryStatsResponse,
)
from app.services import risk

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


def _filtered_trades(
    db: Session,
    user: User,
    start: date | None,
    end: date | None,
    account_id: int | None,
    tags: str | None,
    setup_tag: str | None = None,
    account_ids: list[int] | None = None,
) -> list[Trade]:
    """The user's trades under the standard analytics filters, in close order.

    Shared by /summary, /risk and /sessions so the three always describe the
    same set of trades - and, because drawdown and streaks are order-dependent,
    the same sequence as the equity curve.

    `account_id` (single) and `account_ids` (multi, for the comparison view) are
    both supported and intersect when both are given. The join to Account is what
    scopes results to the caller, so an account_id belonging to someone else
    simply matches nothing rather than leaking.
    """
    query = db.query(Trade).join(Account).filter(Account.user_id == user.id)
    if account_id is not None:
        query = query.filter(Trade.account_id == account_id)
    if account_ids:
        query = query.filter(Trade.account_id.in_(account_ids))
    tags_list = _parse_tags(tags)
    if tags_list:
        query = query.filter(Trade.tags.overlap(tags_list))
    # Exact match, not overlap: unlike `tags`, setup_tag is single-valued per
    # trade, so there's no "matches any of" case to support.
    if setup_tag:
        query = query.filter(Trade.setup_tag == setup_tag)
    if start is not None:
        query = query.filter(Trade.entry_time >= start)
    if end is not None:
        query = query.filter(Trade.entry_time < end)

    return query.order_by(func.coalesce(Trade.exit_time, Trade.entry_time), Trade.id).all()


def _aggregate(trades: list[Trade]) -> dict:
    """The headline stats for a set of trades.

    Extracted so the combined total and each per-account card are computed by
    exactly the same code - otherwise the breakdown can drift from the total
    it's meant to decompose.
    """
    trade_count = len(trades)
    win_count = sum(1 for t in trades if t.status == TradeStatus.win)
    loss_count = sum(1 for t in trades if t.status == TradeStatus.loss)

    pnls = [float(t.pnl) for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_loss = abs(sum(losses))

    return {
        "trade_count": trade_count,
        "win_count": win_count,
        "loss_count": loss_count,
        "breakeven_count": trade_count - win_count - loss_count,
        "win_rate": (win_count / trade_count) if trade_count else 0.0,
        "total_pnl": sum(pnls),
        "avg_win": (sum(wins) / len(wins)) if wins else 0.0,
        "avg_loss": (sum(losses) / len(losses)) if losses else 0.0,
        "profit_factor": (sum(wins) / gross_loss) if gross_loss > 0 else None,
    }


@router.get("/calendar", response_model=CalendarStatsResponse)
def get_calendar_stats(
    month: str = Query(..., description="Target month in YYYY-MM format"),
    account_id: int | None = None,
    tags: str | None = Query(None, description="Comma-separated tags; matches trades with any of them"),
    setup_tag: str | None = None,
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
    if setup_tag:
        query = query.filter(Trade.setup_tag == setup_tag)

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
    setup_tag: str | None = None,
    account_ids: list[int] | None = Query(
        None, description="Repeatable; restricts to these accounts and adds a per-account breakdown"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Aggregate stats and equity curve.

    Passing `account_ids` (repeatable) additionally returns `by_account` - the
    same figures computed per account, for the comparison view. The top-level
    numbers stay the combined total across whatever is selected, so the response
    is a superset of what single-account callers already receive.
    """
    # Both optional filters passed by keyword: they are adjacent optional
    # parameters of the same arity, so positional args here are one reordering
    # away from silently filtering on the wrong thing.
    trades = _filtered_trades(
        db, current_user, start, end, account_id, tags, setup_tag=setup_tag, account_ids=account_ids
    )

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

    by_account: list[AccountSummary] = []
    if account_ids:
        # Names come from a single lookup rather than trade.account per row, and
        # the query is user-scoped so an id the caller doesn't own is dropped
        # here instead of appearing as an empty card.
        owned = (
            db.query(Account)
            .filter(Account.user_id == current_user.id, Account.id.in_(account_ids))
            .order_by(Account.id)
            .all()
        )
        for account in owned:
            account_trades = [t for t in trades if t.account_id == account.id]
            by_account.append(
                AccountSummary(account_id=account.id, account_name=account.name, **_aggregate(account_trades))
            )

    return SummaryStatsResponse(
        **_aggregate(trades),
        equity_curve=equity_curve,
        by_account=by_account,
    )


@router.get("/risk", response_model=RiskStatsResponse)
def get_risk_stats(
    start: date | None = None,
    end: date | None = None,
    account_id: int | None = None,
    tags: str | None = Query(None, description="Comma-separated tags; matches trades with any of them"),
    setup_tag: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Drawdown, R distribution and streaks over the filtered trades.

    Drawdown and streaks use every trade. The R distribution uses only trades
    with risk data, which is why trades_missing_risk is reported alongside it -
    an R histogram built from 3 of 200 trades is misleading without that number.
    """
    trades = _filtered_trades(db, current_user, start, end, account_id, tags, setup_tag=setup_tag)

    worst_dd, dd_start, dd_end = risk.max_drawdown(trades)
    buckets, r_values = risk.r_distribution(trades)
    longest_win, longest_loss, streak_type, streak_count = risk.streaks(trades)

    return RiskStatsResponse(
        trade_count=len(trades),
        trades_with_risk=len(r_values),
        trades_missing_risk=len(trades) - len(r_values),
        max_drawdown=worst_dd,
        max_drawdown_start=dd_start,
        max_drawdown_end=dd_end,
        drawdown_curve=[DrawdownPoint(**point) for point in risk.drawdown_series(trades)],
        r_multiple_distribution=[RBucket(label=label, count=count) for label, count in buckets],
        avg_r=(sum(r_values) / len(r_values)) if r_values else None,
        best_r=max(r_values) if r_values else None,
        worst_r=min(r_values) if r_values else None,
        longest_win_streak=longest_win,
        longest_loss_streak=longest_loss,
        current_streak=StreakInfo(type=streak_type, count=streak_count),
    )


@router.get("/sessions", response_model=SessionStatsResponse)
def get_session_stats(
    start: date | None = None,
    end: date | None = None,
    account_id: int | None = None,
    tags: str | None = Query(None, description="Comma-separated tags; matches trades with any of them"),
    setup_tag: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Performance split by trading session, bucketed on entry_time in UTC."""
    trades = _filtered_trades(db, current_user, start, end, account_id, tags, setup_tag=setup_tag)
    return SessionStatsResponse(
        trade_count=len(trades),
        sessions=[SessionStat(**row) for row in risk.session_breakdown(trades)],
    )
