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
  // Nominal start; the real one is DST-resolved - see asiaPacificWindow.
  { id: "asia_pacific", name: "Asia-Pacific", startHour: 22, endHour: 8 },
  { id: "london", name: "London", startHour: 8, endHour: 16 },
  { id: "new_york", name: "New York", startHour: 13, endHour: 21 },
];

/** True for a window that runs through 00:00 UTC, e.g. Asia-Pacific 22:00-08:00. */
export function wrapsMidnight(session: TradingSession): boolean {
  return session.endHour <= session.startHour;
}

/**
 * Sydney and Tokyo, tracked as one block.
 *
 * Every window in this file is the centre's 09:00-18:00 local cash session under
 * standard time, which is what puts London at 08:00-16:00 and New York at
 * 13:00-21:00 UTC. Sydney and Tokyo are quoted the same way:
 *
 *   Tokyo   09:00-18:00 JST  = 00:00-09:00 UTC, fixed - Japan has no DST at all.
 *   Sydney  09:00-18:00 AEDT = 22:00-07:00 UTC  (southern summer)
 *           09:00-18:00 AEST = 23:00-08:00 UTC  (southern winter)
 *
 * So the block opens with Sydney at 22:00 or 23:00 UTC depending on the season -
 * resolved through the IANA zone rather than pinned, exactly as the weekly close
 * is. It closes at 08:00 UTC, London's open, which clips the last hour of Tokyo
 * for the same reason the old single "Asian" card did: the windows have to hand
 * over cleanly at a shared boundary.
 *
 * This is the first window here that runs through midnight UTC, which is why
 * wrapsMidnight exists.
 */
export const ASIA_PACIFIC = TRADING_SESSIONS[0];
export const SYDNEY_TIME_ZONE = "Australia/Sydney";
export const TOKYO_TIME_ZONE = "Asia/Tokyo";
/** Every centre's cash session, in its own local time. */
export const CENTRE_OPEN_HOUR = 9;
export const CENTRE_CLOSE_HOUR = 18;
/** Tokyo joins here. Fixed: 09:00 JST is 00:00 UTC year-round. */
export const TOKYO_OPEN_UTC_HOUR = 0;

/** The UTC hour of Sydney's 09:00 on the date of `now`: 22 under AEDT, 23 under AEST. */
export function sydneyOpenUtcHour(now: Date): number {
  // Offset in whole hours between UTC and Sydney at this instant.
  const c = zonedClock(now, SYDNEY_TIME_ZONE);
  const offsetHours = Math.round(
    (Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) -
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
      )) /
      MS_PER_HOUR,
  );
  return (CENTRE_OPEN_HOUR - offsetHours + 24) % 24;
}

/** The block's window in UTC hours for the date of `now`, start DST-resolved. */
export function asiaPacificWindow(now: Date): TradingSession {
  return { ...ASIA_PACIFIC, startHour: sydneyOpenUtcHour(now) };
}

/** True once Tokyo has joined - the meaningful transition inside the block. */
export function isTokyoActive(now: Date): boolean {
  if (isWeekendClosure(now)) return false;

  const { hour } = zonedClock(now, TOKYO_TIME_ZONE);
  return hour >= CENTRE_OPEN_HOUR && hour < CENTRE_CLOSE_HOUR && msOfUtcDay(now) < 8 * MS_PER_HOUR;
}

/** UTC hours during which London and New York are both open. */
export const OVERLAP_START_HOUR = 13;
export const OVERLAP_END_HOUR = 16;

/**
 * The overlap shaped like a session, purely so it converts to local time
 * through the same path as the three real ones.
 *
 * Deliberately NOT part of TRADING_SESSIONS: it is derived from London and New
 * York rather than a fourth market, so it must not become a fourth card, and it
 * must not be double-counted by anything walking the session list.
 */
export const OVERLAP_WINDOW: TradingSession = {
  id: "overlap",
  name: "London/New York overlap",
  startHour: OVERLAP_START_HOUR,
  endHour: OVERLAP_END_HOUR,
};

/**
 * The busiest hour: the first of the overlap.
 *
 * Two things stack here. The major US releases print at 08:30 and 10:00 ET,
 * which is 12:30/13:30 UTC in summer and 13:30/15:00 UTC in winter - so the
 * 13:00-14:00 UTC hour catches the bulk of them - and the New York cash open
 * adds its own volatility while London is still fully staffed.
 *
 * Named constants rather than inline literals precisely because that ET-to-UTC
 * mapping shifts with US DST, so this is a window someone may well want to move.
 * Changing these two numbers is the whole edit; the predicate, the local-time
 * conversion and the badge all read from them.
 */
export const PEAK_HOUR_START_UTC = 13;
export const PEAK_HOUR_END_UTC = 14;

