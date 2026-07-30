"""
Tests for Phase 8: screenshot upload, CSV/PDF export, multi-account summary.

The export tests assert on the *content* of the produced file, not just that
bytes came back with the right media type - a CSV with the wrong numbers in it
still downloads perfectly happily.

Run: pytest tests/test_phase8.py -v
"""

import base64
import csv
import io
import re
import uuid
import zlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.main import app
from app.models.trade import Trade
from app.services.uploads import SUBDIR, storage_root

settings = get_settings()

# Smallest valid files of each type, as literal bytes - so the tests exercise
# the real magic-byte sniffing rather than a mocked-out validator.
PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00"
    b"\x00\x00IEND\xaeB`\x82"
)
GIF_1PX = b"GIF89a\x01\x00\x01\x00\x00\xff\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00;"
JPEG_HEAD = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"\x00" * 40
WEBP_HEAD = b"RIFF\x24\x00\x00\x00WEBP" + b"\x00" * 40
SVG_BOMB = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _register(client: TestClient) -> None:
    email = f"p8-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post("/auth/register", json={"email": email, "password": "supersecret123"})
    assert resp.status_code == 201, resp.text


def _account(client: TestClient, name: str = "Main") -> int:
    resp = client.post("/accounts", json={"name": name, "broker": "Exness", "currency": "USD"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _stored_pointer(trade_id: int) -> str | None:
    """The raw storage pointer in the column, not the URL the API exposes.

    Since screenshots are served through an ownership-checked route, the
    exposed `screenshot_url` is `/trades/{id}/screenshot` and no longer reveals
    the filename - so tests that need the file on disk read the column.
    """
    with SessionLocal() as db:
        return db.get(Trade, trade_id).screenshot_url


def _disk_path(trade_id: int):
    pointer = _stored_pointer(trade_id)
    assert pointer, f"trade {trade_id} has no stored screenshot pointer"
    return storage_root(settings.upload_dir) / SUBDIR / pointer.rsplit("/", 1)[-1]


def _trade(client: TestClient, account_id: int, **overrides) -> dict:
    entry = overrides.pop("entry", datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc))
    payload = {
        "account_id": account_id,
        "symbol": "XAUUSD",
        "side": "long",
        "entry_time": entry.isoformat(),
        "exit_time": (entry + timedelta(hours=1)).isoformat(),
        "entry_price": 2000.0,
        "exit_price": 2010.0,
        "size": 1.0,
        "pnl": 100.0,
        "fees": 0.0,
        "status": "win",
    }
    payload.update(overrides)
    resp = client.post("/trades", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# --- screenshot upload ----------------------------------------------------


def test_upload_png_persists_url_and_file(client):
    _register(client)
    trade = _trade(client, _account(client))

    resp = client.post(
        f"/trades/{trade['id']}/screenshot",
        files={"file": ("chart.png", PNG_1PX, "image/png")},
    )
    assert resp.status_code == 200, resp.text
    url = resp.json()["screenshot_url"]
    # The exposed URL is the ownership-checked route, not a static file path.
    assert url == f"/trades/{trade['id']}/screenshot"

    # The stored pointer is still the internal storage path (no migration).
    assert _stored_pointer(trade["id"]).startswith(f"/{SUBDIR}/") is False
    assert _stored_pointer(trade["id"]).startswith(f"/uploads/{SUBDIR}/")
    assert _disk_path(trade["id"]).exists()

    served = client.get(url)
    assert served.status_code == 200
    assert served.content == PNG_1PX
    assert served.headers["content-type"] == "image/png"
    # Private data must not land in a shared cache.
    assert "private" in served.headers.get("cache-control", "")

    # And it survives a fresh read of the trade, not just the upload response.
    assert client.get(f"/trades/{trade['id']}").json()["screenshot_url"] == url


@pytest.mark.parametrize(
    ("name", "content"),
    [("a.png", PNG_1PX), ("a.gif", GIF_1PX), ("a.jpg", JPEG_HEAD), ("a.webp", WEBP_HEAD)],
)
def test_supported_raster_formats_are_accepted(client, name, content):
    _register(client)
    trade = _trade(client, _account(client))
    resp = client.post(f"/trades/{trade['id']}/screenshot", files={"file": (name, content, "image/*")})
    assert resp.status_code == 200, resp.text


def test_svg_is_rejected_even_when_labelled_as_an_image(client):
    """SVG can carry <script> and is served same-origin - it must not get in."""
    _register(client)
    trade = _trade(client, _account(client))
    resp = client.post(
        f"/trades/{trade['id']}/screenshot",
        files={"file": ("x.svg", SVG_BOMB, "image/svg+xml")},
    )
    assert resp.status_code == 400, resp.text


def test_content_type_header_alone_does_not_get_a_file_in(client):
    """The declared type is a hint; the bytes decide."""
    _register(client)
    trade = _trade(client, _account(client))
    resp = client.post(
        f"/trades/{trade['id']}/screenshot",
        files={"file": ("evil.png", b"#!/bin/sh\nrm -rf /\n", "image/png")},
    )
    assert resp.status_code == 400, resp.text
    assert client.get(f"/trades/{trade['id']}").json()["screenshot_url"] is None


@pytest.mark.parametrize(
    "hostile_name",
    [
        "../../../../tmp/pwned.png",
        "..\\..\\..\\windows\\evil.png",
        "/etc/cron.d/pwned.png",
        "....//....//escape.png",
    ],
)
def test_client_filename_cannot_steer_where_the_file_lands(client, hostile_name):
    """Stored names are generated, never taken from the upload.

    A client-supplied filename is attacker-controlled and is the usual route by
    which "../.." escapes the upload directory.
    """
    _register(client)
    trade = _trade(client, _account(client))

    resp = client.post(
        f"/trades/{trade['id']}/screenshot",
        files={"file": (hostile_name, PNG_1PX, "image/png")},
    )
    assert resp.status_code == 200, resp.text

    pointer = _stored_pointer(trade["id"])
    stored = pointer.rsplit("/", 1)[-1]
    assert ".." not in pointer and ".." not in stored
    assert pointer.startswith(f"/uploads/{SUBDIR}/")
    # uuid4().hex + a whitelisted extension, nothing carried over from the input.
    assert re.fullmatch(r"[0-9a-f]{32}\.png", stored), stored

    root = storage_root(settings.upload_dir).resolve()
    written = (root / SUBDIR / stored).resolve()
    assert written.is_relative_to(root), "file escaped the upload directory"
    assert written.exists()


def test_oversized_upload_is_rejected(client):
    _register(client)
    trade = _trade(client, _account(client))
    huge = PNG_1PX + b"\x00" * (settings.max_upload_bytes + 1)
    resp = client.post(f"/trades/{trade['id']}/screenshot", files={"file": ("big.png", huge, "image/png")})
    assert resp.status_code == 413, resp.text


def test_empty_upload_is_rejected(client):
    _register(client)
    trade = _trade(client, _account(client))
    resp = client.post(f"/trades/{trade['id']}/screenshot", files={"file": ("empty.png", b"", "image/png")})
    assert resp.status_code == 400, resp.text


def test_replacing_a_screenshot_removes_the_old_file(client):
    _register(client)
    trade = _trade(client, _account(client))

    client.post(f"/trades/{trade['id']}/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")})
    first_pointer = _stored_pointer(trade["id"])
    first_path = _disk_path(trade["id"])
    assert first_path.exists()

    client.post(f"/trades/{trade['id']}/screenshot", files={"file": ("b.gif", GIF_1PX, "image/gif")})
    assert _stored_pointer(trade["id"]) != first_pointer
    assert not first_path.exists(), "old screenshot left orphaned on disk"
    assert _disk_path(trade["id"]).exists()
    # The exposed URL is stable across replacement - it addresses the trade.
    assert client.get(f"/trades/{trade['id']}").json()["screenshot_url"] == f"/trades/{trade['id']}/screenshot"


