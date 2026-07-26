from fastapi import APIRouter, Depends, HTTPException, Response, status
from google.auth import exceptions as google_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.deps import get_current_user
from app.models.user import User
from app.schemas.auth import GoogleAuthRequest, LoginRequest, RegisterRequest, TokenResponse
from app.schemas.user import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _set_auth_cookie(response: Response, token: str) -> None:
    """Attach the access token as an httpOnly cookie.

    max_age mirrors the JWT's own expiry so the cookie and the token stop being
    valid at the same time - otherwise the browser would keep sending a cookie
    the backend already rejects.
    """
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=str(user.id))
    _set_auth_cookie(response, token)
    # The token is still returned in the body during the transition release so
    # clients that haven't moved to cookies keep working. Removed in a follow-up.
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(subject=str(user.id))
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/google", response_model=TokenResponse)
def google_auth(payload: GoogleAuthRequest, response: Response, db: Session = Depends(get_db)):
    try:
        idinfo = google_id_token.verify_oauth2_token(
            payload.id_token, google_requests.Request(), settings.google_client_id
        )
    except (ValueError, google_exceptions.GoogleAuthError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token")

    google_sub = idinfo.get("sub")
    email = idinfo.get("email")
    if not google_sub or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token missing required claims"
        )

    user = db.query(User).filter(User.google_id == google_sub).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()
        if user is not None:
            user.google_id = google_sub
        else:
            user = User(email=email, google_id=google_sub, password_hash=None)
            db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=str(user.id))
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    """Clear the auth cookie.

    Needed because an httpOnly cookie is invisible to JavaScript, so the frontend
    cannot log out by itself the way it could when the token lived in
    localStorage. Deliberately unauthenticated: logging out should succeed even
    if the token has already expired.
    """
    response.delete_cookie(
        key=settings.cookie_name,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(get_current_user)):
    """Return the signed-in user.

    The frontend used to answer "am I logged in?" by reading the token out of
    localStorage. With an httpOnly cookie that's impossible, so it needs this
    round-trip instead. Returns 401 when there is no valid session.
    """
    return current_user
