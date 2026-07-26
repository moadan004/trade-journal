"""
Tests the httpOnly-cookie auth path added in Phase 9A, and the dual-support
window where both the cookie and the Authorization header are accepted.

These lock in the behaviour that the rest of the app depends on: that a browser
with only a cookie can authenticate, that a pre-migration client sending only a
header still can, and that logout actually invalidates the browser's session.

Run: pytest tests/test_cookie_auth.py -v
"""

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

settings = get_settings()
COOKIE = settings.cookie_name


def _register(client: TestClient) -> tuple[str, str]:
    """Register a fresh user, returning (email, token). Leaves the cookie in the jar."""
    email = f"cookie-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post("/auth/register", json={"email": email, "password": "supersecret123"})
    assert resp.status_code == 201, resp.text
    return email, resp.json()["access_token"]


def test_register_sets_httponly_cookie_with_expected_flags():
    with TestClient(app) as client:
        resp = client.post(
            "/auth/register",
            json={"email": f"flags-{uuid.uuid4().hex[:8]}@example.com", "password": "supersecret123"},
        )
        assert resp.status_code == 201, resp.text
        assert COOKIE in client.cookies, "no auth cookie was set on register"

        # Assert on the raw header: the cookie jar doesn't surface HttpOnly, and
        # that flag is the entire point of moving off localStorage.
        headers = resp.headers.get_list("set-cookie")
        assert headers, "expected a set-cookie header"
        header = headers[0].lower()
        assert "httponly" in header
        assert "path=/" in header
        assert "max-age=" in header, "cookie should expire alongside the JWT"
        assert f"samesite={settings.cookie_samesite}" in header


def test_login_sets_cookie_and_cookie_only_request_authenticates():
    with TestClient(app) as client:
        email, _ = _register(client)
        client.cookies.clear()

        resp = client.post("/auth/login", json={"email": email, "password": "supersecret123"})
        assert resp.status_code == 200, resp.text
        assert COOKIE in client.cookies

        # No Authorization header anywhere - the cookie alone must be enough.
        me = client.get("/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["email"] == email

        # And it must work on an ordinary protected route too, not just /auth/me.
        accounts = client.get("/accounts")
        assert accounts.status_code == 200, accounts.text


def test_header_only_request_still_authenticates():
    """Dual-support: a client that predates the cookie migration keeps working."""
    with TestClient(app) as client:
        email, token = _register(client)
        client.cookies.clear()
        assert COOKIE not in client.cookies

        resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["email"] == email


def test_cookie_takes_precedence_over_header():
    """With both present the cookie wins, so a stale header can't override the session."""
    with TestClient(app) as client:
        _, token_a = _register(client)
        cookie_a = client.cookies[COOKIE]

        client.cookies.clear()
        email_b, _ = _register(client)
        cookie_b = client.cookies[COOKIE]
        assert cookie_a != cookie_b

        # Cookie for user B, header for user A -> should resolve to B.
        resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token_a}"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["email"] == email_b


def test_no_credentials_is_401():
    with TestClient(app) as client:
        resp = client.get("/auth/me")
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Could not validate credentials"


def test_invalid_cookie_is_401():
    with TestClient(app) as client:
        client.cookies.set(COOKIE, "not-a-real-jwt")
        resp = client.get("/auth/me")
        assert resp.status_code == 401


def test_logout_clears_cookie_and_session():
    with TestClient(app) as client:
        _register(client)
        assert client.get("/auth/me").status_code == 200

        resp = client.post("/auth/logout")
        assert resp.status_code == 204

        # The browser's jar no longer carries a usable cookie.
        assert client.cookies.get(COOKIE) in (None, "", '""')
        assert client.get("/auth/me").status_code == 401


def test_logout_succeeds_without_a_session():
    """Logout must not require auth, or an expired session could never be cleared."""
    with TestClient(app) as client:
        assert client.post("/auth/logout").status_code == 204


def test_google_auth_sets_cookie():
    email = f"gcookie-{uuid.uuid4().hex[:8]}@example.com"
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"

    with TestClient(app) as client:
        with patch(
            "app.routers.auth.google_id_token.verify_oauth2_token",
            return_value={"sub": sub, "email": email, "email_verified": True},
        ):
            resp = client.post("/auth/google", json={"id_token": "fake-token"})
        assert resp.status_code == 200, resp.text
        assert COOKIE in client.cookies

        me = client.get("/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == email