def test_deleting_screenshot_clears_url_and_file(client):
    _register(client)
    trade = _trade(client, _account(client))
    client.post(f"/trades/{trade['id']}/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")})
    path = _disk_path(trade["id"])

    resp = client.delete(f"/trades/{trade['id']}/screenshot")
    assert resp.status_code == 200, resp.text
    assert resp.json()["screenshot_url"] is None
    assert not path.exists()


def test_deleting_a_trade_removes_its_screenshot_file(client):
    _register(client)
    trade = _trade(client, _account(client))
    client.post(f"/trades/{trade['id']}/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")})
    path = _disk_path(trade["id"])

    assert client.delete(f"/trades/{trade['id']}").status_code == 204
    assert not path.exists()


def test_cannot_upload_to_someone_elses_trade(client):
    _register(client)
    trade = _trade(client, _account(client))

    other = TestClient(app)
    _register(other)
    resp = other.post(f"/trades/{trade['id']}/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")})
    assert resp.status_code == 404, resp.text


def test_screenshot_is_not_served_without_authentication(client):
    """Regression: a StaticFiles mount served these to anyone with the URL."""
    _register(client)
    trade = _trade(client, _account(client))
    url = client.post(
        f"/trades/{trade['id']}/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")}
    ).json()["screenshot_url"]

    anon = TestClient(app)  # no cookie jar entries at all
    resp = anon.get(url)
    assert resp.status_code == 401, resp.text
    assert PNG_1PX not in resp.content


