# Trade Journal

A trading journal app with a TradeZella-style calendar dashboard (monthly P&L calendar,
daily win-rate/trade-count cells). See [`plan.md`](./plan.md) for the full build plan.

**Status:** Phase 1 (backend foundation), Phase 2 (frontend core: auth pages + calendar
dashboard), and Phase 3 (trade management: day-detail view, add/edit/delete trades)
complete. Analytics (Phase 4) and CSV import / polish (Phase 5) are next.

## Stack

- **Backend:** FastAPI + SQLAlchemy + Alembic, PostgreSQL, JWT auth (bcrypt via passlib)
- **Frontend:** Next.js (App Router) + Tailwind, client-rendered auth + calendar dashboard

## Repo layout

```
/backend    FastAPI app (routers/, models/, schemas/, core/, alembic/)
/frontend   Next.js app (login/register pages, calendar dashboard)
docker-compose.yml   Local Postgres for development
plan.md              Full product/build plan
```

## Backend setup

### 1. Start Postgres

```bash
docker compose up -d postgres
```

This starts Postgres 16 on `localhost:5432` with user/password/db all set to
`trade_journal` (see `docker-compose.yml`). If you'd rather use an existing local
Postgres install or a hosted instance (e.g. Render), just point `DATABASE_URL` at it instead.

### 2. Configure environment

```bash
cd backend
cp .env.example .env
# edit .env if you're not using the default docker-compose Postgres
```

### 3. Install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Run migrations

```bash
alembic upgrade head
```

### 5. Run the API

```bash
uvicorn app.main:app --reload
```

The API is now live at `http://localhost:8000` (interactive docs at `/docs`).

## API overview

| Method | Path                          | Description                              |
|--------|-------------------------------|-------------------------------------------|
| POST   | `/auth/register`              | Create a user, returns a JWT              |
| POST   | `/auth/login`                 | Log in, returns a JWT                     |
| POST   | `/accounts`                   | Create a trading account (auth required)  |
| GET    | `/accounts`                   | List your accounts                        |
| POST   | `/trades`                     | Create a trade                            |
| GET    | `/trades`                     | List your trades (optional `account_id`, `date=YYYY-MM-DD`) |
| GET    | `/trades/{id}`                | Get a single trade                        |
| PUT    | `/trades/{id}`                | Update a trade                            |
| DELETE | `/trades/{id}`                | Delete a trade                            |
| GET    | `/stats/calendar?month=YYYY-MM` | Per-day P&L/trade-count/win-rate for a month |

All routes except `/auth/*` and `/health` require `Authorization: Bearer <token>`.

## Smoke test

With the API running and migrations applied, verify the full flow (register → login →
create trade → calendar stats):

```bash
cd backend
source .venv/bin/activate
pytest tests/test_smoke.py -v -s
```

This runs in-process against your configured `DATABASE_URL` — no separate server needed.

## Frontend setup

### 1. Configure environment

```bash
cd frontend
cp .env.local.example .env.local
# edit .env.local if your backend isn't on http://localhost:8000
```

### 2. Install and run

```bash
npm install
npm run dev
```

The app is now live at `http://localhost:3000`.

### What's built (Phase 2 + 3)

- `/` — landing page, redirects to `/dashboard` if already logged in
- `/login`, `/register` — call the backend's `/auth/login` and `/auth/register`,
  store the returned JWT, redirect to `/dashboard`
- `/dashboard` — month calendar (Sun–Sat grid) fetching `GET /stats/calendar?month=YYYY-MM`
  on load and on prev/next month navigation; day cells are green/red/gray by P&L sign,
  show P&L/trade count/win rate, and a dot when a day has trades; header shows monthly
  P&L and trading-day count. Loading (skeleton) and empty-month states are handled.
- **Day detail** — clicking a day cell opens a modal listing that day's trades
  (symbol, side, entry/exit time, P&L), fetched via `GET /trades?date=YYYY-MM-DD`.
- **Add trade** — from the dashboard header (`+ Add Trade`) or from the day-detail
  modal. Fields: account, symbol, side, entry/exit time, entry/exit price, size, tags,
  notes. P&L and win/loss/breakeven status are computed client-side from
  side/entry/exit/size (see `lib/pnl.ts`) rather than typed in by hand. If the user has
  no trading account yet, the flow prompts them to create one first (`POST /accounts`),
  then opens the trade form.
- **Edit / delete trade** — from the day-detail modal, `PUT`/`DELETE /trades/{id}`.
  Both refresh the day's trade list and the month's calendar stats afterward.

Analytics (equity curve, tag filtering) and CSV import are Phase 4+ and not implemented yet.

### JWT storage: localStorage vs httpOnly cookie

The frontend stores the JWT in `localStorage` and sends it as an `Authorization: Bearer`
header, matching how the backend's `OAuth2PasswordBearer` dependency already expects it.

- **Why not httpOnly cookies:** they're more resistant to XSS (JS can't read the token),
  but they'd require the backend to set/read cookies (with `SameSite`/`CORS` credential
  wiring) instead of a bearer header, and CSRF protection since cookies are sent
  automatically. That's a backend auth change, not just a frontend one.
- **Tradeoff accepted:** `localStorage` is vulnerable to token theft via XSS (e.g. a
  malicious dependency or injected script can read it), but it's simple, needs zero
  backend changes, and works identically whether the frontend and backend are on the
  same or different origins. Worth revisiting if this app ever handles more sensitive
  data or takes third-party scripts.

## Running frontend + backend together

Three things need to be running at once, each in its own terminal:

```bash
# 1. Postgres
docker compose up -d postgres

# 2. Backend (from /backend, with .venv active)
cd backend && source .venv/bin/activate
alembic upgrade head        # first time / after pulling new migrations
uvicorn app.main:app --reload

# 3. Frontend (from /frontend)
cd frontend
npm run dev
```

Then open `http://localhost:3000`, register an account, and you'll land on the
calendar dashboard. The backend's CORS config already allows `http://localhost:3000`,
and the frontend's `.env.local` already points at `http://localhost:8000`, so no
extra wiring is needed for local dev.
