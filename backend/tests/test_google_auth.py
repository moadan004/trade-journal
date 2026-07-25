"""
Tests POST /auth/google account-linking logic and the existing /auth/login guard
for Google-only (password-less) accounts. Google's token verification is mocked
out (via app.routers.auth.google_id_token.verify_oauth2_token) since we don't
have real Google credentials to complete a genuine OAuth handshake in CI/dev -
everything downstream of that (account creation, linking, JWT issuance) is
exercised for real against the configured DATABASE_URL.

Run: pytest tests/test_google_auth.py -v -s
"""

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _mock_google_payload(sub: str, email: str) -> dict:
    return {"sub": sub, "email": email, "email_verified": True}


def test_google_auth_creates_new_user():
    email = f"google-new-{uuid.uuid4().hex[:8]}@example.com"
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"

    with patch(
        "app.routers.auth.google_id_token.verify_oauth2_token",
        return_value=_mock_google_payload(sub, email),
    ):
        resp = client.post("/auth/google", json={"id_token": "fake-token"})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]

    # The token should work like any other JWT for authenticated routes.
    resp = client.get("/accounts", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text

    # Calling again with the same sub should return the same user, not create another.
    with patch(
        "app.routers.auth.google_id_token.verify_oauth2_token",
        return_value=_mock_google_payload(sub, email),
    ):
        resp2 = client.post("/auth/google", json={"id_token": "fake-token"})
    assert resp2.status_code == 200, resp2.text
    token2 = resp2.json()["access_token"]

    account_resp = client.post(
        "/accounts",
        json={"name": "Test", "broker": None, "currency": "USD"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert account_resp.status_code == 201, account_resp.text

    # Same underlying user -> second token should see the account created by the first.
    list_resp = client.get("/accounts", headers={"Authorization": f"Bearer {token2}"})
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1


def test_google_auth_links_existing_password_account():
    email = f"link-{uuid.uuid4().hex[:8]}@example.com"
    password = "supersecret123"

    register_resp = client.post("/auth/register", json={"email": email, "password": password})
    assert register_resp.status_code == 201, register_resp.text
    password_token = register_resp.json()["access_token"]

    # Create an account under the password-based identity, to prove linking preserves it.
    account_resp = client.post(
        "/accounts",
        json={"name": "Linked Account", "broker": None, "currency": "USD"},
        headers={"Authorization": f"Bearer {password_token}"},
    )
    assert account_resp.status_code == 201, account_resp.text

    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    with patch(
        "app.routers.auth.google_id_token.verify_oauth2_token",
        return_value=_mock_google_payload(sub, email),
    ):
        google_resp = client.post("/auth/google", json={"id_token": "fake-token"})
    assert google_resp.status_code == 200, google_resp.text
    google_token = google_resp.json()["access_token"]

    # Same account -> the Google-issued token should see the account created earlier.
    list_resp = client.get("/accounts", headers={"Authorization": f"Bearer {google_token}"})
    assert list_resp.status_code == 200
    names = [a["name"] for a in list_resp.json()]
    assert names == ["Linked Account"]

    # The original password login should still work unaffected.
    login_resp = client.post("/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text


def test_login_rejected_for_google_only_account():
    email = f"googleonly-{uuid.uuid4().hex[:8]}@example.com"
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"

    with patch(
        "app.routers.auth.google_id_token.verify_oauth2_token",
        return_value=_mock_google_payload(sub, email),
    ):
        resp = client.post("/auth/google", json={"id_token": "fake-token"})
    assert resp.status_code == 200, resp.text

    # No password was ever set for this account, so password login must fail
    # with the same generic message used for "no such user" (no account-existence leak).
    login_resp = client.post("/auth/login", json={"email": email, "password": "whatever123"})
    assert login_resp.status_code == 401
    assert login_resp.json()["detail"] == "Invalid email or password"


def test_google_auth_invalid_token_rejected():
    with patch(
        "app.routers.auth.google_id_token.verify_oauth2_token",
        side_effect=ValueError("Token expired"),
    ):
        resp = client.post("/auth/google", json={"id_token": "garbage"})
    assert resp.status_code == 401