export const PEAK_WINDOW: TradingSession = {
  id: "peak",
  name: "Peak activity",
  startHour: PEAK_HOUR_START_UTC,
  endHour: PEAK_HOUR_END_UTC,
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * The weekly close/open, anchored to 17:00 in New York.
 *
 * The convention is usually quoted as "Friday 5pm EST to Sunday 5pm EST", but
 * it tracks New York *local* time, so the UTC hour moves with US DST: 21:00 UTC
 * while EDT is in force, 22:00 UTC under EST. Hard-coding either one would be
 * wrong for half the year - which is the same class of bug as ignoring the day
 * of week - so the boundary is resolved through the IANA zone.
 *
 * Note this makes the weekend boundary DST-aware while the session hours above
 * stay fixed UTC. That asymmetry is deliberate: the weekly close is a hard
 * market-wide fact, whereas the session windows are conventional approximations
 * that everyone quotes in round UTC hours.
 */
export const MARKET_TIME_ZONE = "America/New_York";
export const MARKET_BOUNDARY_HOUR_NY = 17;
const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 0;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let existing = zoneFormats.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // h23 rather than hour12:false - some ICU builds render midnight as "24".
      hourCycle: "h23",
    });
    zoneFormats.set(timeZone, existing);
  }
  return existing;
}

interface ZonedClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

/** The wall clock in a given IANA zone at a given instant. */
function zonedClock(date: Date, timeZone: string): ZonedClock {
  const parts: Record<string, string> = {};
  for (const part of zoneFormat(timeZone).formatToParts(date)) parts[part.type] = part.value;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday],
  };
}

/** ms to add to a UTC instant to get the New York wall clock reading. */
function nyOffset(date: Date): number {
  const c = zonedClock(date, MARKET_TIME_ZONE);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - date.getTime();
}

/**
 * The UTC instant at which New York's wall clock reads the given date at `hour`.
 *
 * Resolved twice because the offset depends on the very instant being solved
 * for: the first guess uses the offset at the naive time, the second uses the
 * offset actually in force at that guess.
 *
 * For the 17:00 boundary this repo uses, one pass would in fact be enough - the
 * US switches at 02:00 local, i.e. 06:00/07:00 UTC on the Sunday, which is
 * always earlier than a 17:00-local target resolves to. Removing the second pass
 * currently breaks no test. It is kept because MARKET_BOUNDARY_HOUR_NY is an
 * exported constant: point it near a changeover and the single-pass version
 * would start returning an hour-shifted instant with nothing to catch it.
 */
function instantAtNyHour(year: number, month: number, day: number, hour: number): number {
  const naive = Date.UTC(year, month - 1, day, hour);
  const firstGuess = naive - nyOffset(new Date(naive));
  return naive - nyOffset(new Date(firstGuess));
}

/** True while the whole FX market is shut for the weekend. */
export function isWeekendClosure(now: Date): boolean {
  const { weekday, hour } = zonedClock(now, MARKET_TIME_ZONE);

  if (weekday === SATURDAY) return true;
  if (weekday === FRIDAY) return hour >= MARKET_BOUNDARY_HOUR_NY;
  if (weekday === SUNDAY) return hour < MARKET_BOUNDARY_HOUR_NY;
  return false;
}

/** ms until the market reopens. 0 when it is already open. */
export function msUntilMarketOpen(now: Date): number {
  if (!isWeekendClosure(now)) return 0;

  const c = zonedClock(now, MARKET_TIME_ZONE);
  // Days forward to Sunday in New York's calendar. Friday and Saturday look
  // ahead; a Sunday before 17:00 opens later the same day.
  const daysAhead = c.weekday === SUNDAY ? 0 : 7 - c.weekday;

  // Normalize the target date through Date.UTC so month/year roll over for us.
  const target = new Date(Date.UTC(c.year, c.month - 1, c.day + daysAhead));

  const openInstant = instantAtNyHour(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    MARKET_BOUNDARY_HOUR_NY,
  );

  return openInstant - now.getTime();
}

/** The reopen instant, for labelling the banner. Null while the market is open. */
export function marketOpenInstant(now: Date): Date | null {
  const ms = msUntilMarketOpen(now);
  return ms > 0 ? new Date(now.getTime() + ms) : null;
}

export interface SessionState {
  session: TradingSession;
  active: boolean;
  /** ms until this session closes (when active) or next opens (when inactive). */
  msUntilChange: number;
  /** True when the countdown targets the weekly reopen, not an hour boundary. */
  weekendClosed: boolean;
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
  // Layered on top of - not replacing - the hour logic below: no session can be
  // open while the market is shut, whatever the UTC hour says, and every card
  // then counts down to the weekly reopen rather than its own next boundary.
  if (isWeekendClosure(now)) {
    return { session, active: false, msUntilChange: msUntilMarketOpen(now), weekendClosed: true };
  }

  // Asia-Pacific opens when Sydney does, which moves with Australian DST.
  const resolved = session.id === ASIA_PACIFIC.id ? asiaPacificWindow(now) : session;

  const elapsed = msOfUtcDay(now);
  const start = resolved.startHour * MS_PER_HOUR;
  const end = resolved.endHour * MS_PER_HOUR;

  // Half-open [start, end), matching the backend's bucket convention: at exactly
  // 16:00 UTC London is closed and New York is open, never both or neither.
  //
  // A window through midnight inverts the test: 22:00-08:00 is on when the clock
  // is at or past 22:00 OR still before 08:00, where the same expression for a
  // same-day window would be on for neither.
  const wraps = wrapsMidnight(resolved);
  const active = wraps ? elapsed >= start || elapsed < end : elapsed >= start && elapsed < end;

