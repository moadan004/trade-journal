from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.weekly_review import WeeklyReview
from app.schemas.weekly_review import WeeklyReviewCreate, WeeklyReviewRead, WeeklyReviewUpdate

router = APIRouter(prefix="/reviews", tags=["reviews"])


def _monday_of(on_date: date) -> date:
    """The Monday of the week containing `on_date`.

    Every route takes a date anywhere in the target week and normalizes here,
    so Tuesday and Wednesday of the same week always resolve to one row instead
    of silently addressing two.
    """
    return on_date - timedelta(days=on_date.isoweekday() - 1)


def _get_review(db: Session, user: User, monday: date) -> WeeklyReview | None:
    return (
        db.query(WeeklyReview)
        .filter(WeeklyReview.user_id == user.id, WeeklyReview.week_start_date == monday)
        .first()
    )


@router.get("/{on_date}", response_model=WeeklyReviewRead)
def get_review(
    on_date: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    monday = _monday_of(on_date)
    review = _get_review(db, current_user, monday)
    if review is None:
        return WeeklyReviewRead(week_start_date=monday, reflections="")
    return review


@router.post("", response_model=WeeklyReviewRead, status_code=status.HTTP_201_CREATED)
def create_review(
    payload: WeeklyReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    monday = _monday_of(payload.week_start_date)
    if _get_review(db, current_user, monday) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A review for this week already exists; use PUT to update it.",
        )

    review = WeeklyReview(user_id=current_user.id, week_start_date=monday, reflections=payload.reflections)
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


@router.put("/{on_date}", response_model=WeeklyReviewRead)
def upsert_review(
    on_date: date,
    payload: WeeklyReviewUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    monday = _monday_of(on_date)
    review = _get_review(db, current_user, monday)
    if review is not None:
        review.reflections = payload.reflections
        db.commit()
        db.refresh(review)
        return review

    review = WeeklyReview(user_id=current_user.id, week_start_date=monday, reflections=payload.reflections)
    db.add(review)
    try:
        db.commit()
    except IntegrityError:
        # Two upserts for the same never-before-seen week raced each other; the
        # unique constraint on (user_id, week_start_date) caught it. Fall back to
        # updating whichever row won, rather than surfacing a 500 for what the
        # caller experiences as an ordinary save.
        db.rollback()
        review = _get_review(db, current_user, monday)
        review.reflections = payload.reflections
        db.commit()
    db.refresh(review)
    return review
