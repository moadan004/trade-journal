"""
Tests for Phase 7: trade.setup_tag/checklist_json persistence, the
setup_tag filter on stats, and WeeklyReview CRUD (including the week
normalization and upsert-race handling).

Run: pytest tests/test_journal.py -v
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _register_with_account(client: TestClient) -> int:
    """Register a fresh user and account, returning the account id.

    A fresh user per test keeps WeeklyReview and setup_tag assertions from
    colliding with data other tests in this module create.
    """
    email = f"journal-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post("/auth/register", json={"email": email, "password": "supersecret123"})
    assert resp.status_code == 201, resp.text

    resp = client.post("/accounts", json={"name": "Journal Test", "broker": "Exness", "currency": "USD"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _trade_payload(account_id: int, **overrides) -> dict:
    entry = datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc)  # a Monday
    payload = {
        "account_id": account_id,
        "symbol": "XAUUSD",
        "side": "long",
        "entry_time": entry.isoformat(),
        "exit_time": (entry + timedelta(hours=1)).isoformat(),
        "entry_price": 2000.0,
        "exit_price": 2001.0,
        "size": 1.0,
        "pnl": 50.0,
        "fees": 0.0,
        "status": "win",
    }
    payload.update(overrides)
    return payload


CHECKLIST = {
    "checked_news_calendar": True,
    "risk_within_limit": True,
    "setup_matches_plan": False,
    "no_revenge_trade": True,
}


# --- trade setup_tag / checklist_json persistence -------------------------


def test_setup_tag_and_checklist_round_trip_on_create(client):
    account_id = _register_with_account(client)
    resp = client.post(
        "/trades",
        json=_trade_payload(account_id, setup_tag="ORB", checklist_json=CHECKLIST),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["setup_tag"] == "ORB"
    assert body["checklist_json"] == CHECKLIST

    # And on a fresh GET, not just the create response's echo.
    trade_id = body["id"]
    resp = client.get(f"/trades/{trade_id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["setup_tag"] == "ORB"
    assert resp.json()["checklist_json"] == CHECKLIST


def test_setup_tag_and_checklist_default_to_null(client):
    account_id = _register_with_account(client)
    resp = client.post("/trades", json=_trade_payload(account_id))
    assert resp.status_code == 201, resp.text
    assert resp.json()["setup_tag"] is None
    assert resp.json()["checklist_json"] is None


def test_setup_tag_and_checklist_update_via_put(client):
    account_id = _register_with_account(client)
    resp = client.post("/trades", json=_trade_payload(account_id))
    trade_id = resp.json()["id"]

    resp = client.put(
        f"/trades/{trade_id}",
        json={"setup_tag": "liquidity sweep", "checklist_json": CHECKLIST},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["setup_tag"] == "liquidity sweep"
    assert resp.json()["checklist_json"] == CHECKLIST

    # PUT is exclude_unset - omitting the fields on a later update must leave
    # them as they were, not wipe them back to null.
    resp = client.put(f"/trades/{trade_id}", json={"notes": "unrelated edit"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["setup_tag"] == "liquidity sweep"
    assert resp.json()["checklist_json"] == CHECKLIST


# --- setup_tag filter on stats ---------------------------------------------


def test_setup_tag_filters_stats_summary(client):
    account_id = _register_with_account(client)
    client.post("/trades", json=_trade_payload(account_id, setup_tag="ORB", pnl=100.0))
    client.post("/trades", json=_trade_payload(account_id, setup_tag="ORB", pnl=50.0))
    client.post("/trades", json=_trade_payload(account_id, setup_tag="reversal", pnl=-30.0))
    client.post("/trades", json=_trade_payload(account_id, pnl=10.0))  # no setup_tag

    resp = client.get("/stats/summary", params={"account_id": account_id, "setup_tag": "ORB"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["trade_count"] == 2
    assert data["total_pnl"] == pytest.approx(150.0)


def test_setup_tag_filter_is_exact_match_not_substring(client):
    account_id = _register_with_account(client)
    client.post("/trades", json=_trade_payload(account_id, setup_tag="ORB"))
    client.post("/trades", json=_trade_payload(account_id, setup_tag="ORB-continuation"))

    resp = client.get("/stats/summary", params={"account_id": account_id, "setup_tag": "ORB"})
    assert resp.json()["trade_count"] == 1


def test_setup_tag_filters_stats_risk_and_sessions(client):
    account_id = _register_with_account(client)
    client.post("/trades", json=_trade_payload(account_id, setup_tag="ORB", risk_amount=50.0, pnl=100.0))
    client.post("/trades", json=_trade_payload(account_id, setup_tag="reversal", risk_amount=50.0, pnl=-50.0))

    resp = client.get("/stats/risk", params={"account_id": account_id, "setup_tag": "ORB"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["trade_count"] == 1
    assert resp.json()["avg_r"] == pytest.approx(2.0)

    resp = client.get("/stats/sessions", params={"account_id": account_id, "setup_tag": "ORB"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["trade_count"] == 1


def test_setup_tag_filters_stats_calendar(client):
    account_id = _register_with_account(client)
    client.post("/trades", json=_trade_payload(account_id, setup_tag="ORB"))
    client.post("/trades", json=_trade_payload(account_id, setup_tag="reversal"))

    resp = client.get("/stats/calendar", params={"month": "2026-04", "account_id": account_id, "setup_tag": "ORB"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["total_pnl"] == pytest.approx(50.0)
    assert sum(d["trade_count"] for d in resp.json()["days"]) == 1


# --- WeeklyReview: basic CRUD ----------------------------------------------


def test_get_review_with_no_data_returns_blank_template_not_404(client):
    _register_with_account(client)
    resp = client.get("/reviews/2026-04-08")  # a Wednesday
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["reflections"] == ""
    assert body["id"] is None
    assert body["week_start_date"] == "2026-04-06"  # normalized to Monday


def test_put_creates_then_updates(client):
    _register_with_account(client)

    resp = client.put("/reviews/2026-04-08", json={"reflections": "First draft."})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["reflections"] == "First draft."
    assert body["id"] is not None
    review_id = body["id"]

    resp = client.put("/reviews/2026-04-09", json={"reflections": "Revised."})  # same week, Thursday
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["reflections"] == "Revised."
    assert body["id"] == review_id  # same row, not a duplicate


def test_post_creates_review(client):
    _register_with_account(client)
    resp = client.post("/reviews", json={"week_start_date": "2026-04-08", "reflections": "Good week."})
    assert resp.status_code == 201, resp.text
    assert resp.json()["week_start_date"] == "2026-04-06"
    assert resp.json()["reflections"] == "Good week."


def test_post_conflicts_if_review_already_exists_for_week(client):
    _register_with_account(client)
    client.post("/reviews", json={"week_start_date": "2026-04-08", "reflections": "First."})

    resp = client.post("/reviews", json={"week_start_date": "2026-04-09", "reflections": "Second."})
    assert resp.status_code == 409, resp.text


# --- WeeklyReview: week normalization ---------------------------------------


@pytest.mark.parametrize("day_in_week", ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09",
                                          "2026-04-10", "2026-04-11", "2026-04-12"])
def test_every_day_in_a_week_maps_to_the_same_monday(client, day_in_week):
    _register_with_account(client)
    resp = client.get(f"/reviews/{day_in_week}")
    assert resp.json()["week_start_date"] == "2026-04-06"


def test_adjacent_weeks_are_isolated(client):
    _register_with_account(client)
    client.put("/reviews/2026-04-08", json={"reflections": "Week of Apr 6."})
    client.put("/reviews/2026-04-15", json={"reflections": "Week of Apr 13."})

    assert client.get("/reviews/2026-04-08").json()["reflections"] == "Week of Apr 6."
    assert client.get("/reviews/2026-04-15").json()["reflections"] == "Week of Apr 13."
    # A neighboring, never-touched week must still be blank.
    assert client.get("/reviews/2026-04-22").json()["reflections"] == ""


# --- WeeklyReview: navigate-away-and-back persistence ----------------------


def test_review_persists_across_separate_requests(client):
    """Mirrors the manual check: write, navigate away, come back."""
    _register_with_account(client)
    client.put("/reviews/2026-04-08", json={"reflections": "Stuck to the plan all week."})

    # A brand-new TestClient instance simulates a fresh page load rather than
    # reusing in-memory state from the write above.
    fresh = TestClient(app)
    fresh.cookies.update(client.cookies)
    resp = fresh.get("/reviews/2026-04-10")
    assert resp.status_code == 200, resp.text
    assert resp.json()["reflections"] == "Stuck to the plan all week."


# --- WeeklyReview: cross-user isolation ------------------------------------


def test_reviews_are_isolated_per_user(client):
    _register_with_account(client)
    client.put("/reviews/2026-04-08", json={"reflections": "User A's private notes."})

    other = TestClient(app)
    _register_with_account(other)
    resp = other.get("/reviews/2026-04-08")
    assert resp.status_code == 200, resp.text
    assert resp.json()["reflections"] == ""  # not User A's text


def test_reviews_require_authentication(client):
    resp = client.get("/reviews/2026-04-08")
    assert resp.status_code == 401
    resp = client.put("/reviews/2026-04-08", json={"reflections": "x"})
    assert resp.status_code == 401
    resp = client.post("/reviews", json={"week_start_date": "2026-04-08", "reflections": "x"})
    assert resp.status_code == 401


# --- WeeklyReview: concurrent upsert on a never-touched week ---------------


def test_concurrent_upsert_on_new_week_does_not_500(client):
    """Regression test for the race the unique constraint guards against.

    Two upserts for a week neither has touched yet can both miss the SELECT
    and both attempt an INSERT; the second must recover via the constraint
    rather than surface a 500. A single-threaded test can't reproduce the race
    itself, but it pins the API contract the recovery path promises: calling
    PUT repeatedly for the same untouched week never errors and always
    converges on one row.
    """
    _register_with_account(client)
    for i in range(5):
        resp = client.put("/reviews/2026-05-04", json={"reflections": f"attempt {i}"})
        assert resp.status_code == 200, resp.text

    final = client.get("/reviews/2026-05-04")
    assert final.json()["reflections"] == "attempt 4"
