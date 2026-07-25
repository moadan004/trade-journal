"""
End-to-end smoke test: register -> login -> create account -> create trade
-> hit the calendar stats endpoint.

Run against the DB configured by DATABASE_URL (see .env / .env.example).
    pytest tests/test_smoke.py -v
"""

import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_full_flow():
    email = f"smoke-{uuid.uuid4().hex[:8]}@example.com"
    password = "supersecret123"

    # Register
    resp = client.post("/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text
    token = resp.json()["access_token"]

    # Login
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create account
    resp = client.post(
        "/accounts",
        json={"name": "MT5 Live", "broker": "Exness", "currency": "USD"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    account_id = resp.json()["id"]

    # Create trade
    today = datetime.now(timezone.utc)
    resp = client.post(
        "/trades",
        json={
            "account_id": account_id,
            "symbol": "XAUUSD",
            "side": "long",
            "entry_time": today.isoformat(),
            "exit_time": today.isoformat(),
            "entry_price": 2400.5,
            "exit_price": 2410.0,
            "size": 1.0,
            "pnl": 95.0,
            "fees": 5.0,
            "status": "win",
            "tags": ["scalp", "XAUUSD"],
            "notes": "smoke test trade",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    trade = resp.json()
    assert trade["symbol"] == "XAUUSD"

    # Calendar stats
    month = today.strftime("%Y-%m")
    resp = client.get(f"/stats/calendar?month={month}", headers=headers)
    assert resp.status_code == 200, resp.text
    stats = resp.json()
    assert stats["month"] == month
    assert stats["total_pnl"] == 95.0
    assert stats["trading_days"] == 1
    assert stats["days"][0]["trade_count"] == 1
    assert stats["days"][0]["win_rate"] == 1.0

    print("\nSmoke test passed:")
    print(f"  user={email}")
    print(f"  account_id={account_id} trade_id={trade['id']}")
    print(f"  calendar stats for {month}: {stats}")
