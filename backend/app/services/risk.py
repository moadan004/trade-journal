"""Risk and session analytics.

Pure functions over lists of Trade rows. They live here rather than in the
router so the arithmetic can be tested directly against hand-calculated
fixtures without going through HTTP, and so the router stays a thin filter +
serialize layer.

Everything operates on trades already ordered by close time; ordering is the
caller's job because drawdown and streaks are both order-dependent and the
router shares that ordering with /stats/summary's equity curve.
"""

from datetime import datetime, timezone

from app.models.trade import Trade, TradeStatus

# Half-open [lower, upper) buckets, low to high. None means unbounded on that
# side, so every finite R lands in exactly one bucket. A trade at exactly -1R
# falls in "-1R to 0R"; a scratch at exactly 0R falls in "0R to 1R".
R_BUCKETS: list[tuple[str, float | None, float | None]] = [
    ("< -3R", None, -3.0),
    ("-3R to -2R", -3.0, -2.0),
    ("-2R to -1R", -2.0, -1.0),
    ("-1R to 0R", -1.0, 0.0),
    ("0R to 1R", 0.0, 1.0),
    ("1R to 2R", 1.0, 2.0),
    ("2R to 3R", 2.0, 3.0),
    ("3R+", 3.0, None),
]

# UTC hour ranges, half-open [start, end). Chosen to match how XAUUSD actually
# trades rather than exchange hours: the 13-16 overlap is broken out because it
# behaves differently from either London or NY alone.
# The exact partition induced by the four published session windows in
# frontend/src/lib/sessions.ts - Sydney 21-06, Tokyo 23-08, London 07-16,
# New York 12-21 UTC. See that file's header for why those particular hours were
# chosen over exact market-standard ones; the buckets here only have to agree
# with them, not re-litigate them.
#
# Every boundary the widget draws is a boundary here, which is what keeps the two
# from disagreeing about which session a trade belongs to. Midnight is the one
# extra cut: a bucket cannot wrap a day, so the Sydney+Tokyo stretch either side
# of 00:00 has to be filed as two entries rather than one.
SESSIONS: list[tuple[str, str, int, int]] = [
    ("asia_pacific", "Asia-Pacific (Sydney+Tokyo)", 0, 6),
    ("tokyo", "Tokyo", 6, 7),
    ("tokyo_london", "Tokyo/London overlap", 7, 8),
    ("london", "London", 8, 12),
    ("overlap", "London/NY overlap", 12, 16),
    ("new_york", "New York", 16, 21),
    ("sydney", "Sydney", 21, 23),
    ("asia_pacific_late", "Asia-Pacific (pre-midnight)", 23, 24),
]


def trade_sort_key(trade: Trade) -> datetime:
    """Close time, falling back to entry time for trades still open."""
    return trade.exit_time or trade.entry_time


def r_multiple(trade: Trade) -> float | None:
    """R for one trade, or None if it can't be determined.

    Precedence: an explicitly stored r_multiple wins, otherwise R is derived as
    pnl / risk_amount. Deriving is the normal path - r_multiple is only set when
    R is known but the dollar risk isn't (e.g. a trade logged from a screenshot).

    A non-positive risk_amount is treated as missing rather than as a division:
    zero would raise, and negative risk isn't a thing.
    """
    if trade.r_multiple is not None:
        return float(trade.r_multiple)
    if trade.risk_amount is None:
        return None
    risk = float(trade.risk_amount)
    if risk <= 0:
        return None
    return float(trade.pnl) / risk


def bucket_for_r(value: float) -> str:
    for label, lower, upper in R_BUCKETS:
        if (lower is None or value >= lower) and (upper is None or value < upper):
            return label
    # Unreachable: the first and last buckets are unbounded.
    raise ValueError(f"no bucket for R={value}")


def r_distribution(trades: list[Trade]) -> tuple[list[tuple[str, int]], list[float]]:
    """Histogram counts in R_BUCKETS order, plus the raw R values that fed it.

    Returns all buckets including empty ones so the chart keeps a stable x-axis
    as the date filter changes.
    """
    counts = {label: 0 for label, _, _ in R_BUCKETS}
    values: list[float] = []
    for trade in trades:
        value = r_multiple(trade)
        if value is None:
            continue
        values.append(value)
        counts[bucket_for_r(value)] += 1
    return [(label, counts[label]) for label, _, _ in R_BUCKETS], values


