"""
Tests config normalization that only ever bites in deployment.

The DATABASE_URL rewrite is the one worth pinning: Render hands out
`postgres://...`, SQLAlchemy doesn't accept that scheme, and the failure only
surfaces at startup on the deployed host - exactly where it's most annoying to
debug.

Run: pytest tests/test_config.py -v
"""

from app.core.config import Settings


def _settings(**overrides) -> Settings:
    # _env_file=None so a developer's local .env can't influence the assertions.
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
