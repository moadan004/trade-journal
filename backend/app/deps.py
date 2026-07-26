from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

settings = get_settings()

# auto_error=False is essential: with the default (True) this dependency raises
# 401 whenever the Authorization header is absent, which would reject every
# cookie-authenticated request before we ever look at the cookie. It stays
# declared so the token field still shows up in the OpenAPI docs / Swagger UI.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def get_token_from_request(
    request: Request,
    header_token: str | None = Depends(oauth2_scheme),
) -> str | None:
    """Resolve the access token, preferring the httpOnly cookie.

    Cookie wins over the Authorization header. During the transition release both
    are accepted, so a browser tab still holding a localStorage token from before
    the cookie migration keeps working instead of being logged out mid-session.
    The header fallback is scheduled for removal once cookies are confirmed in
    production.
    """
    cookie_token = request.cookies.get(settings.cookie_name)
    if cookie_token:
        return cookie_token
    return header_token


def get_current_user(
    token: str | None = Depends(get_token_from_request),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception

    user_id = decode_access_token(token)
    if user_id is None:
        raise credentials_exception

    user = db.get(User, int(user_id))
    if user is None:
        raise credentials_exception
    return user
