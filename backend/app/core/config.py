from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://trade_journal:trade_journal@localhost:5432/trade_journal"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    google_client_id: str = "your-client-id.apps.googleusercontent.com"

    # Name of the httpOnly cookie carrying the access token.
    cookie_name: str = "access_token"
    # Must be True in production (HTTPS). Left False by default so the cookie
    # still works over plain http on localhost during development.
    cookie_secure: bool = False
    # "lax" is sufficient because production serves the API same-site via a
    # Vercel rewrite (/api/* -> backend). If the frontend ever calls the backend
    # cross-site directly, this would need "none" *and* CSRF tokens.
    cookie_samesite: str = "lax"

    # Comma-separated list of allowed browser origins. Only needed for local
    # dev (:3000 -> :8000); the production proxy makes requests same-origin.
    cors_origins: str = "http://localhost:3000"

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        """Coerce a managed-provider URL into the driver form SQLAlchemy needs.

        Render (and Heroku, and others) expose Postgres as `postgres://...`.
        SQLAlchemy doesn't recognise that scheme at all, and even `postgresql://`
        would resolve to psycopg2, which isn't installed - we use psycopg 3. Left
        unnormalized this fails at startup, which is an unpleasant way to discover
        it mid-deploy, so accept either spelling and rewrite it here.
        """
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