  if (active) {
    // Past midnight the close is today's; before it, tomorrow's.
    const close = wraps && elapsed >= start ? end + MS_PER_DAY : end;
    return { session, active, msUntilChange: close - elapsed, weekendClosed: false };
  }

  // Already past today's open, so the next one is tomorrow's.
  const nextOpen = elapsed < start ? start : start + MS_PER_DAY;
  return { session, active, msUntilChange: nextOpen - elapsed, weekendClosed: false };
}

export function sessionStates(now: Date): SessionState[] {
  return TRADING_SESSIONS.map((session) => sessionState(session, now));
}

/**
 * True during the busiest hour, the first of the overlap.
 *
 * Layered on the overlap rather than replacing it: this is always a strict
 * subset, so whenever it is true the overlap note is showing too. The weekend
 * guard is repeated here rather than inferred - a peak badge on a Saturday would
 * be exactly the bug the closure rule exists to prevent.
 */
export function isPeakActivity(now: Date): boolean {
  if (isWeekendClosure(now)) return false;

  const elapsed = msOfUtcDay(now);
  return elapsed >= PEAK_HOUR_START_UTC * MS_PER_HOUR && elapsed < PEAK_HOUR_END_UTC * MS_PER_HOUR;
}

/** True when London and New York are both open - the 13:00-16:00 UTC window. */
export function isOverlapActive(now: Date): boolean {
  // There is no overlap when nothing is open; the window falls on a weekend
  // whenever Saturday or Sunday passes through 13:00-16:00 UTC.
  if (isWeekendClosure(now)) return false;

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

/** e.g. "08:00-16:00 UTC". The canonical form, kept for reference in a tooltip. */
export function formatSessionWindow(session: TradingSession): string {
  const pad = (hour: number) => String(hour).padStart(2, "0");
  return `${pad(session.startHour)}:00-${pad(session.endHour)}:00 UTC`;
}

/* ------------------------------------------------------------------------- *
 * Display layer.
 *
 * Everything below converts already-decided instants into the reader's local
 * wall clock. None of it feeds back into the open/closed comparisons above,
 * which stay anchored to UTC hours and New York for the weekly boundary - a
 * session does not open earlier because you flew somewhere.
 *
 * `timeZone` is a parameter rather than a constant so tests can pin a zone;
 * passing undefined lets Intl use the browser's own, which is what ships.
 * ------------------------------------------------------------------------- */

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let existing = timeFormatters.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timeFormatters.set(key, existing);
  }
  return existing;
}

/** "19:00" in the reader's zone. */
export function formatLocalTime(instant: Date, timeZone?: string): string {
  return timeFormatter(timeZone).format(instant);
}

/** Days between two instants as the reader's calendar sees them: 0, 1, -1... */
function localDayDelta(from: Date, to: Date, timeZone: string | undefined): number {
  const key = (d: Date) => {
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d)) {
      parts[p.type] = p.value;
    }
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  };
  return Math.round((key(to) - key(from)) / MS_PER_DAY);
}

export interface LocalWindow {
  start: string;
  end: string;
  /** 1 when the window runs past local midnight, so the end is the next day. */
  dayShift: number;
}

/**
 * A session's UTC window expressed on the reader's clock.
 *
 * `reference` supplies the calendar day to convert on, because the offset is
 * date-dependent - a zone observing DST maps 08:00 UTC to different local hours
 * in January and July.
 */
export function localSessionWindow(
  session: TradingSession,
  reference: Date,
  timeZone?: string,
): LocalWindow {
  const midnightUtc = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  );
  const resolved = session.id === ASIA_PACIFIC.id ? asiaPacificWindow(reference) : session;
  const start = new Date(midnightUtc + resolved.startHour * MS_PER_HOUR);
  // A window through midnight ends on the following UTC day, so the end instant
  // has to be pushed a day forward before it is converted for display.
  const end = new Date(
    midnightUtc + (resolved.endHour + (wrapsMidnight(resolved) ? 24 : 0)) * MS_PER_HOUR,
  );

  return {
    start: formatLocalTime(start, timeZone),
    end: formatLocalTime(end, timeZone),
    dayShift: localDayDelta(start, end, timeZone),
  };
}

/** "11:00-19:00", or "22:00-06:00 +1" when the window crosses local midnight. */
export function formatLocalWindow(window: LocalWindow): string {
  const range = `${window.start}-${window.end}`;
  return window.dayShift > 0 ? `${range} +${window.dayShift}` : range;
}

/** "Sunday 00:00" in the reader's zone - weekday included since it can shift. */
export function formatLocalDayTime(instant: Date, timeZone?: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(instant);
  return `${weekday} ${formatLocalTime(instant, timeZone)}`;
}

/** The reader's zone as a short label: "GMT+3", "EDT". */
export function localZoneLabel(reference: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(
    reference,
  );
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "local time";
}

/** The IANA zone actually in effect, for the "which timezone?" caption. */
export function resolvedTimeZone(timeZone?: string): string {
  return timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
