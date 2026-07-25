# Trade Journal

A trading journal app with a TradeZella-style calendar dashboard (monthly P&L calendar,
daily win-rate/trade-count cells). See [`plan.md`](./plan.md) for the full build plan.

**Status:** Phase 1 (backend foundation) complete. Phase 2+ (frontend) not yet built —
`/frontend` is a bare `create-next-app` scaffold only.

## Stack

- **Backend:** FastAPI + SQLAlchemy + Alembic, PostgreSQL, JWT auth (bcrypt via passlib)
- **Frontend:** Next.js (App Router) + Tailwind (scaffolded, not built out yet)

## Repo layout

```
/backend    FastAPI app (routers/, models/, schemas/, core/, alembic/)
/frontend   Next.js app (bare scaffold, Phase 2)
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
| GET    | `/trades`                     | List your trades (optional `account_id`)  |
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

## Frontend (Phase 2+, not yet built)

```bash
cd frontend
npm install
npm run dev
```

Currently just the default `create-next-app` scaffold with Tailwind enabled — no journal
UI has been implemented yet.
