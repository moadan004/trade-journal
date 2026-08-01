"use client";

import { useSyncExternalStore } from "react";

import {
  formatCountdown,
  formatSessionWindow,
  isOverlapActive,
  sessionStates,
  OVERLAP_END_HOUR,
  OVERLAP_START_HOUR,
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

  return (
    <section aria-label="Trading sessions">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {states.map(({ session, active, msUntilChange }) => (
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
              {active ? "until close" : "until open"} · {formatSessionWindow(session)}
            </p>
          </div>
        ))}
      </div>

      {overlap && (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          London/New York overlap ({OVERLAP_START_HOUR}:00-{OVERLAP_END_HOUR}:00 UTC) — typically the
          most active window of the day.
        </p>
      )}
    </section>
  );
}
