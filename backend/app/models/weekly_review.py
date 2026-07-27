from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class WeeklyReview(Base):
    """One free-text reflection per user per week.

    Hangs off the user rather than an account: a week's reflection is about how
    you traded, not about one broker connection, and splitting it per account
    would mean writing the same note twice.
    """

    __tablename__ = "weekly_reviews"
    __table_args__ = (
        # One review per user per week, enforced in the database rather than only
        # in the route. The write path is an upsert keyed on (user, week), so a
        # double-submit racing itself must not be able to create a second row -
        # that would leave the GET picking one arbitrarily and silently losing
        # whichever it didn't pick.
        UniqueConstraint("user_id", "week_start_date", name="uq_weekly_review_user_week"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Always the Monday of the week, normalized on write. Storing whatever date
    # the client sent would let Tuesday and Wednesday of one week address two
    # different rows.
    week_start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    reflections: Mapped[str] = mapped_column(String, nullable=False, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="weekly_reviews")
