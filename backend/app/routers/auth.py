from fastapi import APIRouter, Depends, HTTPException, status
from google.auth import exceptions as google_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import GoogleAuthRequest, LoginRequest, RegisterRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token)


@router.post("/google", response_model=TokenResponse)
def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
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
    return TokenResponse(access_token=token)
