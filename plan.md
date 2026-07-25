# Trading Journal App — Build Plan

Inspired by TradeZella's calendar dashboard: a monthly P&L calendar with daily win-rate/trade-count cells, rolled up into monthly stats.

## 1. Stack (matches your TVHUB setup)
- **Frontend:** Next.js (App Router) + Tailwind
- **Backend:** FastAPI
- **DB:** PostgreSQL (Render or Supabase)
- **Auth:** JWT (reuse pattern from TVHUB)
- **Deploy:** Vercel (frontend) + Render (backend)
- **Charts:** Recharts (equity curve, win-rate)

## 2. Core Data Model
```
User
  id, email, password_hash, created_at

Account          # for multi-account support (e.g. MT5 live/demo)
  id, user_id, name, broker, currency

Trade
  id, account_id, symbol, side (long/short)
  entry_time, exit_time, entry_price, exit_price
  size, pnl, fees, r_multiple
  tags[] (e.g. "scalp", "XAUUSD", "breakout")
  notes, screenshot_url
  status (win/loss/breakeven)

DailyStat (materialized/derived, not stored — computed on query)
  date, pnl, trade_count, win_rate
```

## 3. MVP Feature Set
1. **Auth** — signup/login, JWT sessions
2. **Trade entry** — manual form (symbol, side, entry/exit, size, price, notes, screenshot upload)
3. **Calendar dashboard** (the screenshot)
   - Month grid, Sun–Sat
   - Each day cell: total P&L, trade count, win rate
   - Green/red/gray coloring by P&L sign
   - Small dot indicator = has journal note
   - Monthly stats bar: total P&L, trading days count
4. **Day detail view** — click a day → list of that day's trades
5. **Trade detail/edit** — click a trade → full record + notes + screenshot

## 4. Phase Plan

**Phase 1 — Backend foundation**
- FastAPI project scaffold, PostgreSQL schema + Alembic migrations
- Auth endpoints (register/login/refresh)
- Trade CRUD endpoints
- Endpoint: `GET /stats/calendar?month=2026-07` → returns per-day aggregates

**Phase 2 — Frontend core**
- Next.js scaffold, Tailwind setup, auth pages
- Calendar grid component (7-col CSS grid, dynamic month rendering)
- Day cell component (color logic: green >0, red <0, gray no trades)
- Monthly stats header (sum P&L, active days count)

**Phase 3 — Trade management**
- Add/Edit trade modal or page
- Day detail drawer (trades for selected day)
- File upload for trade screenshots (S3-compatible or Render disk)

**Phase 4 — Analytics**
- Win rate, avg R, equity curve chart
- Tag-based filtering (e.g. filter by "XAUUSD scalp")
- Weekly/monthly summary cards

**Phase 5 — Polish**
- CSV import (from MT5/Exness trade history export) — high value for your forex trading
- Mobile-responsive calendar (swipe months)
- Dark mode

## 5. Suggested Build Order (for Claude Code sessions)
1. `db/schema.sql` + migrations
2. FastAPI auth + trade CRUD, test with curl/Postman
3. `GET /stats/calendar` aggregation query (SQL `GROUP BY date`)
4. Next.js calendar component wired to that endpoint (start with mock data)
5. Connect real API, then add trade entry form
6. Add MT5 CSV import last — biggest time-saver for you personally

## 6. Notes
- Calendar cell color/win-rate logic can be computed entirely in SQL:
  `SUM(pnl) as day_pnl, COUNT(*) as trades, SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END)::float / COUNT(*) as win_rate`
- Since you already scalp XAUUSD on MT5/Exness, an MT5 history CSV importer would make this genuinely useful day-to-day rather than just a demo project.
