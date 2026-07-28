# Trade Journal

[![CI](https://github.com/moadan004/trade-journal/actions/workflows/ci.yml/badge.svg)](https://github.com/moadan004/trade-journal/actions/workflows/ci.yml)

A trading journal app with a TradeZella-style calendar dashboard (monthly P&L calendar,
daily win-rate/trade-count cells). See [`plan.md`](./plan.md) for the full build plan.

**Status:** Phases 1–5 complete — backend foundation, frontend core, trade management,
analytics, and polish (CSV import, mobile-responsive calendar with swipe navigation,
dark mode). Since then: Google OAuth sign-in alongside email/password, and Phase 9A
moving the JWT into an httpOnly cookie.

Deploy configuration for Phase 9B is in the repo (`render.yaml`, `backend/runtime.txt`,
and the [Deploying](#deploying) runbook), but **the deploy itself has not been
performed** — that needs Render/Vercel/Google Cloud account access.

## Stack

- **Backend:** FastAPI + SQLAlchemy + Alembic, PostgreSQL, JWT auth (bcrypt via passlib)
- **Frontend:** Next.js (App Router) + Tailwind, client-rendered auth + calendar dashboard

## Repo layout

```
/backend    FastAPI app (routers/, models/, schemas/, core/, services/, alembic/)
/frontend   Next.js app (login/register pages, calendar dashboard, analytics)
docker-compose.yml   Local Postgres for development
render.yaml          Render Blueprint: backend web service + Postgres
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
| GET    | `/stats/risk`                 | Max drawdown + drawdown curve, R-multiple histogram, win/loss/current streaks (same filters) |
| GET    | `/stats/sessions`             | Per-session trade count, win rate and avg P&L, bucketed by entry hour in UTC (same filters) |
| POST   | `/trades/import`              | Bulk-import trades from a CSV (multipart: `file`, `account_id`, optional `tag`) |
| GET    | `/reviews/{date}`             | The weekly review covering `date`, or a blank template if none written yet |
| POST   | `/reviews`                    | Create a weekly review (409 if one already exists for that week) |
| PUT    | `/reviews/{date}`             | Upsert the weekly review covering `date` |
| GET    | `/trades/export`              | Download filtered trades as `format=csv` or `format=pdf` (optional `start`/`end`/`account_id`) |
| POST   | `/trades/{id}/screenshot`     | Attach a chart image (multipart `file`), replacing any existing one |
| DELETE | `/trades/{id}/screenshot`     | Remove a trade's screenshot |

Also `POST /auth/logout` (clears the auth cookie) and `GET /auth/me` (returns the
signed-in user, or 401).

All routes except `/auth/register`, `/auth/login`, `/auth/google`, `/auth/logout` and
`/health` require authentication. Credentials come from the **httpOnly `access_token`
cookie**, with an `Authorization: Bearer <token>` header still accepted as a
transitional fallback — see [How auth is stored](#how-auth-is-stored-httponly-cookie).

`tags` on the stats endpoints is a comma-separated list matched with Postgres array
overlap (`&&`) — a trade matches if it has **any** of the given tags. `setup_tag` is a
separate filter matched **exactly**, since a trade has at most one setup.

### Journal & discipline

**`setup_tag`** is the setup traded — one per trade, kept deliberately separate from the
multi-valued `tags` array. Folding it in would make "group by setup" ambiguous for any
trade carrying several tags. The form suggests common setups via a datalist but accepts
free text, so logging a new setup you're trying out isn't blocked.

**`checklist_json`** stores the pre-trade discipline answers as `{item_key: bool}`. JSONB
rather than four columns because the item list is expected to change and a schema
migration per checklist edit would be absurd. The four current items live in
`frontend/src/lib/checklist.ts`.

Both are nullable — trades logged before Phase 7, and every CSV import, have `NULL`. The
form only sends `checklist_json` when the checkboxes actually changed from what was
loaded, so editing a trade for an unrelated reason can't fabricate an all-false record of
discipline answers nobody gave.

**Weekly reviews** are one free-text reflection per user per week, keyed by the **Monday**
of the week. Every route accepts any date within the target week and normalizes it
server-side, so Tuesday and Wednesday can't address two different rows; a unique
constraint on `(user_id, week_start_date)` enforces that in the database, and the `PUT`
upsert recovers from the race that constraint exists to catch. `GET` returns a blank
template rather than 404 so the client always has a field to bind to.

> **Known inconsistency:** `/reviews` uses Monday-based weeks (matching the backend),
> while the dashboard's "this week's P&L" card uses Sunday-based weeks
> (`getThisWeekRange` in `lib/dateRanges.ts`). Left as-is rather than silently shifting a
> number that's already on screen; worth unifying deliberately at some point.

### Risk metrics

`risk_amount` on a trade is the money at risk from entry to stop, in account currency.
It's **nullable** — every trade logged before it existed, and every CSV import (broker
exports don't carry a risk column), has `NULL`. Add it from the trade form; editing an
existing trade is the backfill mechanism.

R is **derived on read** as `pnl / risk_amount`, not stored, so it can't drift from the
P&L it describes. The long-dormant `r_multiple` column is now an explicit override: it
wins when set, which covers trades where you know R but not the dollar risk. A
`risk_amount` of zero or less counts as missing rather than being divided by.

Because trades without risk data are simply absent from the R histogram, `/stats/risk`
returns `trades_with_risk` and `trades_missing_risk` alongside it, and the UI shows both
— an R distribution built from 3 of 200 trades is easy to over-read without that count.

Drawdown is measured on cumulative P&L starting at zero, not on account balance: the app
never records a starting balance or deposits. A losing first trade is therefore in
drawdown immediately. Streaks use trade status in close order, and a breakeven **ends** a
streak without starting one — treating it as neutral would silently merge two wins around
a scratch into a 2-streak.

Sessions bucket on `entry_time` in UTC (the session is a property of when you took the
setup): Asian `00–08`, London `08–13`, London/NY overlap `13–16`, New York `16–21`,
off-hours `21–00`.

### Screenshots

Images are written to `backend/uploads/screenshots/` (gitignored, configurable via
`UPLOAD_DIR`) and served from a `/uploads` static mount. Both the Next dev server and
Vercel proxy `/uploads/*` to the backend alongside `/api/*`, so the stored URL stays a
plain backend-relative path with no frontend routing baked into it.

> ⚠️ **Uploads do not survive a deploy on Render.** The free tier's filesystem is
> ephemeral — every deploy and every restart wipes it, and `screenshot_url` will then
> point at a file that no longer exists. This is fine for local use; before relying on
> it in production, move to a Render persistent disk or S3-compatible storage.

Three things the upload path deliberately doesn't trust:

- **The client's filename.** Stored names are generated (`uuid4().hex` + a whitelisted
  extension), so `../../` in a filename can't escape the upload directory.
- **The client's `Content-Type`.** It's trivially forged, and what a browser does with a
  file depends on its bytes, so the format is sniffed from magic bytes instead.
- **SVG.** Rejected outright. It can carry `<script>`, and these files are served from the
  app's own origin, so accepting SVG would turn "upload a screenshot" into stored XSS
  against yourself. PNG, JPEG, GIF and WebP only, 5MB cap (`MAX_UPLOAD_BYTES`).

### Export

`GET /trades/export?format=csv|pdf`. CSV carries the full record (15 columns, including
the derived R) and is UTF-8 with a BOM so Excel reads non-ASCII correctly — the same
encoding the importer accepts. The PDF is a summary artifact rather than an interchange
format: date, symbol, side, P&L and tags, with a header line of trade count, net P&L and
win rate. It's built with **reportlab**, which is pure Python — WeasyPrint would drag
cairo/pango into the Render build.

### Multi-account comparison

`GET /stats/summary` accepts a repeatable `account_ids` parameter. The top-level figures
stay the combined total across whatever is selected, and `by_account` adds the same
figures per account. Both go through one shared aggregation function, so the breakdown
can't drift from the total it decomposes. Accounts with no trades in range still get a
zeroed entry rather than disappearing. Omitting `account_ids` leaves `by_account` empty,
so single-account callers see no change.

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

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main`
and every pull request targeting `main`. Two jobs run **in parallel**, and the
workflow fails if either one does:

| Job | What it does |
|-----|--------------|
| **Backend** | Python 3.12, `pip install -r requirements.txt`, `alembic upgrade head`, `pytest tests/` — against a `postgres:16-alpine` service container (same major as `docker-compose.yml`) |
| **Frontend** | Node 24, `npm ci`, `npm run lint`, `npx tsc --noEmit` |

Two pins worth knowing about:

- **Python 3.12 is pinned for reproducibility, not because 3.13 is broken.**
  `passlib` 1.7.4 is unmaintained (last release 2020) and does reference the stdlib
  `crypt` module removed in 3.13 — but that import is wrapped in
  `try/except ImportError`, and we use the bcrypt backend, which doesn't need it.
  Verified directly on 3.13: hashing succeeds, correct passwords verify, wrong ones
  are rejected, with `passlib.utils.has_crypt == False`. So 3.13 works; the pin just
  keeps CI on a single interpreter we actually test rather than following whatever
  the runner defaults to. (An earlier revision of this file claimed 3.13 would break
  the backend. That was wrong.)
- **`npm ci`, not `npm install`.** It installs strictly from `package-lock.json` and
  fails loudly if the lockfile has drifted from `package.json`, which is what you
  want in CI (`npm install` would silently resolve new versions instead).

The backend job gets `DATABASE_URL` and `JWT_SECRET` from the workflow's `env:` block
rather than a `.env` file, so no secrets are needed to run CI — the JWT secret there
is a throwaway used only for the test run.

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
- **Risk section on `/analytics`** — max drawdown, average R (with best/worst), and
  current streak as stat cards; an underwater drawdown area chart; an R-multiple
  histogram coloured by win/loss with the count of trades excluded for want of risk
  data; and a session-breakdown table (a table, not a chart, because the comparison
  spans three different units). Sessions with no trades stay listed — "I never trade
  the Asian session" is itself a finding. All three panels are fetched together with
  identical filters, so they always describe the same set of trades.
- **Risk on the trade form** — optional `Risk` input with a live R preview. Editing a
  trade without touching side, prices or size preserves its stored P&L rather than
  recomputing it, so backfilling risk onto a CSV-imported trade can't overwrite the
  broker's figure (which includes swap and commission and won't reproduce from prices).
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
- **Pre-trade checklist and setup tag** — four fixed checkboxes on the trade form saved as
  `checklist_json`, plus a setup input separate from instrument tags. Day-drawer trade rows
  show the setup as a pill and a compact checklist score (e.g. "3/4").
- **`/reviews`** — the week's P&L, win rate and profit factor above a free-text reflections
  box, with arrow navigation between weeks. Saving is explicit rather than autosave (with
  an unsaved-changes indicator), so a half-written thought isn't persisted mid-sentence.
- **Setup filter on `/analytics`** — a single-value input beside the tag filter, matching
  the one-setup-per-trade model, applied to summary, risk and session panels together.
- **Trade screenshots** — file picker with live preview in the trade form; thumbnail on
  the trade row in the day drawer, click to enlarge in a lightbox (Escape or click-away
  to close). A new trade has no id until saved, so the file is staged and uploaded once
  the trade exists.
- **Export** — CSV/PDF buttons on `/analytics` carrying the page's current date range and
  account, so the download matches what's on screen. Fetched rather than linked: a plain
  `<a download>` would write a JSON 401 body into the saved file and report success.
- **Account comparison** — a "Compare accounts" option (shown once you have more than one
  account) renders side-by-side per-account cards with the best and worst performer
  flagged. Accounts you haven't traded this period keep a card, since that's itself worth
  seeing.

### How auth is stored (httpOnly cookie)

The JWT lives in an **httpOnly cookie**, so JavaScript cannot read it. This replaced
the original `localStorage` approach in Phase 9A, closing the XSS token-theft exposure
that earlier revisions of this file documented as an accepted tradeoff.

**The browser only ever talks to the frontend's own origin.** A Next.js rewrite in
`frontend/next.config.ts` proxies `/api/*` to the backend, which matters more than it
first appears: Vercel and Render are different registrable domains, so calling the
backend directly would be *cross-site*, and `SameSite=Lax`/`Strict` cookies are **not
sent** on cross-site requests — auth would fail silently in production. Keeping it
same-site means:

- the cookie can stay `SameSite=Lax`
- **no CSRF token scheme is needed**
- no CORS is needed in production (the Vercel→backend hop is server-to-server)
- the backend URL never ships in the client bundle (`BACKEND_ORIGIN` is not `NEXT_PUBLIC_`)

Consequences worth knowing:

- `GET /auth/me` exists because JS can't read the cookie to check for a session, and
  `POST /auth/logout` exists because JS can't clear one. Logout is intentionally
  unauthenticated so an already-expired session can still be cleared.
- Pages no longer pre-check a token before fetching. An unauthenticated visitor is
  detected by a request returning 401, so there's a brief render before the redirect,
  and logging out logs a few harmless 401s in the browser console.
- The cookie's `Max-Age` mirrors `ACCESS_TOKEN_EXPIRE_MINUTES`, so the browser stops
  sending a token the backend would reject anyway.
- **Transitional:** the backend still accepts an `Authorization: Bearer` header as a
  fallback, and still returns `access_token` in auth response bodies, so a browser tab
  holding a pre-migration token isn't logged out mid-session. When both are present the
  cookie wins. Both are scheduled for removal once cookies are confirmed in production.

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
calendar dashboard. No extra wiring is needed for local dev: the frontend's
`.env.local` sets `BACKEND_ORIGIN=http://localhost:8000` for the `/api/*` proxy, and
`CORS_ORIGINS` already allows `http://localhost:3000`.

Note that requests appear in devtools as `localhost:3000/api/...`, not
`localhost:8000/...` — that's the proxy working as intended.

## Deploying

Backend and database on **Render**, frontend on **Vercel**. The backend side is
declared as code in [`render.yaml`](./render.yaml) so it's reviewable in git rather
than living only in dashboard clicks.

### Ordering

There's one real dependency: **the frontend needs the backend's URL**, so deploy
Render first. (There is no dependency in the other direction — production needs no
CORS, because the browser only talks to Vercel and the Vercel→Render hop is
server-to-server.)

### 1. Render — backend + Postgres

Render → **Blueprints** → **New Blueprint Instance** → point at this repo. `render.yaml`
creates the Postgres instance and the `trade-journal-api` web service, wires
`DATABASE_URL` from the database, generates a `JWT_SECRET`, and sets `COOKIE_SECURE=true`.

Two variables are marked `sync: false` and must be set by hand in the dashboard:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | your OAuth Client ID (same value the frontend uses) |
| `CORS_ORIGINS` | optional — see note below |

Note the URL Render assigns the service, e.g. `https://trade-journal-api.onrender.com`.

Things `render.yaml` already handles that are easy to get wrong by hand:

- **Migrations run in `startCommand`**, chained ahead of uvicorn:
  `alembic upgrade head && uvicorn ...`. Render's **free tier rejects
  `preDeployCommand`** ("pre-deploy command is not supported for free tier services"),
  which is where this otherwise belongs — move it back if you upgrade the plan.
  Two things to know about the free-tier arrangement: migrations re-run on every start
  (including the wake-up from idle spin-down, where `alembic upgrade head` is a cheap
  no-op once the DB is at head), and a failing migration **crash-loops the service**
  instead of aborting the deploy and leaving the old version serving — so a deploy that
  never goes healthy means checking the logs for an Alembic error. The `&&` is
  deliberate: if the migration fails, uvicorn never starts, which beats serving against
  a schema the code doesn't expect.
- **Render exposes Postgres as `postgres://...`**, which SQLAlchemy doesn't accept —
  and even `postgresql://` would resolve to psycopg2, which isn't installed. The app
  normalizes either form to `postgresql+psycopg://` at load time
  (`backend/app/core/config.py`), so no manual URL editing is needed.
- **`backend/runtime.txt` pins Python 3.12**, so Render doesn't pick a different default.

### 2. Vercel — frontend

Import the repo, then set:

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| `BACKEND_ORIGIN` | the Render URL from step 1 |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | your OAuth Client ID |

`BACKEND_ORIGIN` deliberately has no `NEXT_PUBLIC_` prefix — it's read only by the
rewrite at build/server time, keeping the backend URL out of the client bundle.

### 3. Google OAuth

In Google Cloud Console → Credentials → your OAuth client, add the Vercel production
URL to **Authorized JavaScript origins**. No redirect URI is needed: the flow is
client-side and posts the resulting ID token to our own backend.

### 4. Optional: `CORS_ORIGINS`

Not required for the proxied setup, since no browser calls Render directly. Set it to
your Vercel URL only if you also want to hit the API straight from a browser (e.g. for
debugging). Wildcards are rejected by browsers when credentials are included, so it must
be explicit if set at all.

### Verify on the live URLs

Deploying isn't done until this passes end-to-end in production:

1. Register a fresh account, then reload — the session should persist (that's `/auth/me`
   working through the proxy).
2. Add a trade; confirm it appears on the calendar and on `/analytics`.
3. Log out; confirm `/dashboard` bounces to `/login`.
4. In devtools → Application → Cookies, confirm the cookie is flagged **`HttpOnly`** and
   **`Secure`**, and that **`localStorage` is empty**.
5. In devtools → Network, confirm requests go to your Vercel origin under `/api/*` and
   not to the Render domain.

Two things to expect on Render's free tier: the service **spins down when idle**, so the
first request after a quiet period is slow, and free Postgres has retention/lifetime
limits — check Render's current terms before trusting it with trade data you care about.