def test_screenshot_is_not_served_to_another_user(client):
    _register(client)
    trade = _trade(client, _account(client))
    url = client.post(
        f"/trades/{trade['id']}/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")}
    ).json()["screenshot_url"]

    other = TestClient(app)
    _register(other)
    resp = other.get(url)
    # 404 rather than 403: the same answer a nonexistent trade gives, so this
    # doesn't confirm to a stranger that the trade id exists.
    assert resp.status_code == 404, resp.text
    assert PNG_1PX not in resp.content


def test_old_static_upload_path_is_no_longer_routed(client):
    """The mount is gone, so the previously-public path must not resolve."""
    _register(client)
    trade = _trade(client, _account(client))
    client.post(f"/trades/{trade['id']}/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")})

    pointer = _stored_pointer(trade["id"])  # e.g. /uploads/screenshots/<uuid>.png
    resp = client.get(pointer)
    assert resp.status_code == 404, f"{pointer} still served: {resp.status_code}"


def test_screenshot_route_404s_when_the_file_is_gone(client):
    """The normal state after a Render deploy wipes the ephemeral disk."""
    _register(client)
    trade = _trade(client, _account(client))
    url = client.post(
        f"/trades/{trade['id']}/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")}
    ).json()["screenshot_url"]

    _disk_path(trade["id"]).unlink()  # row still points at it
    assert client.get(url).status_code == 404


def test_screenshot_route_404s_when_trade_has_none(client):
    _register(client)
    trade = _trade(client, _account(client))
    assert client.get(f"/trades/{trade['id']}/screenshot").status_code == 404


def test_upload_requires_authentication(client):
    assert client.post("/trades/1/screenshot", files={"file": ("a.png", PNG_1PX, "image/png")}).status_code == 401


# --- CSV export -----------------------------------------------------------


def test_csv_export_contains_the_right_rows_and_values(client):
    _register(client)
    account_id = _account(client)
    _trade(client, account_id, symbol="XAUUSD", pnl=100.0, risk_amount=50.0, tags=["scalp", "london"])
    _trade(
        client,
        account_id,
        entry=datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc),
        symbol="EURUSD",
        side="short",
        pnl=-40.0,
        status="loss",
    )

    resp = client.get("/trades/export", params={"format": "csv"})
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.headers["content-disposition"].endswith('.csv"')

    rows = list(csv.DictReader(io.StringIO(resp.content.decode("utf-8-sig"))))
    assert len(rows) == 2

    first = rows[0]
    assert first["date"] == "2026-06-01"
    assert first["symbol"] == "XAUUSD"
    assert first["side"] == "long"
    assert first["pnl"] == "100.00"
    assert first["tags"] == "scalp, london"
    assert first["r_multiple"] == "2.00"  # 100 / 50, derived not stored

    second = rows[1]
    assert second["symbol"] == "EURUSD"
    assert second["side"] == "short"
    assert second["pnl"] == "-40.00"
    assert second["status"] == "loss"
    assert second["r_multiple"] == ""  # no risk_amount -> blank, not 0


def test_csv_export_is_excel_safe_utf8(client):
    _register(client)
    _trade(client, _account(client), notes="Café — naïve résumé")
    resp = client.get("/trades/export", params={"format": "csv"})
    # The BOM is what stops Excel mangling non-ASCII.
    assert resp.content.startswith(b"\xef\xbb\xbf")
    assert "Café — naïve résumé" in resp.content.decode("utf-8-sig")


def test_csv_export_respects_date_and_account_filters(client):
    _register(client)
    a = _account(client, "A")
    b = _account(client, "B")
    _trade(client, a, entry=datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc), symbol="INRANGE")
    _trade(client, a, entry=datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc), symbol="OUTOFRANGE")
    _trade(client, b, entry=datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc), symbol="OTHERACCOUNT")

    resp = client.get(
        "/trades/export",
        params={"format": "csv", "start": "2026-06-01", "end": "2026-06-30", "account_id": a},
    )
    rows = list(csv.DictReader(io.StringIO(resp.content.decode("utf-8-sig"))))
    assert [r["symbol"] for r in rows] == ["INRANGE"]


