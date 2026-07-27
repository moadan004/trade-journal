from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.trade import Trade
from app.models.user import User
from app.core.config import get_settings
from app.schemas.trade import ImportResult, TradeCreate, TradeRead, TradeUpdate
from app.services.csv_import import CsvImportError, parse_trade_history_csv
from app.services.export import trades_to_csv, trades_to_pdf
from app.services.uploads import delete_screenshot, save_screenshot

router = APIRouter(prefix="/trades", tags=["trades"])
settings = get_settings()


def _get_owned_account(db: Session, account_id: int, user: User) -> Account:
    account = db.get(Account, account_id)
    if account is None or account.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


def _get_owned_trade(db: Session, trade_id: int, user: User) -> Trade:
    trade = db.get(Trade, trade_id)
    if trade is None or trade.account.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trade not found")
    return trade


@router.post("", response_model=TradeRead, status_code=status.HTTP_201_CREATED)
def create_trade(
    payload: TradeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_account(db, payload.account_id, current_user)

    trade = Trade(**payload.model_dump())
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


@router.post("/import", response_model=ImportResult, status_code=status.HTTP_201_CREATED)
def import_trades_csv(
    account_id: int = Form(...),
    tag: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_owned_account(db, account_id, current_user)

    raw_bytes = file.file.read()
    try:
        content = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be UTF-8 encoded CSV.")

    try:
        parsed = parse_trade_history_csv(content, tag)
    except CsvImportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    for parsed_trade in parsed.trades:
        trade = Trade(account_id=account_id, **parsed_trade.model_dump())
        db.add(trade)
    db.commit()

    return ImportResult(
        total_rows=parsed.total_rows,
        imported=len(parsed.trades),
        skipped=parsed.skipped,
    )


@router.get("/export")
def export_trades(
    format: str = Query("csv", pattern="^(csv|pdf)$", description="csv or pdf"),
    start: date | None = None,
    end: date | None = None,
    account_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the filtered trades as a CSV or PDF file.

    Declared before /{trade_id} so "export" isn't captured as a trade id - path
    routes match in definition order, and int coercion would 422 rather than
    fall through.
    """
    query = db.query(Trade).join(Account).filter(Account.user_id == current_user.id)
    if account_id is not None:
        query = query.filter(Trade.account_id == account_id)
    if start is not None:
        query = query.filter(Trade.entry_time >= start)
    if end is not None:
        query = query.filter(Trade.entry_time < end)
    trades = query.order_by(Trade.entry_time, Trade.id).all()

    span = f"{start or 'all'}_{end or 'all'}"
    stem = f"trades_{span}"

    if format == "pdf":
        title = "Trade Journal export"
        if start or end:
            title += f" — {start or 'start'} to {end or 'today'}"
        return Response(
            content=trades_to_pdf(trades, title),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
        )

    return Response(
        content=trades_to_csv(trades),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{stem}.csv"'},
    )


@router.get("", response_model=list[TradeRead])
def list_trades(
    account_id: int | None = None,
    date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Trade).join(Account).filter(Account.user_id == current_user.id)
    if account_id is not None:
        query = query.filter(Trade.account_id == account_id)
    if date is not None:
        query = query.filter(func.date(Trade.entry_time) == date)
    return query.order_by(Trade.entry_time.desc()).all()


@router.get("/{trade_id}", response_model=TradeRead)
def get_trade(
    trade_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_owned_trade(db, trade_id, current_user)


@router.put("/{trade_id}", response_model=TradeRead)
def update_trade(
    trade_id: int,
    payload: TradeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trade = _get_owned_trade(db, trade_id, current_user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(trade, field, value)
    db.commit()
    db.refresh(trade)
    return trade


@router.delete("/{trade_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trade(
    trade_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trade = _get_owned_trade(db, trade_id, current_user)
    # Drop the image too, or it lingers with nothing pointing at it.
    delete_screenshot(trade.screenshot_url, settings.upload_dir)
    db.delete(trade)
    db.commit()


@router.post("/{trade_id}/screenshot", response_model=TradeRead)
def upload_screenshot(
    trade_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Attach a chart screenshot to a trade, replacing any existing one."""
    trade = _get_owned_trade(db, trade_id, current_user)

    url = save_screenshot(file, settings.upload_dir, settings.max_upload_bytes)
    # Only after the new file is safely written - a failed upload shouldn't
    # destroy the screenshot that's already there.
    previous = trade.screenshot_url
    trade.screenshot_url = url
    db.commit()
    db.refresh(trade)
    if previous != url:
        delete_screenshot(previous, settings.upload_dir)
    return trade


@router.delete("/{trade_id}/screenshot", response_model=TradeRead)
def remove_screenshot(
    trade_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trade = _get_owned_trade(db, trade_id, current_user)
    previous = trade.screenshot_url
    trade.screenshot_url = None
    db.commit()
    db.refresh(trade)
    delete_screenshot(previous, settings.upload_dir)
    return trade
