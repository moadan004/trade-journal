/**
 * FX trading session windows, in UTC.
 *
 * These are the *real* session windows, so London and New York deliberately
 * overlap between 13:00 and 16:00 UTC - the most active window of the day, when
 * both desks are on. That makes them different in shape from the buckets in the
 * backend's `app/services/risk.py`, which partition the day so a trade lands in
 * exactly one bucket ("London" 08-13, "London/NY overlap" 13-16, "New York"
 * 16-21). Both are derived from the same boundary set {0, 8, 13, 16, 21}: the
 * backend's buckets are the partition these overlapping windows induce, so the
 * two never disagree about when a session is on.
 *
 * Everything here is pure and derived from a caller-supplied `Date`, which is
 * what makes boundary behaviour testable without waiting for real clock time.
 */

export interface TradingSession {
  id: string;
  name: string;
  /** Inclusive UTC hour. */
  startHour: number;
  /** Exclusive UTC hour. */
  endHour: number;
}

export const TRADING_SESSIONS: TradingSession[] = [
  { id: "asian", name: "Asian", startHour: 0, endHour: 8 },
  { id: "london", name: "London", startHour: 8, endHour: 16 },
  { id: "new_york", name: "New York", startHour: 13, endHour: 21 },
];

/** UTC hours during which London and New York are both open. */
export const OVERLAP_START_HOUR = 13;
export const OVERLAP_END_HOUR = 16;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface SessionState {
  session: TradingSession;
  active: boolean;
  /** ms until this session closes (when active) or next opens (when inactive). */
  msUntilChange: number;
}

/** Milliseconds elapsed since 00:00 UTC today. */
export function msOfUtcDay(now: Date): number {
  return (
    now.getUTCHours() * MS_PER_HOUR +
    now.getUTCMinutes() * MS_PER_MINUTE +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds()
  );
}

export function sessionState(session: TradingSession, now: Date): SessionState {
  const elapsed = msOfUtcDay(now);
  const start = session.startHour * MS_PER_HOUR;
  const end = session.endHour * MS_PER_HOUR;

  // Half-open [start, end), matching the backend's bucket convention: at exactly
  // 16:00 UTC London is closed and New York is open, never both or neither.
  const active = elapsed >= start && elapsed < end;

  if (active) return { session, active, msUntilChange: end - elapsed };

  // Already past today's open, so the next one is tomorrow's.
  const nextOpen = elapsed < start ? start : start + MS_PER_DAY;
  return { session, active, msUntilChange: nextOpen - elapsed };
}

export function sessionStates(now: Date): SessionState[] {
  return TRADING_SESSIONS.map((session) => sessionState(session, now));
}

/** True when London and New York are both open - the 13:00-16:00 UTC window. */
export function isOverlapActive(now: Date): boolean {
  const elapsed = msOfUtcDay(now);
  return elapsed >= OVERLAP_START_HOUR * MS_PER_HOUR && elapsed < OVERLAP_END_HOUR * MS_PER_HOUR;
}

/**
 * Coarse "2h 14m" / "45m" countdown.
 *
 * Rounds down, so a label never claims more time than is left. Sub-minute
 * remainders read "<1m" rather than "0m", which would look stalled.
 */
export function formatCountdown(ms: number): string {
  if (ms < MS_PER_MINUTE) return "<1m";

  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** e.g. "08:00-16:00 UTC", for the card subtitle. */
export function formatSessionWindow(session: TradingSession): string {
  const pad = (hour: number) => String(hour).padStart(2, "0");
  return `${pad(session.startHour)}:00-${pad(session.endHour)}:00 UTC`;
}