def test_csv_export_with_no_trades_still_returns_a_header_row(client):
    _register(client)
    resp = client.get("/trades/export", params={"format": "csv"})
    assert resp.status_code == 200
    text = resp.content.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("date,symbol,side")


# --- PDF export -----------------------------------------------------------


def _pdf_text(pdf: bytes) -> str:
    """Crude text extraction from the page content streams.

    reportlab writes them ASCII85-encoded then Flate-compressed, so both layers
    come off before the drawing operators are readable. Enough to assert the
    right values reached the page without pulling in a PDF parser purely for
    tests.
    """
    out = []
    # Note the stream data runs right up to "endstream" with no separator, and
    # carries reportlab's ASCII85 "~>" terminator.
    for raw in re.findall(rb"stream\r?\n(.*?)endstream", pdf, re.S):
        body = raw.strip().rstrip(b"~>")
        if not body:
            continue
        for decode in (
            lambda b: zlib.decompress(base64.a85decode(b, adobe=False)),
            lambda b: zlib.decompress(b),
            lambda b: b,
        ):
            try:
                out.append(decode(body).decode("latin-1"))
                break
            except Exception:
                continue
    text = "\n".join(out)
    # Content streams write glyphs as (…) Tj literals, and reportlab splits a
    # single visual string across several of them (so "P&L" arrives as "P", "&",
    # "L"). Return the literals both newline-joined and concatenated, so a
    # search for a value that got split still finds it.
    shown = re.findall(r"\((.*?)\)\s*Tj", text, re.S)
    return "\n".join(shown) + "\n" + "".join(shown) + "\n" + text


def test_pdf_export_returns_a_real_pdf(client):
    _register(client)
    _trade(client, _account(client))
    resp = client.get("/trades/export", params={"format": "pdf"})
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"].endswith('.pdf"')
    assert resp.content.startswith(b"%PDF-")
    assert resp.content.rstrip().endswith(b"%%EOF")


def test_pdf_export_contains_the_trade_data(client):
    _register(client)
    account_id = _account(client)
    _trade(client, account_id, symbol="XAUUSD", pnl=100.0, tags=["scalp"])
    _trade(
        client,
        account_id,
        entry=datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc),
        symbol="EURUSD",
        pnl=-40.0,
        status="loss",
    )

    text = _pdf_text(client.get("/trades/export", params={"format": "pdf"}).content)
    assert "XAUUSD" in text
    assert "EURUSD" in text
    assert "2026-06-01" in text
    assert "scalp" in text
    # Header line: 2 trades, +60.00 net, 50% win rate.
    assert "2 trades" in text
    assert "60.00" in text
    assert "50%" in text


def test_pdf_export_keeps_tags_containing_markup_characters(client):
    """Regression: Paragraph parses reportlab markup, so `&` and `<` vanished.

    The export still returned HTTP 200 with a valid PDF - the tag text was just
    silently missing, which is worse than a crash because nothing signals it.
    """
    _register(client)
    account_id = _account(client)
    _trade(client, account_id, symbol="XAUUSD", tags=["A&B", "<swing>", "R:R 1<2"])

    resp = client.get("/trades/export", params={"format": "pdf"})
    assert resp.status_code == 200, resp.text
    text = _pdf_text(resp.content)
    for tag in ("A&B", "<swing>", "R:R 1<2"):
        assert tag in text, f"tag {tag!r} missing from the PDF text layer"


def test_csv_export_keeps_tags_containing_markup_characters(client):
    """The CSV path never had the markup problem; pin it so it stays that way."""
    _register(client)
    _trade(client, _account(client), tags=["A&B", "<swing>"])
    body = client.get("/trades/export", params={"format": "csv"}).content.decode("utf-8-sig")
    assert "A&B" in body and "<swing>" in body


def test_pdf_export_handles_an_empty_range(client):
    _register(client)
    resp = client.get("/trades/export", params={"format": "pdf", "start": "2030-01-01", "end": "2030-02-01"})
    assert resp.status_code == 200
    assert resp.content.startswith(b"%PDF-")
    assert "No trades in this range" in _pdf_text(resp.content)


def test_export_rejects_an_unknown_format(client):
    _register(client)
    assert client.get("/trades/export", params={"format": "xlsx"}).status_code == 422


def test_export_does_not_leak_other_users_trades(client):
    _register(client)
    _trade(client, _account(client), symbol="PRIVATE")

    other = TestClient(app)
    _register(other)
    rows = list(csv.DictReader(io.StringIO(
        other.get("/trades/export", params={"format": "csv"}).content.decode("utf-8-sig")
    )))
    assert rows == []


