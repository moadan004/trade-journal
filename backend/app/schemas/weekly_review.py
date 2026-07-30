from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class WeeklyReviewCreate(BaseModel):
    # Any date within the target week; the server normalizes it to that week's
    # Monday, so the caller never needs to compute the boundary itself.
    week_start_date: date
    reflections: str = ""


class WeeklyReviewUpdate(BaseModel):
    reflections: str


class WeeklyReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # None when no review has been written for the week yet - GET returns a
    # blank template rather than 404, so the frontend always has a reflections
    # field to bind the textarea to without a separate "does it exist" check.
    id: int | None = None
    week_start_date: date
    reflections: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
