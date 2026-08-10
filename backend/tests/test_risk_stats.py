"""
Tests /stats/risk and /stats/sessions against a hand-calculated fixture.

Everything here is checked against the table in FIXTURE below, whose expected
values were worked out on paper before the code was run - see the module
docstring comments for each calculation. The point is to catch arithmetic that
is plausible but wrong, which "the chart rendered" cannot.

The same 12 trades exercise both endpoints, so the two views are guaranteed to
describe the same set of trades.

Run: pytest tests/test_risk_stats.py -v
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.trade import Trade, TradeStatus
from app.services import risk as risk_service

# (label, entry hour UTC offset from the first day, pnl, risk_amount, status)
#
# entry_time is day D at hour H UTC; exit_time is always entry + 1h, which keeps
# close order identical to the order listed here. risk_amount of None means the
# trade predates Phase 6 and must be excluded from R stats.
#
#  #   day  hour   pnl   risk   R = pnl/risk   status     session
#  1   02   02:30  +100    50   +2.0           win        asia_pacific
#  2   02   09:15   -50    50   -1.0           loss       london
#  3   02   14:00  +200    50   +4.0           win        overlap
#  4   03   17:00  -150    50   -3.0           loss       new_york
#  5   03   22:30  -100    50   -2.0           loss       sydney
#  6   04   03:00   +25    50   +0.5           win        asia_pacific
#  7   04   10:00     0    50    0.0           breakeven  london
#  8   05   14:30   +75    50   +1.5           win        overlap
#  9   05   18:00  -200  None   (excluded)     loss       new_york
# 10   06   11:00   +60    40   +1.5           win        london
# 11   06   15:00   +30    30   +1.0           win        overlap
# 12   06   19:00   +90    30   +3.0           win        new_york
FIXTURE = [
    (datetime(2026, 3, 2, 2, 30, tzinfo=timezone.utc), 100.0, 50.0, "win"),
    (datetime(2026, 3, 2, 9, 15, tzinfo=timezone.utc), -50.0, 50.0, "loss"),
    (datetime(2026, 3, 2, 14, 0, tzinfo=timezone.utc), 200.0, 50.0, "win"),
    (datetime(2026, 3, 3, 17, 0, tzinfo=timezone.utc), -150.0, 50.0, "loss"),
    (datetime(2026, 3, 3, 22, 30, tzinfo=timezone.utc), -100.0, 50.0, "loss"),
    (datetime(2026, 3, 4, 3, 0, tzinfo=timezone.utc), 25.0, 50.0, "win"),
    (datetime(2026, 3, 4, 10, 0, tzinfo=timezone.utc), 0.0, 50.0, "breakeven"),
    (datetime(2026, 3, 5, 14, 30, tzinfo=timezone.utc), 75.0, 50.0, "win"),
    (datetime(2026, 3, 5, 18, 0, tzinfo=timezone.utc), -200.0, None, "loss"),
    (datetime(2026, 3, 6, 11, 0, tzinfo=timezone.utc), 60.0, 40.0, "win"),
    (datetime(2026, 3, 6, 15, 0, tzinfo=timezone.utc), 30.0, 30.0, "win"),
    (datetime(2026, 3, 6, 19, 0, tzinfo=timezone.utc), 90.0, 30.0, "win"),
]


@pytest.fixture(scope="module")
def seeded() -> tuple[TestClient, int]:
    """A fresh user + account loaded with FIXTURE. Yields (client, account_id).

    Seeding through the API rather than the ORM so the test also proves
    risk_amount survives the TradeCreate schema and the POST /trades route.
    """
    client = TestClient(app)
    email = f"risk-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post("/auth/register", json={"email": email, "password": "supersecret123"})
    assert resp.status_code == 201, resp.text

    resp = client.post("/accounts", json={"name": "Risk Fixture", "broker": "Exness", "currency": "USD"})
    assert resp.status_code == 201, resp.text
    account_id = resp.json()["id"]

    for entry, pnl, risk_amount, status in FIXTURE:
        resp = client.post(
            "/trades",
            json={
                "account_id": account_id,
                "symbol": "XAUUSD",
                "side": "long",
                "entry_time": entry.isoformat(),
                "exit_time": (entry + timedelta(hours=1)).isoformat(),
                "entry_price": 2000.0,
                "exit_price": 2001.0,
                "size": 1.0,
                "pnl": pnl,
                "fees": 0.0,
                "risk_amount": risk_amount,
                "status": status,
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["risk_amount"] == risk_amount

    return client, account_id


def _risk(seeded) -> dict:
    client, account_id = seeded
    resp = client.get("/stats/risk", params={"account_id": account_id})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _sessions(seeded) -> dict:
    client, account_id = seeded
    resp = client.get("/stats/sessions", params={"account_id": account_id})
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- drawdown -------------------------------------------------------------
#
# Cumulative P&L after each trade, with the running peak (starting at 0):
#   t1  +100 -> 100   peak 100   dd    0
#   t2   -50 ->  50   peak 100   dd  -50
#   t3  +200 -> 250   peak 250   dd    0
#   t4  -150 -> 100   peak 250   dd -150
#   t5  -100 ->   0   peak 250   dd -250
#   t6   +25 ->  25   peak 250   dd -225
#   t7     0 ->  25   peak 250   dd -225
#   t8   +75 -> 100   peak 250   dd -150
#   t9  -200 -> -100  peak 250   dd -350   <- worst
#   t10  +60 ->  -40  peak 250   dd -290
#   t11  +30 ->  -10  peak 250   dd -260
#   t12  +90 ->   80  peak 250   dd -170
#
# max drawdown = 350, running from the t3 peak to the t9 trough.


def test_max_drawdown_matches_hand_calculation(seeded):
    assert _risk(seeded)["max_drawdown"] == pytest.approx(350.0)


def test_drawdown_peak_and_trough_are_the_right_trades(seeded):
    data = _risk(seeded)
    # Dates are exit times: t3 closed 15:00 on the 2nd, t9 closed 19:00 on the 5th.
    assert data["max_drawdown_start"].startswith("2026-03-02T15:00:00")
    assert data["max_drawdown_end"].startswith("2026-03-05T19:00:00")


def test_drawdown_curve_matches_hand_calculation(seeded):
    curve = _risk(seeded)["drawdown_curve"]
    expected_cumulative = [100, 50, 250, 100, 0, 25, 25, 100, -100, -40, -10, 80]
    expected_drawdown = [0, -50, 0, -150, -250, -225, -225, -150, -350, -290, -260, -170]

    assert len(curve) == 12
    assert [p["cumulative_pnl"] for p in curve] == pytest.approx(expected_cumulative)
    assert [p["drawdown"] for p in curve] == pytest.approx(expected_drawdown)
    # Peak is monotonically non-decreasing by construction; check it never dips.
    peaks = [p["peak"] for p in curve]
    assert peaks == sorted(peaks)


# --- R-multiple distribution ---------------------------------------------
#
# R values, in trade order (t9 has no risk_amount and is excluded):
#   +2.0, -1.0, +4.0, -3.0, -2.0, +0.5, 0.0, +1.5, +1.5, +1.0, +3.0
# 11 values from 12 trades. Sum = 7.5, so avg R = 7.5 / 11 = 0.681818...
#
# Buckets are half-open [lower, upper):
#   < -3R        : none                     -> 0
#   -3R to -2R   : -3.0                     -> 1
#   -2R to -1R   : -2.0                     -> 1
#   -1R to 0R    : -1.0                     -> 1
#   0R to 1R     : 0.0, 0.5                 -> 2
#   1R to 2R     : 1.5, 1.5, 1.0            -> 3
#   2R to 3R     : 2.0                      -> 1
#   3R+          : 4.0, 3.0                 -> 2
#                                              == 11


def test_r_distribution_matches_hand_calculation(seeded):
    data = _risk(seeded)
    assert [(b["label"], b["count"]) for b in data["r_multiple_distribution"]] == [
        ("< -3R", 0),
        ("-3R to -2R", 1),
        ("-2R to -1R", 1),
        ("-1R to 0R", 1),
        ("0R to 1R", 2),
        ("1R to 2R", 3),
        ("2R to 3R", 1),
        ("3R+", 2),
    ]
    assert sum(b["count"] for b in data["r_multiple_distribution"]) == data["trades_with_risk"]


def test_trades_without_risk_are_excluded_not_counted_as_zero(seeded):
    data = _risk(seeded)
    assert data["trade_count"] == 12
    assert data["trades_with_risk"] == 11
    assert data["trades_missing_risk"] == 1


def test_avg_best_and_worst_r(seeded):
    data = _risk(seeded)
    assert data["avg_r"] == pytest.approx(7.5 / 11)
    assert data["best_r"] == pytest.approx(4.0)
    assert data["worst_r"] == pytest.approx(-3.0)


# --- streaks --------------------------------------------------------------
#
# Statuses in close order:
#   win, loss, win, loss, loss, win, breakeven, win, loss, win, win, win
#
#   t1  win       -> win 1        longest win  1
#   t2  loss      -> loss 1       longest loss 1
#   t3  win       -> win 1
#   t4  loss      -> loss 1
#   t5  loss      -> loss 2       longest loss 2
#   t6  win       -> win 1
#   t7  breakeven -> reset to none/0
#   t8  win       -> win 1
#   t9  loss      -> loss 1
#   t10 win       -> win 1
#   t11 win       -> win 2
#   t12 win       -> win 3        longest win  3
#
# longest win 3, longest loss 2, current streak = 3 wins.


def test_streaks_match_hand_calculation(seeded):
    data = _risk(seeded)
    assert data["longest_win_streak"] == 3
    assert data["longest_loss_streak"] == 2
    assert data["current_streak"] == {"type": "win", "count": 3}


# --- session breakdown ----------------------------------------------------
#
# Bucketed on entry hour in UTC:
#   asia_pac  00-06 : t1 (02:30 win +100), t6 (03:00 win +25)
#                     2 trades, 2 wins, win rate 1.0,  total +125, avg +62.50
#   london    08-13 : t2 (09:15 loss -50), t7 (10:00 be 0), t10 (11:00 win +60)
#                     3 trades, 1 win,    win rate 1/3,  total  +10, avg  +3.333
#   overlap   13-16 : t3 (14:00 win +200), t8 (14:30 win +75), t11 (15:00 win +30)
#                     3 trades, 3 wins,   win rate 1.0,  total +305, avg +101.667
#   new_york  16-21 : t4 (17:00 loss -150), t9 (18:00 loss -200), t12 (19:00 win +90)
#                     3 trades, 1 win,    win rate 1/3,  total -260, avg  -86.667
#   sydney    21-23 : t5 (22:30 loss -100)
#                     1 trade,  0 wins,   win rate 0.0,  total -100, avg -100.0
#   tokyo 06-07, tokyo_london 07-08, asia_pacific_late 23-00 : none
#
# 2 + 3 + 3 + 3 + 1 = 12 trades; 125 + 10 + 305 - 260 - 100 = +80 total, which
# matches the final cumulative equity in the drawdown table above.

EXPECTED_SESSIONS = {
    "asia_pacific": {"trade_count": 2, "win_count": 2, "win_rate": 1.0, "total_pnl": 125.0, "avg_pnl": 62.5},
    "london": {"trade_count": 3, "win_count": 1, "win_rate": 1 / 3, "total_pnl": 10.0, "avg_pnl": 10 / 3},
    "overlap": {"trade_count": 3, "win_count": 3, "win_rate": 1.0, "total_pnl": 305.0, "avg_pnl": 305 / 3},
    "new_york": {"trade_count": 3, "win_count": 1, "win_rate": 1 / 3, "total_pnl": -260.0, "avg_pnl": -260 / 3},
    "sydney": {"trade_count": 1, "win_count": 0, "win_rate": 0.0, "total_pnl": -100.0, "avg_pnl": -100.0},
    # Empty buckets still appear so the UI can render a fixed, gap-free table.
    "tokyo": {"trade_count": 0, "win_count": 0, "win_rate": 0.0, "total_pnl": 0.0, "avg_pnl": 0.0},
    "tokyo_london": {"trade_count": 0, "win_count": 0, "win_rate": 0.0, "total_pnl": 0.0, "avg_pnl": 0.0},
    "asia_pacific_late": {"trade_count": 0, "win_count": 0, "win_rate": 0.0, "total_pnl": 0.0, "avg_pnl": 0.0},
}


def test_session_breakdown_matches_hand_calculation(seeded):
    data = _sessions(seeded)
    assert data["trade_count"] == 12

    by_key = {s["key"]: s for s in data["sessions"]}
    assert set(by_key) == set(EXPECTED_SESSIONS)

    for key, expected in EXPECTED_SESSIONS.items():
        actual = by_key[key]
        for field, value in expected.items():
            assert actual[field] == pytest.approx(value), f"{key}.{field}"


def test_session_totals_reconcile_with_the_equity_curve(seeded):
    sessions = _sessions(seeded)["sessions"]
    assert sum(s["trade_count"] for s in sessions) == 12
    assert sum(s["total_pnl"] for s in sessions) == pytest.approx(80.0)
    assert _risk(seeded)["drawdown_curve"][-1]["cumulative_pnl"] == pytest.approx(80.0)


def test_sessions_are_returned_in_clock_order_including_empty_ones(seeded):
    # A stable, gap-free ordering is what lets the UI render a fixed table.
    sessions = _sessions(seeded)["sessions"]
    assert [s["key"] for s in sessions] == [
        "asia_pacific", "tokyo", "tokyo_london", "london",
        "overlap", "new_york", "sydney", "asia_pacific_late",
    ]
    assert [(s["start_hour"], s["end_hour"]) for s in sessions] == [
        (0, 6), (6, 7), (7, 8), (8, 12), (12, 16), (16, 21), (21, 23), (23, 24),
    ]


# --- filters and edge cases ----------------------------------------------


def test_date_filter_narrows_both_endpoints_consistently(seeded):
    client, account_id = seeded
    # 2026-03-06 only: t10 (+60 win), t11 (+30 win), t12 (+90 win).
    params = {"account_id": account_id, "start": "2026-03-06", "end": "2026-03-07"}

    risk = client.get("/stats/risk", params=params).json()
    assert risk["trade_count"] == 3
    assert risk["trades_missing_risk"] == 0
    assert risk["longest_win_streak"] == 3
    # No losing trade in range, so equity never dips below its running peak.
    assert risk["max_drawdown"] == pytest.approx(0.0)
    assert risk["max_drawdown_start"] is None
    assert risk["max_drawdown_end"] is None
    # R values 1.5, 1.0, 3.0 -> avg 5.5/3
    assert risk["avg_r"] == pytest.approx(5.5 / 3)

    sessions = client.get("/stats/sessions", params=params).json()
    assert sessions["trade_count"] == 3
    by_key = {s["key"]: s["trade_count"] for s in sessions["sessions"]}
    assert by_key == {
        "asia_pacific": 0, "tokyo": 0, "tokyo_london": 0, "london": 1,
        "overlap": 1, "new_york": 1, "sydney": 0, "asia_pacific_late": 0,
    }


def test_empty_range_returns_zeros_rather_than_erroring(seeded):
    client, account_id = seeded
    params = {"account_id": account_id, "start": "2030-01-01", "end": "2030-02-01"}

    risk = client.get("/stats/risk", params=params).json()
    assert risk["trade_count"] == 0
    assert risk["max_drawdown"] == 0.0
    assert risk["avg_r"] is None
    assert risk["best_r"] is None
    assert risk["current_streak"] == {"type": "none", "count": 0}
    assert all(b["count"] == 0 for b in risk["r_multiple_distribution"])

    sessions = client.get("/stats/sessions", params=params).json()
    assert sessions["trade_count"] == 0
    assert len(sessions["sessions"]) == 8
    assert all(s["win_rate"] == 0.0 and s["avg_pnl"] == 0.0 for s in sessions["sessions"])


def test_both_endpoints_require_authentication():
    with TestClient(app) as anon:
        assert anon.get("/stats/risk").status_code == 401
        assert anon.get("/stats/sessions").status_code == 401


# --- R resolution rules (unit level, no DB) -------------------------------


def _trade(pnl: float, risk_amount=None, r_multiple=None) -> Trade:
    return Trade(
        pnl=pnl,
        risk_amount=risk_amount,
        r_multiple=r_multiple,
        entry_time=datetime(2026, 3, 2, 12, 0, tzinfo=timezone.utc),
        status=TradeStatus.win,
    )


def test_r_is_derived_from_pnl_over_risk():
    assert risk_service.r_multiple(_trade(pnl=150.0, risk_amount=50.0)) == pytest.approx(3.0)


def test_stored_r_multiple_overrides_the_derived_value():
    # The override exists for trades where R is known but the dollar risk isn't;
    # when both are present the explicit value wins.
    assert risk_service.r_multiple(_trade(pnl=150.0, risk_amount=50.0, r_multiple=1.25)) == pytest.approx(1.25)


def test_missing_risk_yields_no_r():
    assert risk_service.r_multiple(_trade(pnl=150.0)) is None


@pytest.mark.parametrize("bad_risk", [0.0, -50.0])
def test_non_positive_risk_is_treated_as_missing_not_divided_by(bad_risk):
    assert risk_service.r_multiple(_trade(pnl=150.0, risk_amount=bad_risk)) is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (-9.0, "< -3R"),
        (-3.0, "-3R to -2R"),  # boundaries belong to the bucket they open
        (-2.01, "-3R to -2R"),
        (-1.0, "-1R to 0R"),
        (-0.01, "-1R to 0R"),
        (0.0, "0R to 1R"),
        (0.999, "0R to 1R"),
        (1.0, "1R to 2R"),
        (2.999, "2R to 3R"),
        (3.0, "3R+"),
        (12.5, "3R+"),
    ],
)
def test_bucket_boundaries_are_half_open(value, expected):
    assert risk_service.bucket_for_r(value) == expected


@pytest.mark.parametrize(
    ("hour", "expected"),
    [(0, "asia_pacific"), (5, "asia_pacific"), (6, "tokyo"), (7, "tokyo_london"),
     (8, "london"), (11, "london"), (12, "overlap"), (15, "overlap"),
     (16, "new_york"), (20, "new_york"), (21, "sydney"), (22, "sydney"),
     (23, "asia_pacific_late")],
)
def test_session_boundaries(hour, expected):
    assert risk_service.session_for_hour(hour) == expected


def test_non_utc_entry_times_bucket_by_their_utc_hour():
    # 23:30 in UTC+9 is 14:30 UTC - the overlap, not off-hours. Getting this
    # wrong would silently mis-attribute every trade logged in a local timezone.
    tokyo = timezone(timedelta(hours=9))
    assert risk_service.utc_hour(datetime(2026, 3, 2, 23, 30, tzinfo=tokyo)) == 14
    assert risk_service.session_for_hour(14) == "overlap"


def test_breakeven_breaks_a_streak_rather_than_being_skipped():
    def t(status: TradeStatus) -> Trade:
        trade = _trade(pnl=0.0)
        trade.status = status
        return trade

    # win, win, breakeven, win: the scratch must not join the run into a 3-streak.
    longest_win, _, current_type, current_count = risk_service.streaks(
        [t(TradeStatus.win), t(TradeStatus.win), t(TradeStatus.breakeven), t(TradeStatus.win)]
    )
    assert longest_win == 2
    assert (current_type, current_count) == ("win", 1)
