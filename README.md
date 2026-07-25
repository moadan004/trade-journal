# Trade Journal

A trading journal app with a TradeZella-style calendar dashboard (monthly P&L calendar,
daily win-rate/trade-count cells). See [`plan.md`](./plan.md) for the full build plan.

**Status:** All 5 phases from `plan.md` are complete — backend foundation, frontend
core, trade management, analytics, and Phase 5 polish (CSV import, mobile-responsive
calendar with swipe navigation, dark mode) — plus a post-plan addition: Google OAuth
sign-in alongside the original email/password auth.

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
# edit .env if you're not using the default docker-compose Postgres, and/or to set a
# real GOOGLE_CLIENT_ID once you have one (see "Google OAuth setup" below)
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
| POST   | `/auth/register`              | Create a user with email/password, returns a JWT |
| POST   | `/auth/login`                 | Log in with email/password, returns a JWT |
| POST   | `/auth/google`                | Verify a Google ID token, create/link the account, returns the same kind of JWT |
| POST   | `/accounts`                   | Create a trading account (auth required)  |
| GET    | `/accounts`                   | List your accounts                        |
| POST   | `/trades`                     | Create a trade                            |
| GET    | `/trades`                     | List your trades (optional `account_id`, `date=YYYY-MM-DD`) |
| GET    | `/trades/{id}`                | Get a single trade                        |
| PUT    | `/trades/{id}`                | Update a trade                            |
| DELETE | `/trades/{id}`                | Delete a trade                            |
| GET    | `/stats/calendar?month=YYYY-MM` | Per-day P&L/trade-count/win-rate for a month (optional `account_id`, `tags=`) |
| GET    | `/stats/summary`              | Aggregate stats + equity curve for an optional `start`/`end`/`account_id`/`tags` range |
| POST   | `/trades/import`              | Bulk-import trades from a CSV (multipart: `file`, `account_id`, optional `tag`) |

All routes except `/auth/*` and `/health` require `Authorization: Bearer <token>`.

`tags` on both stats endpoints is a comma-separated list matched with Postgres array
overlap (`&&`) — a trade matches if it has **any** of the given tags.

### CSV import format

`POST /trades/import` expects one row per **closed** trade, with distinctly-named
open/close columns (the common shape for broker/portal "trade history" exports —
as opposed to the MT5 terminal's raw per-deal log, which reuses `Time`/`Price` for
both legs and isn't supported directly). Required columns (case-insensitive, common
aliases accepted): open time, symbol, side/type (`buy`/`sell` or `long`/`short`),
size/volume, open price, close time, close price, profit. `commission` and `swap`
are optional and summed into `fees`; `comment` becomes the trade's notes. The
**broker's `profit` column is trusted directly as P&L** — it isn't recomputed from
price/size, since accurately valuing forex lot sizes/contract multipliers client-side
would require pip-value data we don't have. Malformed rows are skipped individually
with a reason (bad date, unrecognized side, etc.) rather than failing the whole
import; the response reports `total_rows` / `imported` / `skipped`. See
`frontend/public/sample-trade-import.csv` for a template.

## Google OAuth setup

Email/password auth (`/auth/register`, `/auth/login`) works out of the box with no
setup. Google sign-in (`/auth/google`) needs a real OAuth Client ID from Google Cloud
Console — until you provide one, both `.env.example` / `.env.local.example` ship a
placeholder (`your-client-id.apps.googleusercontent.com`), and the "Sign in with
Google" button on `/login` and `/register` shows a "not configured" note instead of
trying to load Google's SDK against a fake ID.

### Creating a real Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create (or
   select) a project.