def drawdown_series(trades: list[Trade]) -> list[dict]:
    """Running equity, running peak, and drawdown after each trade.

    Equity starts at 0 - this is cumulative P&L, not account balance, because
    the app never records a starting balance or deposits. That makes the peak
    start at 0 too, so a losing first trade is immediately in drawdown.
    """
    cumulative = 0.0
    peak = 0.0
    points: list[dict] = []
    for trade in trades:
        cumulative += float(trade.pnl)
        peak = max(peak, cumulative)
        points.append(
            {
                "date": trade_sort_key(trade),
                "cumulative_pnl": cumulative,
                "peak": peak,
                "drawdown": cumulative - peak,
            }
        )
    return points


def max_drawdown(trades: list[Trade]) -> tuple[float, datetime | None, datetime | None]:
    """Largest peak-to-trough decline, as a positive magnitude.

    Returns (magnitude, peak_date, trough_date). peak_date is None when the peak
    in question is the 0 starting baseline rather than an actual trade.
    """
    cumulative = 0.0
    peak = 0.0
    peak_date: datetime | None = None
    worst = 0.0
    worst_peak_date: datetime | None = None
    worst_trough_date: datetime | None = None

    for trade in trades:
        cumulative += float(trade.pnl)
        if cumulative > peak:
            peak = cumulative
            peak_date = trade_sort_key(trade)
        drawdown = cumulative - peak
        if drawdown < worst:
            worst = drawdown
            worst_peak_date = peak_date
            worst_trough_date = trade_sort_key(trade)

    return abs(worst), worst_peak_date, worst_trough_date


def streaks(trades: list[Trade]) -> tuple[int, int, str, int]:
    """(longest_win, longest_loss, current_type, current_count).

    Breakevens break a streak without starting one: they end the run they
    interrupt and leave the current streak at zero. Treating them as neutral
    (i.e. skipping them) would silently join two wins around a scratch into a
    2-streak, which isn't what "3 wins in a row" means to a trader.
    """
    longest_win = longest_loss = 0
    current_type = "none"
    current_count = 0

    for trade in trades:
        if trade.status == TradeStatus.win:
            current_type, current_count = ("win", current_count + 1 if current_type == "win" else 1)
            longest_win = max(longest_win, current_count)
        elif trade.status == TradeStatus.loss:
            current_type, current_count = ("loss", current_count + 1 if current_type == "loss" else 1)
            longest_loss = max(longest_loss, current_count)
        else:
            current_type, current_count = "none", 0

    return longest_win, longest_loss, current_type, current_count


def session_for_hour(hour: int) -> str:
    for key, _, start, end in SESSIONS:
        if start <= hour < end:
            return key
    raise ValueError(f"hour out of range: {hour}")


def utc_hour(value: datetime) -> int:
    """Hour of day in UTC.

    Postgres returns timestamptz as aware datetimes, but a naive value can reach
    here from a directly-constructed model in tests; treat those as UTC rather
    than letting astimezone() reinterpret them in the server's local zone.
    """
    if value.tzinfo is None:
        return value.hour
    return value.astimezone(timezone.utc).hour


def session_breakdown(trades: list[Trade]) -> list[dict]:
    """Per-session counts and averages, bucketed by entry_time.

    Bucketed on entry rather than exit: the session is a property of when you
    took the setup. All sessions are returned, including empty ones, so the UI
    can show "no trades in Asian" instead of silently omitting the row.
    """
    buckets: dict[str, list[Trade]] = {key: [] for key, _, _, _ in SESSIONS}
    for trade in trades:
        buckets[session_for_hour(utc_hour(trade.entry_time))].append(trade)

    rows: list[dict] = []
    for key, label, start, end in SESSIONS:
        group = buckets[key]
        count = len(group)
        wins = sum(1 for t in group if t.status == TradeStatus.win)
        losses = sum(1 for t in group if t.status == TradeStatus.loss)
        total_pnl = sum(float(t.pnl) for t in group)
        rows.append(
            {
                "key": key,
                "label": label,
                "start_hour": start,
                "end_hour": end,
                "trade_count": count,
                "win_count": wins,
                "loss_count": losses,
                "win_rate": (wins / count) if count else 0.0,
                "avg_pnl": (total_pnl / count) if count else 0.0,
                "total_pnl": total_pnl,
            }
        )
    return rows
