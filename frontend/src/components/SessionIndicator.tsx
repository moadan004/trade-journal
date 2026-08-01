"use client";

import { useSyncExternalStore } from "react";

import {
  formatCountdown,
  formatLocalDayTime,
  formatLocalWindow,
  formatSessionWindow,
  isOverlapActive,
  isWeekendClosure,
  localSessionWindow,
  localZoneLabel,
  marketOpenInstant,
  resolvedTimeZone,
  sessionStates,
  OVERLAP_WINDOW,
} from "@/lib/sessions";

/**
 * How often the widget re-reads the clock. Labels are minute-resolution, so
 * 30s keeps them at most one tick stale while staying far cheaper than 1s.
 */
const TICK_MS = 30_000;

/**
 * A clock read as an external store rather than useState + useEffect.
 *
 * Two reasons. Client Components are still prerendered to HTML on the server,
 * so calling Date.now() during render would bake server time into the markup
 * and mismatch on hydration; getServerSnapshot lets the first paint render a
 * neutral placeholder instead. And it keeps the ticking out of an effect, so
 * there's no setState-in-effect for react-hooks to flag.
 */
function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}

/**
 * Bucketed to TICK_MS so repeated reads within a tick are `Object.is`-equal.
 * Returning a raw Date.now() here would look like a new value on every render
 * and spin.
 */
function getSnapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

/** 0 means "no clock yet" - the server has no meaningful browser time. */
function getServerSnapshot(): number {
  return 0;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </div>
  );
}

export function SessionIndicator() {
  const tick = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Pre-hydration placeholder. Same card chrome as the real thing so the layout
  // doesn't shift once the clock arrives.
  if (tick === 0) {
    return (
      <section aria-label="Trading sessions" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {["Asian", "London", "New York"].map((name) => (
          <Card key={name}>
            <p className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{name}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-300 dark:text-zinc-700">--</p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">&nbsp;</p>
          </Card>
        ))}
      </section>
    );
  }

  const now = new Date(tick);
  const states = sessionStates(now);
  const overlap = isOverlapActive(now);
  const weekend = isWeekendClosure(now);
  const reopen = marketOpenInstant(now);
  // Resolved once per tick from the browser, never hardcoded.
  const zoneLabel = localZoneLabel(now);
  const zoneName = resolvedTimeZone();

  return (
    <section aria-label="Trading sessions" data-weekend={weekend}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {states.map(({ session, active, msUntilChange, weekendClosed }) => (
          <div
            key={session.id}
            data-testid={`session-${session.id}`}
            data-active={active}
            className={`rounded-2xl border p-5 transition-colors ${
              active
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
                : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p
                className={`text-xs uppercase tracking-wide ${
                  active ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                {session.name}
              </p>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                  active ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                  }`}
                />
                {active ? "Open" : "Closed"}
              </span>
            </div>

            <p
              className={`mt-1 text-2xl font-semibold ${
                active ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              {formatCountdown(msUntilChange)}
            </p>

            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {weekendClosed ? "until market opens" : active ? "until close" : "until open"} ·{" "}
              {/* Local wall clock; the canonical UTC range is in the tooltip. */}
              <span title={formatSessionWindow(session)}>
                {formatLocalWindow(localSessionWindow(session, now))}
              </span>
            </p>
          </div>
        ))}
      </div>

      {weekend && reopen && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
          {/* "your time" inline rather than relying on the zone caption below:
              the reopen weekday can differ from the UTC one, so this line has to
              stand on its own or it reads like a contradiction. */}
          Market closed for the weekend — reopens {formatLocalDayTime(reopen)} your time.
        </p>
      )}

      {overlap && (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          {/* Converted like the cards above it. Left in UTC this was the one
              line still quoting a different clock from everything around it. */}
          London/New York overlap ({formatLocalWindow(localSessionWindow(OVERLAP_WINDOW, now))}) —
          typically the most active window of the day.
        </p>
      )}

      {/* Without this the local ranges would read as UTC and quietly mislead.
          "+1" on a range means it runs past your midnight into the next day. */}
      <p data-testid="session-zone" className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
        Session times shown in your local time — {zoneLabel} ({zoneName}).
      </p>
    </section>
  );
}