def test_export_requires_authentication(client):
    assert client.get("/trades/export", params={"format": "csv"}).status_code == 401


# --- multi-account summary ------------------------------------------------


def test_by_account_breakdown_matches_hand_calculation(client):
    """A: +100, +50, -30  |  B: -20, +80

    A  -> 3 trades, 2W/1L, win rate 2/3, total +120, PF 150/30 = 5.0
    B  -> 2 trades, 1W/1L, win rate 1/2, total +60,  PF 80/20  = 4.0
    combined -> 5 trades, 3W/2L, win rate 3/5, total +180, PF 230/50 = 4.6
    """
    _register(client)
    a = _account(client, "Alpha")
    b = _account(client, "Beta")
    for pnl in (100.0, 50.0):
        _trade(client, a, pnl=pnl, status="win")
    _trade(client, a, pnl=-30.0, status="loss")
    _trade(client, b, pnl=-20.0, status="loss")
    _trade(client, b, pnl=80.0, status="win")

    resp = client.get("/stats/summary", params=[("account_ids", a), ("account_ids", b)])
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["trade_count"] == 5
    assert data["total_pnl"] == pytest.approx(180.0)
    assert data["win_rate"] == pytest.approx(3 / 5)
    assert data["profit_factor"] == pytest.approx(230 / 50)

    cards = {c["account_name"]: c for c in data["by_account"]}
    assert set(cards) == {"Alpha", "Beta"}

    assert cards["Alpha"]["trade_count"] == 3
    assert cards["Alpha"]["total_pnl"] == pytest.approx(120.0)
    assert cards["Alpha"]["win_rate"] == pytest.approx(2 / 3)
    assert cards["Alpha"]["profit_factor"] == pytest.approx(5.0)

    assert cards["Beta"]["trade_count"] == 2
    assert cards["Beta"]["total_pnl"] == pytest.approx(60.0)
    assert cards["Beta"]["win_rate"] == pytest.approx(0.5)
    assert cards["Beta"]["profit_factor"] == pytest.approx(4.0)


def test_breakdown_reconciles_with_the_combined_total(client):
    _register(client)
    a, b = _account(client, "A"), _account(client, "B")
    _trade(client, a, pnl=100.0)
    _trade(client, b, pnl=-40.0, status="loss")

    data = client.get("/stats/summary", params=[("account_ids", a), ("account_ids", b)]).json()
    assert sum(c["trade_count"] for c in data["by_account"]) == data["trade_count"]
    assert sum(c["total_pnl"] for c in data["by_account"]) == pytest.approx(data["total_pnl"])
    assert sum(c["win_count"] for c in data["by_account"]) == data["win_count"]


def test_by_account_is_empty_when_account_ids_not_supplied(client):
    """Existing single-account callers must see no shape change."""
    _register(client)
    _trade(client, _account(client))
    assert client.get("/stats/summary").json()["by_account"] == []


def test_account_ids_restricts_the_combined_total_too(client):
    _register(client)
    a, b = _account(client, "A"), _account(client, "B")
    _trade(client, a, pnl=100.0)
    _trade(client, b, pnl=999.0)

    data = client.get("/stats/summary", params=[("account_ids", a)]).json()
    assert data["trade_count"] == 1
    assert data["total_pnl"] == pytest.approx(100.0)
    assert len(data["by_account"]) == 1


def test_another_users_account_id_yields_nothing_rather_than_leaking(client):
    _register(client)
    mine = _account(client, "Mine")
    _trade(client, mine, pnl=10.0)

    other = TestClient(app)
    _register(other)
    theirs = _account(other, "Theirs")
    _trade(other, theirs, pnl=5000.0)

    data = client.get("/stats/summary", params=[("account_ids", mine), ("account_ids", theirs)]).json()
    assert [c["account_id"] for c in data["by_account"]] == [mine]
    assert data["total_pnl"] == pytest.approx(10.0)


def test_account_with_no_trades_in_range_still_gets_a_zeroed_card(client):
    """Dropping it would silently hide an account from the comparison view."""
    _register(client)
    a, b = _account(client, "Active"), _account(client, "Dormant")
    _trade(client, a, pnl=100.0)

    data = client.get("/stats/summary", params=[("account_ids", a), ("account_ids", b)]).json()
    cards = {c["account_name"]: c for c in data["by_account"]}
    assert cards["Dormant"]["trade_count"] == 0
    assert cards["Dormant"]["total_pnl"] == 0.0
    assert cards["Dormant"]["win_rate"] == 0.0
    assert cards["Dormant"]["profit_factor"] is None
