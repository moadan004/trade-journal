"""Trade export in CSV and PDF.

reportlab rather than WeasyPrint for the PDF: it's pure Python, so the Render
build needs no cairo/pango system packages.
"""

import csv
import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.trade import Trade

CSV_COLUMNS = [
    "date",
    "symbol",
    "side",
    "entry_time",
    "exit_time",
    "entry_price",
    "exit_price",
    "size",
    "pnl",
    "fees",
    "risk_amount",
    "r_multiple",
    "status",
    "tags",
    "notes",
]

# The PDF is a summary artifact, not a data interchange format - it carries the
# columns you'd actually scan down a printed page. The CSV above is the complete
# record.
PDF_COLUMNS = ["Date", "Symbol", "Side", "P&L", "Tags"]


def _fmt_dt(value: datetime | None) -> str:
    return value.strftime("%Y-%m-%d %H:%M") if value else ""


def _derived_r(trade: Trade) -> str:
    """R for the export, matching app/services/risk.py's precedence rule."""
    if trade.r_multiple is not None:
        return f"{float(trade.r_multiple):.2f}"
    if trade.risk_amount is not None and float(trade.risk_amount) > 0:
        return f"{float(trade.pnl) / float(trade.risk_amount):.2f}"
    return ""


def trades_to_csv(trades: list[Trade]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)

    for trade in trades:
        writer.writerow(
            [
                trade.entry_time.strftime("%Y-%m-%d"),
                trade.symbol,
                trade.side.value,
                _fmt_dt(trade.entry_time),
                _fmt_dt(trade.exit_time),
                f"{float(trade.entry_price):g}",
                f"{float(trade.exit_price):g}" if trade.exit_price is not None else "",
                f"{float(trade.size):g}",
                f"{float(trade.pnl):.2f}",
                f"{float(trade.fees):.2f}",
                f"{float(trade.risk_amount):.2f}" if trade.risk_amount is not None else "",
                _derived_r(trade),
                trade.status.value,
                ", ".join(trade.tags) if trade.tags else "",
                trade.notes or "",
            ]
        )

    # utf-8-sig so Excel reads non-ASCII correctly instead of mojibake - the same
    # encoding the CSV importer accepts on the way in.
    return buffer.getvalue().encode("utf-8-sig")


def trades_to_pdf(trades: list[Trade], title: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    cell = styles["BodyText"]
    cell.fontSize = 8
    cell.leading = 10

    story = [Paragraph(title, styles["Heading2"]), Spacer(1, 6)]

    total_pnl = sum(float(t.pnl) for t in trades)
    wins = sum(1 for t in trades if float(t.pnl) > 0)
    summary = (
        f"{len(trades)} trades &nbsp;·&nbsp; "
        f"Total P&amp;L {total_pnl:+,.2f} &nbsp;·&nbsp; "
        f"Win rate {(wins / len(trades) * 100) if trades else 0:.0f}%"
    )
    story += [Paragraph(summary, styles["Normal"]), Spacer(1, 10)]

    if not trades:
        story.append(Paragraph("No trades in this range.", styles["Normal"]))
    else:
        rows = [PDF_COLUMNS]
        for trade in trades:
            rows.append(
                [
                    trade.entry_time.strftime("%Y-%m-%d"),
                    trade.symbol,
                    trade.side.value,
                    f"{float(trade.pnl):+,.2f}",
                    # Paragraph rather than a bare string so a long tag list
                    # wraps inside its column instead of overflowing the table.
                    Paragraph(", ".join(trade.tags) if trade.tags else "", cell),
                ]
            )

        table = Table(rows, colWidths=[28 * mm, 30 * mm, 20 * mm, 28 * mm, 100 * mm], repeatRows=1)
        style = [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#18181b")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (3, 0), (3, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d4d4d8")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        # Colour P&L per row so a losing week is visible at a glance.
        for i, trade in enumerate(trades, start=1):
            pnl = float(trade.pnl)
            if pnl > 0:
                style.append(("TEXTCOLOR", (3, i), (3, i), colors.HexColor("#047857")))
            elif pnl < 0:
                style.append(("TEXTCOLOR", (3, i), (3, i), colors.HexColor("#b91c1c")))
        table.setStyle(TableStyle(style))
        story.append(table)

    doc.build(story)
    return buffer.getvalue()
