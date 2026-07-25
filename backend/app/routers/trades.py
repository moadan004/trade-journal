from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.deps import get_current_user
from app.models.account import Account
from app.models.trade import Trade
from app.models.user import User
from app.schemas.trade import TradeCreate, TradeRead, TradeUpdate

router = APIRouter(prefix="/trades", tags=["trades"])


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


@router.get("", response_model=list[TradeRead])
def list_trades(
    account_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Trade).join(Account).filter(Account.user_id == current_user.id)
    if account_id is not None:
        query = query.filter(Trade.account_id == account_id)
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
    db.delete(trade)
    db.commit()