2. **APIs & Services → OAuth consent screen** — configure it (External user type is
   fine for testing with your own Google account; add your email as a test user if
   the app is in "Testing" publishing status). No specific Google API needs to be
   *enabled* for this flow — sign-in with Google uses Google Identity Services, not
   a separately-enabled API — but the consent screen must exist before you can create
   credentials.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add every origin the frontend will actually
     be served from, e.g. `http://localhost:3000` for local dev, plus your deployed
     frontend URL (e.g. `https://your-app.vercel.app`). This is the setting that
     matters here — `@react-oauth/google` runs entirely client-side (it renders
     Google's button and posts the resulting ID token to our own backend), so there
     is no OAuth **redirect URI** to whitelist for this flow.
4. Copy the generated Client ID (looks like
   `1234567890-abc123.apps.googleusercontent.com`).
5. Set it in **both** places (it's the same value, checked in two different ways —
   the frontend needs it to initialize Google's SDK, the backend needs it to verify
   that a given ID token was actually issued for *your* app and not someone else's):
   - `backend/.env` → `GOOGLE_CLIENT_ID=...`
   - `frontend/.env.local` → `NEXT_PUBLIC_GOOGLE_CLIENT_ID=...`
6. Restart both dev servers (Next.js only inlines `NEXT_PUBLIC_*` vars at startup).

### How the linking logic works

- New email via Google → creates a `User` with `google_id` set and `password_hash`
  null.
- Existing email that previously registered with a password → the Google sign-in
  links `google_id` onto that same row rather than creating a duplicate account, so
  the user keeps all their existing trades/accounts either way they log in
  afterward.
- A password-less (Google-only) account trying `/auth/login` with a password gets
  the same generic "Invalid email or password" as a nonexistent account — it doesn't
  reveal that the email exists but has no password set.

## Smoke test

With the API running and migrations applied, verify the full flow (register → login →
create trade → calendar stats):

```bash
cd backend
source .venv/bin/activate
pytest tests/test_smoke.py -v -s
```

This runs in-process against your configured `DATABASE_URL` — no separate server needed.

`tests/test_google_auth.py` covers the `/auth/google` account-linking logic (new user,
linking to an existing password account, the `/auth/login` guard for password-less
accounts, rejecting an invalid token) with Google's token verification mocked out —
run it the same way (`pytest tests/test_google_auth.py -v`) or just `pytest tests/`
for everything. This is the only way to exercise that logic without a real Google
account and Client ID: actually completing a Google sign-in requires a live consent
screen and network access to Google's own script host, neither of which a test
suite (or this sandboxed dev environment) can drive end-to-end.

## Frontend setup

### 1. Configure environment

```bash
cd frontend
cp .env.local.example .env.local
# edit .env.local if your backend isn't on http://localhost:8000, and/or to set a
# real NEXT_PUBLIC_GOOGLE_CLIENT_ID once you have one (see "Google OAuth setup" above)
```

### 2. Install and run

```bash
npm install
npm run dev
```

The app is now live at `http://localhost:3000`.

### What's built (Phase 2 + 3 + 4 + 5)

- `/` — landing page, redirects to `/dashboard` if already logged in
- `/login`, `/register` — call the backend's `/auth/login` and `/auth/register`,
  store the returned JWT, redirect to `/dashboard`. Both also show a "Sign in with
  Google" button below a divider — see "Google OAuth setup" above for what it takes
  to make that button live instead of showing a "not configured" note.
- `/dashboard` — month calendar (Sun–Sat grid) fetching `GET /stats/calendar?month=YYYY-MM`
  on load and on prev/next month navigation; day cells are green/red/gray by P&L sign,
  show P&L/trade count/win rate, and a dot when a day has trades; header shows monthly
  P&L and trading-day count. Loading (skeleton) and empty-month states are handled.
  Also shows fixed "this week" / "this month" P&L + trade-count cards (independent of
  which month is navigated to), and a tag filter that recomputes everything on the page.
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
- `/analytics` — account selector, date-range presets (last 30/90 days, this month, all
  time), and the same tag filter as the dashboard. Shows win rate (with W/L/BE
  breakdown), avg win vs. avg loss, profit factor (gross profit / gross loss, "—" when
  there are no losing trades in range), and a Recharts equity curve (cumulative P&L,
  one point per trade, straight segments — no smoothing) built from `GET /stats/summary`.
- **CSV import** — "Import CSV" button on the dashboard (prompts account creation first
  if you have none yet). Upload a trade-history CSV, optionally tag every imported trade,
  and see a summary of rows imported vs. skipped (with reasons) before it refreshes your
  stats. See the CSV import format section above.
- **Dark mode** — toggle in the header (🌙/☀️). Persisted to `localStorage`, defaults to
  OS preference on first visit, and applied via a `beforeInteractive` script so there's
  no flash of the wrong theme on load.
- **Mobile-responsive calendar** — day cells condense (P&L only, counts/win-rate hidden)
  below the `sm` breakpoint, and the calendar grid supports touch swipe (left = next
  month, right = previous) alongside the existing arrow buttons.

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
