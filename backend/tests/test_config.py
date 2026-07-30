"""
Tests config normalization that only ever bites in deployment.

The DATABASE_URL rewrite is the one worth pinning: Render hands out
`postgres://...`, SQLAlchemy doesn't accept that scheme, and the failure only
surfaces at startup on the deployed host - exactly where it's most annoying to
debug.

Run: pytest tests/test_config.py -v
"""

import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# database_url has no default, so anything not testing that must supply one.
_A_URL = "postgresql+psycopg://u:pw@db.test:5432/tj"


def _settings(**overrides) -> Settings:
    # _env_file=None so a developer's local .env can't influence the assertions.
    overrides.setdefault("database_url", _A_URL)
    return Settings(_env_file=None, **overrides)


def test_render_style_postgres_url_is_normalized():
    s = _settings(database_url="postgres://user:pw@dpg-abc123.oregon-postgres.render.com/tj")
    assert s.database_url == "postgresql+psycopg://user:pw@dpg-abc123.oregon-postgres.render.com/tj"


def test_bare_postgresql_url_gets_the_psycopg_driver():
    # Without this it would resolve to psycopg2, which isn't a dependency.
    s = _settings(database_url="postgresql://user:pw@localhost:5432/tj")
    assert s.database_url == "postgresql+psycopg://user:pw@localhost:5432/tj"


def test_already_correct_url_is_left_alone():
    url = "postgresql+psycopg://trade_journal:trade_journal@localhost:5432/trade_journal"
    assert _settings(database_url=url).database_url == url


def test_credentials_and_query_params_survive_normalization():
    s = _settings(database_url="postgres://u:p%40ss@host:5432/db?sslmode=require")
    assert s.database_url == "postgresql+psycopg://u:p%40ss@host:5432/db?sslmode=require"


def test_cors_origins_parses_and_trims():
    s = _settings(cors_origins="http://localhost:3000, https://app.vercel.app")
    assert s.cors_origin_list == ["http://localhost:3000", "https://app.vercel.app"]


def test_cors_origins_ignores_blanks():
    assert _settings(cors_origins="http://a.test, ,").cors_origin_list == ["http://a.test"]


def test_cookie_secure_defaults_off_for_local_http():
    # Production must override this to true; see render.yaml / README.
    assert _settings().cookie_secure is False


def test_missing_database_url_raises_instead_of_defaulting_to_localhost():
    """An unset DATABASE_URL must fail loudly, not quietly point at 127.0.0.1.

    The old default silently resolved to localhost:5432, which on Render means a
    crash-loop reporting "connection refused" to an address nobody configured.
    """
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None)

    message = str(exc.value)
    assert "database_url" in message
    # The whole point: no localhost anywhere in the failure path.
    assert "localhost" not in message
    assert "127.0.0.1" not in message


def test_alembic_accepts_a_percent_encoded_password():
    """A percent-encoded password must not crash alembic before it connects.

    `p%40ssword` is what a correctly-escaped literal `@` looks like in a
    connection string - routine for Supabase. Passing the URL through
    ConfigParser (via config.set_main_option) raised "invalid interpolation
    syntax" at parse time, so migrations died without ever opening a socket.

    Run as a subprocess because env.py reads get_settings() at import and that is
    @lru_cache'd for the life of a process. Port 1 is closed, so a *connection*
    error here is the pass condition: it proves config parsing got out of the way.
    """
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env={
            "PATH": "/usr/bin:/bin",
            "DATABASE_URL": "postgresql+psycopg://u:p%40ssword@127.0.0.1:1/tj",
        },
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode != 0, "expected the closed port to fail the connection"
    output = result.stdout + result.stderr
    assert "invalid interpolation syntax" not in output
    assert "ValueError" not in output
    # Got far enough to actually dial the socket.
    assert "OperationalError" in output or "connection failed" in output
