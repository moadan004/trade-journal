import csv
import io
from datetime import datetime

from pydantic import BaseModel

from app.models.trade import TradeSide, TradeStatus
from app.schemas.trade import ImportSkippedRow

# Canonical field -> accepted header aliases, matched after normalizing (lowercased,
# non-alphanumeric characters stripped) so "Open Time", "open_time", "OPEN-TIME" all match.
# Targets the common broker "trade history" export shape: one row per closed trade, with
# distinctly-named open/close columns (e.g. MT5/Exness web portal exports), as opposed to
# the MT5 terminal's raw per-deal log (which reuses "Time"/"Price" for both legs).
COLUMN_ALIASES: dict[str, list[str]] = {
    "ticket": ["ticket", "order", "position", "id"],
    "open_time": ["opentime", "entrytime", "time1"],
    "symbol": ["symbol", "item", "instrument", "pair"],
    "side": ["type", "side", "direction"],
    "size": ["size", "volume", "lots", "lotsize"],
    "open_price": ["openprice", "entryprice", "price1"],
    "close_time": ["closetime", "exittime", "time2"],
    "close_price": ["closeprice", "exitprice", "price2"],
    "commission": ["commission", "comm"],
    "swap": ["swap"],
    "profit": ["profit", "pnl", "pl"],
    "comment": ["comment", "notes", "note"],
}

REQUIRED_FIELDS = ["open_time", "symbol", "side", "size", "open_price", "close_time", "close_price", "profit"]

DATETIME_FORMATS = [
    "%Y.%m.%d %H:%M:%S",
    "%Y.%m.%d %H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",
]


class CsvImportError(Exception):
    pass


class ParsedImportTrade(BaseModel):
    symbol: str
    side: TradeSide
    entry_time: datetime
    exit_time: datetime
    entry_price: float
    exit_price: float
    size: float
    pnl: float
    fees: float
    status: TradeStatus
    notes: str | None
    tags: list[str] | None


class ParsedImport(BaseModel):
    trades: list[ParsedImportTrade]
    skipped: list[ImportSkippedRow]
    total_rows: int


def _normalize(text: str) -> str:
    return "".join(ch for ch in text.strip().lower() if ch.isalnum())


def _parse_side(raw: str) -> TradeSide | None:
    value = raw.strip().lower()
    if value in ("buy", "long", "b"):
        return TradeSide.long
    if value in ("sell", "short", "s"):
        return TradeSide.short
    return None


def _parse_datetime(raw: str) -> datetime | None:
    raw = raw.strip()
    for fmt in DATETIME_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_float(raw: str) -> float | None:
    raw = raw.strip().replace(",", "")
    if raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def parse_trade_history_csv(content: str, tag: str | None) -> ParsedImport:
    reader = csv.reader(io.StringIO(content))
    try:
        header_row = next(reader)
    except StopIteration:
        raise CsvImportError("The file is empty.")

    field_by_index: dict[int, str] = {}
    for idx, raw_header in enumerate(header_row):
        normalized = _normalize(raw_header)
        for field, aliases in COLUMN_ALIASES.items():
            if normalized in aliases:
                field_by_index[idx] = field
                break

    found_fields = set(field_by_index.values())
    missing = [f for f in REQUIRED_FIELDS if f not in found_fields]
    if missing:
        raise CsvImportError(
            "Missing required column(s): "
            + ", ".join(missing)
            + ". See the sample CSV for the expected format."
        )

    trades: list[ParsedImportTrade] = []
    skipped: list[ImportSkippedRow] = []
    total_rows = 0
    tags = [tag] if tag else None

    for row_num, row in enumerate(reader, start=2):  # header is row 1
        if not any(cell.strip() for cell in row):
            continue  # skip fully blank lines

        total_rows += 1
        values: dict[str, str] = {}
        for idx, field in field_by_index.items():
            if idx < len(row):
                values[field] = row[idx]

        try:
            symbol = values.get("symbol", "").strip()
            if not symbol:
                raise ValueError("missing symbol")

            side = _parse_side(values.get("side", ""))
            if side is None:
                raise ValueError(f"unrecognized side '{values.get('side', '')}'")

            entry_time = _parse_datetime(values.get("open_time", ""))
            if entry_time is None:
                raise ValueError(f"unparseable open time '{values.get('open_time', '')}'")

            exit_time = _parse_datetime(values.get("close_time", ""))
            if exit_time is None:
                raise ValueError(f"unparseable close time '{values.get('close_time', '')}'")

            entry_price = _parse_float(values.get("open_price", ""))
            if entry_price is None:
                raise ValueError("unparseable open price")

            exit_price = _parse_float(values.get("close_price", ""))
            if exit_price is None:
                raise ValueError("unparseable close price")

            size = _parse_float(values.get("size", ""))
            if size is None:
                raise ValueError("unparseable size")

            profit = _parse_float(values.get("profit", ""))
            if profit is None:
                raise ValueError("unparseable profit")

            commission = _parse_float(values.get("commission", "")) or 0.0
            swap = _parse_float(values.get("swap", "")) or 0.0
            fees = abs(commission) + abs(swap)

            status = (
                TradeStatus.win if profit > 0 else TradeStatus.loss if profit < 0 else TradeStatus.breakeven
            )
            notes = values.get("comment", "").strip() or None

            trades.append(
                ParsedImportTrade(
                    symbol=symbol.upper(),
                    side=side,
                    entry_time=entry_time,
                    exit_time=exit_time,
                    entry_price=entry_price,
                    exit_price=exit_price,
                    size=size,
                    pnl=profit,
                    fees=fees,
                    status=status,
                    notes=notes,
                    tags=tags,
                )
            )
        except ValueError as exc:
            skipped.append(ImportSkippedRow(row=row_num, reason=str(exc)))

    return ParsedImport(trades=trades, skipped=skipped, total_rows=total_rows)
