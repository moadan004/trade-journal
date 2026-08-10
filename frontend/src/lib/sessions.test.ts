import { describe, expect, it } from "vitest";

import {
  formatCountdown,
  formatLocalDayTime,
  formatLocalWindow,
  formatSessionWindow,
  isOverlapActive,
  isPeakActivity,
  isWeekendClosure,
  localSessionWindow,
  localZoneLabel,
  ASIA_PACIFIC,
  isSydneyActive,
  isTokyoActive,
  SYDNEY_WINDOW,
  TOKYO_WINDOW,
  wrapsMidnight,
  OVERLAP_START_HOUR,
  OVERLAP_WINDOW,
  PEAK_HOUR_END_UTC,
  PEAK_HOUR_START_UTC,
  PEAK_WINDOW,
  msOfUtcDay,
  msUntilMarketOpen,
  resolvedTimeZone,
  sessionStates,
  TRADING_SESSIONS,
} from "@/lib/sessions";

/**
 * A fixed UTC instant on Wednesday 15 July 2026 - a plain mid-week day, so the
 * hour-of-day tests are never perturbed by the weekend rule.
 */
function utc(hour: number, minute = 0, second = 0): Date {
  return new Date(Date.UTC(2026, 6, 15, hour, minute, second));
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** ids of the sessions active at `now`. */
function activeIds(now: Date): string[] {
  return sessionStates(now)
    .filter((s) => s.active)
    .map((s) => s.session.id);
}

function stateOf(now: Date, id: string) {
  const found = sessionStates(now).find((s) => s.session.id === id);
  if (!found) throw new Error(`no session ${id}`);
  return found;
}

describe("session windows", () => {
  it("induces boundaries the backend partition refines", () => {
    // app/services/risk.py cuts the day at 0/6/7/8/12/16/21/23 - exactly the
    // partition these windows induce, plus midnight, which it needs because a
    // bucket cannot wrap a day. Containment rather than equality is the
    // invariant: every edge the widget draws is an edge the stats also draw.
    const BACKEND_BOUNDARIES = [0, 6, 7, 8, 12, 16, 21, 23];

    const boundaries = new Set<number>();
    for (const s of [...TRADING_SESSIONS, SYDNEY_WINDOW, TOKYO_WINDOW]) {
      boundaries.add(s.startHour);
      boundaries.add(s.endHour);
    }
    expect([...boundaries].sort((a, b) => a - b)).toEqual([6, 7, 8, 12, 16, 21, 23]);
    for (const b of boundaries) expect(BACKEND_BOUNDARIES).toContain(b);
  });

  it("formats its window for display", () => {
    expect(formatSessionWindow(TRADING_SESSIONS[0])).toBe("21:00-08:00 UTC");
    expect(formatSessionWindow(TRADING_SESSIONS[1])).toBe("07:00-16:00 UTC");
    expect(formatSessionWindow(TRADING_SESSIONS[2])).toBe("12:00-21:00 UTC");
  });
});

describe("msOfUtcDay", () => {
  it("measures from 00:00 UTC regardless of the host timezone", () => {
    expect(msOfUtcDay(utc(0))).toBe(0);
    expect(msOfUtcDay(utc(13, 30))).toBe(13 * HOUR + 30 * MINUTE);
    expect(msOfUtcDay(utc(23, 59, 59))).toBe(24 * HOUR - 1000);
  });
});

describe("who is open, hour by hour", () => {
  // Hand-derived from Asian 00-08, London 08-16, New York 13-21.
  const expected: Array<[number, string[]]> = [
    [0, ["asia_pacific"]],
    [5, ["asia_pacific"]],
    [6, ["asia_pacific"]],
    // 07:00 is the new Asia/London overlap - the block runs an hour past
    // London's open on this schedule.
    [7, ["asia_pacific", "london"]],
    [8, ["london"]],
    [11, ["london"]],
    [12, ["london", "new_york"]],
    [15, ["london", "new_york"]],
    [16, ["new_york"]],
    [20, ["new_york"]],
    [21, ["asia_pacific"]],
    [23, ["asia_pacific"]],
  ];

  it.each(expected)("at %i:00 UTC exactly %j are open", (hour, ids) => {
    expect(activeIds(utc(hour))).toEqual(ids);
  });

  it("covers every hour of the day - this schedule leaves no dead time", () => {
    // Sydney opens at 21:00, an hour before New York shuts, so unlike the
    // previous windows there is no stretch with nothing open.
    for (let hour = 0; hour < 24; hour++) {
      expect(activeIds(utc(hour)).length).toBeGreaterThan(0);
    }
  });
});

describe("Asia-Pacific: the window that runs through midnight UTC", () => {
  // Fixed UTC hours from the published table - no DST resolution anywhere here.
  // Sydney 21:00-06:00, Tokyo 23:00-08:00, block = their union 21:00-08:00.
  it("is declared as a wrapping window; London and New York are not", () => {
    expect(wrapsMidnight(ASIA_PACIFIC)).toBe(true);
    expect(wrapsMidnight(SYDNEY_WINDOW)).toBe(true);
    expect(wrapsMidnight(TOKYO_WINDOW)).toBe(true);
    expect(wrapsMidnight(TRADING_SESSIONS[1])).toBe(false);
    expect(wrapsMidnight(TRADING_SESSIONS[2])).toBe(false);
  });

  it("spans exactly the union of Sydney and Tokyo", () => {
    expect(ASIA_PACIFIC.startHour).toBe(SYDNEY_WINDOW.startHour);
    expect(ASIA_PACIFIC.endHour).toBe(TOKYO_WINDOW.endHour);
    // Every hour either leg is on, the block is on - and never otherwise.
    for (let minute = 0; minute < 24 * 60; minute++) {
      const now = utc(0, minute);
      const leg = isSydneyActive(now) || isTokyoActive(now);
      expect(activeIds(now).includes("asia_pacific")).toBe(leg);
    }
  });

  it("runs Sydney-only, then both, then Tokyo-only", () => {
    // 21:00-23:00 Sydney alone
    expect([isSydneyActive(utc(21)), isTokyoActive(utc(21))]).toEqual([true, false]);
    expect([isSydneyActive(utc(22, 59)), isTokyoActive(utc(22, 59))]).toEqual([true, false]);
    // 23:00-06:00 both
    expect([isSydneyActive(utc(23)), isTokyoActive(utc(23))]).toEqual([true, true]);
    expect([isSydneyActive(utc(3)), isTokyoActive(utc(3))]).toEqual([true, true]);
    expect([isSydneyActive(utc(5, 59)), isTokyoActive(utc(5, 59))]).toEqual([true, true]);
    // 06:00-08:00 Tokyo alone
    expect([isSydneyActive(utc(6)), isTokyoActive(utc(6))]).toEqual([false, true]);
    expect([isSydneyActive(utc(7, 59)), isTokyoActive(utc(7, 59))]).toEqual([false, true]);
    // 08:00 both shut
    expect([isSydneyActive(utc(8)), isTokyoActive(utc(8))]).toEqual([false, false]);
  });

  it("opens exactly at 21:00, not 20:59", () => {
    expect(activeIds(utc(20, 59, 59))).toEqual(["new_york"]);
    expect(activeIds(utc(21, 0, 0))).toEqual(["asia_pacific"]);
  });

  it("stays on continuously across 00:00 UTC", () => {
    for (let m = 0; m <= 60; m++) {
      const now = new Date(Date.UTC(2026, 6, 15, 23, 30) + m * MINUTE);
      expect(activeIds(now)).toEqual(["asia_pacific"]);
      expect(isSydneyActive(now)).toBe(true);
      expect(isTokyoActive(now)).toBe(true);
    }
  });

  it("counts down across midnight without going negative or resetting", () => {
    // 23:30 -> closes 08:00 the next day = 8h30m.
    expect(stateOf(utc(23, 30), "asia_pacific").msUntilChange).toBe(8 * HOUR + 30 * MINUTE);
    expect(stateOf(utc(23, 31), "asia_pacific").msUntilChange).toBe(8 * HOUR + 29 * MINUTE);
    // past midnight, still counting to the same 08:00
    expect(stateOf(utc(0, 0), "asia_pacific").msUntilChange).toBe(8 * HOUR);
    expect(stateOf(utc(0, 30), "asia_pacific").msUntilChange).toBe(7 * HOUR + 30 * MINUTE);
  });

  it("never reports a non-positive countdown at any minute of the day", () => {
    for (let minute = 0; minute < 24 * 60; minute++) {
      for (const st of sessionStates(utc(0, minute))) {
        expect(st.msUntilChange).toBeGreaterThan(0);
      }
    }
  });

  it("overlaps London for an hour rather than handing straight over", () => {
    // 07:00-08:00 both are open on this schedule - London opens at 07:00 while
    // Tokyo runs to 08:00.
    expect(activeIds(utc(6, 59, 59))).toEqual(["asia_pacific"]);
    expect(activeIds(utc(7, 0, 0))).toEqual(["asia_pacific", "london"]);
    expect(activeIds(utc(7, 59, 59))).toEqual(["asia_pacific", "london"]);
    expect(activeIds(utc(8, 0, 0))).toEqual(["london"]);
  });

  it("obeys the weekend closure like every other window", () => {
    for (const hour of [21, 23, 2, 6]) {
      const sat = new Date(Date.UTC(2026, 6, 18, hour));
      expect(isWeekendClosure(sat)).toBe(true);
      expect(activeIds(sat)).toEqual([]);
      expect(isSydneyActive(sat)).toBe(false);
      expect(isTokyoActive(sat)).toBe(false);
    }
  });

  it("uses no timezone database for these windows - they are fixed UTC", () => {
    // Same UTC hour, six months apart, must behave identically. The previous
    // version tracked Australia/Sydney and deliberately did not.
    const jul = new Date(Date.UTC(2026, 6, 15, 22));
    const jan = new Date(Date.UTC(2026, 0, 14, 22));
    expect(activeIds(jul)).toEqual(activeIds(jan));
    expect(isSydneyActive(jul)).toBe(isSydneyActive(jan));
    expect(isTokyoActive(jul)).toBe(isTokyoActive(jan));
  });
});

describe("London / New York overlap", () => {
  it("reports both open across 12:00-16:00 UTC", () => {
    for (const hour of [12, 13, 14, 15]) {
      const ids = activeIds(utc(hour));
      expect(ids).toContain("london");
      expect(ids).toContain("new_york");
      expect(isOverlapActive(utc(hour))).toBe(true);
    }
  });

  it("starts the overlap exactly at 12:00, not 11:59", () => {
    expect(isOverlapActive(utc(11, 59, 59))).toBe(false);
    expect(activeIds(utc(11, 59, 59))).toEqual(["london"]);

    expect(isOverlapActive(utc(12, 0, 0))).toBe(true);
    expect(activeIds(utc(12, 0, 0))).toEqual(["london", "new_york"]);
  });

  it("ends the overlap exactly at 16:00, leaving New York alone", () => {
    expect(isOverlapActive(utc(15, 59, 59))).toBe(true);

    expect(isOverlapActive(utc(16, 0, 0))).toBe(false);
    expect(activeIds(utc(16, 0, 0))).toEqual(["new_york"]);
  });
});

describe("peak activity hour", () => {
  it("uses named constants covering the first hour of the overlap", () => {
    expect(PEAK_HOUR_START_UTC).toBe(12);
    expect(PEAK_HOUR_END_UTC).toBe(13);
    expect(PEAK_WINDOW.startHour).toBe(PEAK_HOUR_START_UTC);
    expect(PEAK_WINDOW.endHour).toBe(PEAK_HOUR_END_UTC);
    // It must begin exactly where the overlap begins, or "first hour" is a lie.
    expect(PEAK_HOUR_START_UTC).toBe(OVERLAP_START_HOUR);
  });

  it("is on through 12:00-13:00 UTC", () => {
    expect(isPeakActivity(utc(12, 0, 0))).toBe(true);
    expect(isPeakActivity(utc(12, 30))).toBe(true);
    expect(isPeakActivity(utc(12, 59, 59))).toBe(true);
  });

  it("starts exactly at 12:00, not 11:59", () => {
    expect(isPeakActivity(utc(11, 59, 59))).toBe(false);
    expect(isPeakActivity(utc(12, 0, 0))).toBe(true);
  });

  it("ends exactly at 13:00, while the overlap keeps running", () => {
    expect(isPeakActivity(utc(12, 59, 59))).toBe(true);

    expect(isPeakActivity(utc(13, 0, 0))).toBe(false);
    // The broader overlap note must still be showing - requirement 2.
    expect(isOverlapActive(utc(13, 0, 0))).toBe(true);
    expect(activeIds(utc(13, 0, 0))).toEqual(["london", "new_york"]);
  });

  it("stays off for the rest of the overlap", () => {
    for (const hour of [13, 14, 15]) {
      expect(isPeakActivity(utc(hour))).toBe(false);
      expect(isOverlapActive(utc(hour))).toBe(true);
    }
  });

  it("is never on outside the overlap, at any minute of a weekday", () => {
    // The invariant that matters: peak implies overlap, always.
    for (let minute = 0; minute < 24 * 60; minute++) {
      const now = new Date(Date.UTC(2026, 6, 15, 0, minute));
      if (isPeakActivity(now)) expect(isOverlapActive(now)).toBe(true);
    }
  });

  it("is a strict subset - the overlap runs on after peak ends", () => {
    const peakMinutes = [];
    const overlapMinutes = [];
    for (let minute = 0; minute < 24 * 60; minute++) {
      const now = new Date(Date.UTC(2026, 6, 15, 0, minute));
      if (isPeakActivity(now)) peakMinutes.push(minute);
      if (isOverlapActive(now)) overlapMinutes.push(minute);
    }
    expect(peakMinutes.length).toBe(60);
    expect(overlapMinutes.length).toBe(240);
    expect(overlapMinutes).toEqual(expect.arrayContaining(peakMinutes));
  });

  it("stays off all weekend, even at 13:30 UTC", () => {
    // Saturday and Sunday both pass through the peak hour; the closure wins.
    for (const day of [18, 19]) {
      const now = new Date(Date.UTC(2026, 6, day, 13, 30));
      expect(isWeekendClosure(now)).toBe(true);
      expect(isPeakActivity(now)).toBe(false);
      expect(isOverlapActive(now)).toBe(false);
    }
  });

  it("converts to the reader's clock like everything else", () => {
    const ref = new Date("2026-07-15T13:30:00Z");
    expect(formatLocalWindow(localSessionWindow(PEAK_WINDOW, ref, "Africa/Nairobi"))).toBe(
      "15:00-16:00",
    );
    expect(formatLocalWindow(localSessionWindow(PEAK_WINDOW, ref, "America/Los_Angeles"))).toBe(
      "05:00-06:00",
    );
    expect(formatLocalWindow(localSessionWindow(PEAK_WINDOW, ref, "Asia/Kolkata"))).toBe(
      "17:30-18:30",
    );
    expect(formatLocalWindow(localSessionWindow(PEAK_WINDOW, ref, "UTC"))).toBe("12:00-13:00");
  });

  it("marks the peak hour crossing local midnight", () => {
    const ref = new Date("2026-07-15T13:30:00Z");
    // UTC+11: 13:00 UTC is 00:00 next day, so start and end share that day...
    expect(formatLocalWindow(localSessionWindow(PEAK_WINDOW, ref, "Pacific/Noumea"))).toBe(
      "23:00-00:00 +1",
    );
    // ...whereas UTC+10 splits it, 23:00 to 00:00 the next day.
    expect(formatLocalWindow(localSessionWindow(PEAK_WINDOW, ref, "Australia/Brisbane"))).toBe(
      "22:00-23:00",
    );
  });

  it("stays out of the session list, like the overlap window", () => {
    expect(TRADING_SESSIONS).not.toContain(PEAK_WINDOW);
    expect(TRADING_SESSIONS.map((s) => s.id)).toEqual(["asia_pacific", "london", "new_york"]);
  });
});

describe("boundaries are half-open [start, end)", () => {
  it("closes Asia-Pacific exactly at 08:00, leaving London alone", () => {
    expect(activeIds(utc(7, 59, 59))).toEqual(["asia_pacific", "london"]);
    expect(activeIds(utc(8, 0, 0))).toEqual(["london"]);
  });

  it("stays open straight through midnight rather than closing at it", () => {
    // The whole point of the wrapping window: 00:00 is not a boundary here.
    expect(activeIds(utc(23, 59, 59))).toEqual(["asia_pacific"]);
    expect(activeIds(utc(0, 0, 0))).toEqual(["asia_pacific"]);
  });

  it("hands New York over to Asia-Pacific at 21:00", () => {
    expect(activeIds(utc(20, 59, 59))).toEqual(["new_york"]);
    expect(activeIds(utc(21, 0, 0))).toEqual(["asia_pacific"]);
  });

  it("flips state on the exact minute when stepped across a boundary", () => {
    // Walk 15:55 -> 16:05 a minute at a time; London must go dark at 16:00.
    const flips: number[] = [];
    let previous = stateOf(utc(15, 55), "london").active;

    for (let minute = 56; minute <= 65; minute++) {
      const now = new Date(Date.UTC(2026, 6, 15, 15, minute));
      const active = stateOf(now, "london").active;
      if (active !== previous) flips.push(now.getUTCHours() * 60 + now.getUTCMinutes());
      previous = active;
    }

    expect(flips).toEqual([16 * 60]); // exactly one flip, at 16:00
  });
});

describe("countdown to the next change", () => {
  it("counts down to close while open", () => {
    // 09:00, London closes 16:00 -> 7h.
    expect(stateOf(utc(9), "london").msUntilChange).toBe(7 * HOUR);
    // 13:30, New York closes 21:00 -> 7h30m.
    expect(stateOf(utc(13, 30), "new_york").msUntilChange).toBe(7 * HOUR + 30 * MINUTE);
    // 00:00, Asia-Pacific closes 08:00 -> 8h.
    expect(stateOf(utc(0), "asia_pacific").msUntilChange).toBe(8 * HOUR);
  });

  it("counts down to today's open when it hasn't happened yet", () => {
    // 03:00, London opens 07:00 -> 4h.
    expect(stateOf(utc(3), "london").msUntilChange).toBe(4 * HOUR);
    // 08:00, New York opens 12:00 -> 4h.
    expect(stateOf(utc(8), "new_york").msUntilChange).toBe(4 * HOUR);
  });

  it("rolls to tomorrow's open once today's session has closed", () => {
    // 21:00: Asia-Pacific has just opened and runs to 08:00 -> 11h to close.
    expect(stateOf(utc(21), "asia_pacific").msUntilChange).toBe(11 * HOUR);
    // London next opens 07:00 tomorrow -> 10h; New York 12:00 tomorrow -> 15h.
    expect(stateOf(utc(21), "london").msUntilChange).toBe(10 * HOUR);
    expect(stateOf(utc(21), "new_york").msUntilChange).toBe(15 * HOUR);
  });

  it("rolls Asia-Pacific over even at 08:00, the moment it closes", () => {
    // Not 0 and not negative: the next Sydney open is 13h away.
    expect(stateOf(utc(8), "asia_pacific").msUntilChange).toBe(13 * HOUR);
  });

  it("never returns a negative or zero countdown, at any minute of the day", () => {
    for (let minute = 0; minute < 24 * 60; minute++) {
      const now = new Date(Date.UTC(2026, 6, 15, 0, minute));
      for (const state of sessionStates(now)) {
        expect(state.msUntilChange).toBeGreaterThan(0);
      }
    }
  });
});

describe("weekend closure", () => {
  // Verified against Intl: 17:00 New York is 21:00 UTC under EDT and 22:00 UTC
  // under EST, so both halves of the year are pinned separately below.
  const FRI_JUL = "2026-07-17"; // Friday
  const SAT_JUL = "2026-07-18";
  const SUN_JUL = "2026-07-19";

  it("stays open right up to the Friday close", () => {
    const justBefore = new Date(`${FRI_JUL}T20:59:59Z`);
    expect(isWeekendClosure(justBefore)).toBe(false);
    // New York is still running its 13:00-21:00 window.
    expect(activeIds(justBefore)).toEqual(["new_york"]);
    expect(msUntilMarketOpen(justBefore)).toBe(0);
  });

  it("shuts everything the moment Friday 17:00 New York arrives", () => {
    const justAfter = new Date(`${FRI_JUL}T21:00:00Z`);
    expect(isWeekendClosure(justAfter)).toBe(true);
    expect(activeIds(justAfter)).toEqual([]);
    // Friday close to Sunday open is a flat 48h when no DST change intervenes.
    expect(msUntilMarketOpen(justAfter)).toBe(48 * HOUR);
  });

  it("reports every session closed on a Saturday, whatever the UTC hour", () => {
    // The reported bug: 14:00 UTC on a Saturday sits inside both the London and
    // New York windows, so hour-of-day alone showed them open.
    const saturday = new Date(`${SAT_JUL}T14:00:00Z`);
    expect(isWeekendClosure(saturday)).toBe(true);
    expect(activeIds(saturday)).toEqual([]);
    expect(isOverlapActive(saturday)).toBe(false);
    // Sat 14:00 -> Sun 21:00 is 31h.
    expect(msUntilMarketOpen(saturday)).toBe(31 * HOUR);
  });

  it("keeps every session closed across all 24 hours of Saturday", () => {
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(Date.UTC(2026, 6, 18, hour));
      expect(activeIds(now)).toEqual([]);
      expect(isOverlapActive(now)).toBe(false);
    }
  });

  it("points every card at the weekly reopen, not its own next hour boundary", () => {
    const saturday = new Date(`${SAT_JUL}T14:00:00Z`);
    const states = sessionStates(saturday);

    expect(states.map((s) => s.weekendClosed)).toEqual([true, true, true]);
    // All three share one countdown - the market open - rather than 10h/18h/23h.
    expect(new Set(states.map((s) => s.msUntilChange)).size).toBe(1);
    expect(states[0].msUntilChange).toBe(31 * HOUR);
  });

  it("stays shut until the last second before Sunday's open", () => {
    const justBefore = new Date(`${SUN_JUL}T20:59:59Z`);
    expect(isWeekendClosure(justBefore)).toBe(true);
    expect(activeIds(justBefore)).toEqual([]);
    expect(msUntilMarketOpen(justBefore)).toBe(1000);
  });

  it("reopens exactly at Sunday 17:00 New York", () => {
    const justAfter = new Date(`${SUN_JUL}T21:00:00Z`);
    expect(isWeekendClosure(justAfter)).toBe(false);
    expect(msUntilMarketOpen(justAfter)).toBe(0);

    // On this schedule Sydney opens at 21:00 UTC, exactly when the week does, so
    // the market reopens straight into the Asia-Pacific block rather than into a
    // dead hour. Countdowns are hour-boundary ones again, not the weekend one.
    const states = sessionStates(justAfter);
    expect(states.every((s) => !s.weekendClosed)).toBe(true);
    expect(activeIds(justAfter)).toEqual(["asia_pacific"]);
    expect(stateOf(justAfter, "asia_pacific").msUntilChange).toBe(11 * HOUR); // to 08:00
  });

  it("follows New York rather than a fixed UTC hour, under EST", () => {
    // January: 17:00 New York is 22:00 UTC, so 21:00 UTC Friday is still open.
    expect(isWeekendClosure(new Date("2026-01-16T21:00:00Z"))).toBe(false);
    expect(isWeekendClosure(new Date("2026-01-16T22:00:00Z"))).toBe(true);
    expect(isWeekendClosure(new Date("2026-01-18T21:59:59Z"))).toBe(true);
    expect(isWeekendClosure(new Date("2026-01-18T22:00:00Z"))).toBe(false);
  });

  it("handles the spring-forward weekend, when the clocks move mid-closure", () => {
    // US DST starts 02:00 local on Sun 8 Mar 2026, inside the closure window, so
    // the market shuts at 22:00 UTC (EST) and reopens at 21:00 UTC (EDT) - 47h,
    // not 48. This is what the two-pass offset resolution is for.
    expect(isWeekendClosure(new Date("2026-03-06T21:59:59Z"))).toBe(false);

    const close = new Date("2026-03-06T22:00:00Z");
    expect(isWeekendClosure(close)).toBe(true);
    expect(msUntilMarketOpen(close)).toBe(47 * HOUR);

    expect(isWeekendClosure(new Date("2026-03-08T20:59:59Z"))).toBe(true);
    expect(isWeekendClosure(new Date("2026-03-08T21:00:00Z"))).toBe(false);
  });

  it("handles the fall-back weekend too", () => {
    // DST ends 02:00 local on Sun 1 Nov 2026: shut 21:00 UTC (EDT), reopen
    // 22:00 UTC (EST) - 49h.
    const close = new Date("2026-10-30T21:00:00Z"); // Friday
    expect(isWeekendClosure(close)).toBe(true);
    expect(msUntilMarketOpen(close)).toBe(49 * HOUR);

    expect(isWeekendClosure(new Date("2026-11-01T21:59:59Z"))).toBe(true);
    expect(isWeekendClosure(new Date("2026-11-01T22:00:00Z"))).toBe(false);
  });

  it("leaves ordinary weekdays completely untouched", () => {
    // Mon-Thu, every hour: the weekend rule must never fire.
    for (let day = 13; day <= 16; day++) {
      for (let hour = 0; hour < 24; hour++) {
        expect(isWeekendClosure(new Date(Date.UTC(2026, 6, day, hour)))).toBe(false);
      }
    }
  });
});

describe("local-time display", () => {
  // Values below were computed against Intl before being written down, not
  // guessed. Reference day is Wed 15 July 2026 unless stated.
  const REF = new Date("2026-07-15T12:00:00Z");

  const window = (id: string, zone: string, reference = REF) => {
    const session = TRADING_SESSIONS.find((s) => s.id === id)!;
    return formatLocalWindow(localSessionWindow(session, reference, zone));
  };

  it("shifts forward for a zone ahead of UTC (UTC+3)", () => {
    // July is AEST, so Sydney opens 23:00 UTC = 02:00 EAT.
    expect(window("asia_pacific", "Africa/Nairobi")).toBe("00:00-11:00");
    expect(window("london", "Africa/Nairobi")).toBe("10:00-19:00");
  });

  it("shifts back for a zone behind UTC (UTC-7)", () => {
    expect(window("london", "America/Los_Angeles")).toBe("00:00-09:00");
    expect(window("new_york", "America/Los_Angeles")).toBe("05:00-14:00");
  });

  it("handles a half-hour offset", () => {
    expect(window("asia_pacific", "Asia/Kolkata")).toBe("02:30-13:30");
    expect(window("london", "Asia/Kolkata")).toBe("12:30-21:30");
  });

  describe("windows that cross local midnight", () => {
    it("marks a session running into the next local day, going forwards", () => {
      // UTC+14: London 08:00-16:00 UTC lands on 22:00-06:00 the next day.
      expect(window("london", "Pacific/Kiritimati")).toBe("21:00-06:00 +1");
    });

    it("marks it going backwards too", () => {
      // UTC-7: the block opens 21:00 UTC, i.e. 14:00 the previous local afternoon.
      expect(window("asia_pacific", "America/Los_Angeles")).toBe("14:00-01:00 +1");
    });

    it("treats an end landing exactly on local midnight as a crossing", () => {
      // UTC+3: New York closes 21:00 UTC = 00:00 local, i.e. the next day.
      expect(window("new_york", "Africa/Nairobi")).toBe("15:00-00:00 +1");
    });

    it("leaves same-day windows unmarked", () => {
      // Asia-Pacific is excluded on purpose: in UTC it *is* a midnight crossing.
      for (const id of ["london", "new_york"]) {
        expect(window(id, "UTC")).not.toContain("+");
      }
      expect(window("asia_pacific", "UTC")).toBe("21:00-08:00 +1");
      // ...but at UTC+14 the whole block lands inside one local day.
      expect(window("asia_pacific", "Pacific/Kiritimati")).toBe("11:00-22:00");
    });
  });

  it("uses the reference date, so a DST-observing zone reads correctly year-round", () => {
    const january = new Date("2026-01-14T12:00:00Z");
    // London is UTC+1 in July, UTC+0 in January.
    expect(window("london", "Europe/London")).toBe("08:00-17:00");
    expect(window("london", "Europe/London", january)).toBe("07:00-16:00");
    // Los Angeles: PDT then PST.
    expect(window("new_york", "America/Los_Angeles")).toBe("05:00-14:00");
    expect(window("new_york", "America/Los_Angeles", january)).toBe("04:00-13:00");
  });

  describe("the overlap note converts like the cards", () => {
    it("renders the overlap on the reader's clock", () => {
      // UTC+3: 13:00-16:00 UTC is 16:00-19:00 - i.e. 4pm-7pm EAT.
      expect(formatLocalWindow(localSessionWindow(OVERLAP_WINDOW, REF, "Africa/Nairobi"))).toBe(
        "15:00-19:00",
      );
      expect(formatLocalWindow(localSessionWindow(OVERLAP_WINDOW, REF, "America/Los_Angeles"))).toBe(
        "05:00-09:00",
      );
      expect(formatLocalWindow(localSessionWindow(OVERLAP_WINDOW, REF, "UTC"))).toBe("12:00-16:00");
    });

    it("marks the overlap crossing local midnight too", () => {
      // Only a narrow band of offsets splits a 3h window across local midnight:
      // UTC+9 and UTC+10 do, their neighbours don't.
      expect(formatLocalWindow(localSessionWindow(OVERLAP_WINDOW, REF, "Asia/Tokyo"))).toBe(
        "21:00-01:00 +1",
      );
      expect(formatLocalWindow(localSessionWindow(OVERLAP_WINDOW, REF, "Australia/Brisbane"))).toBe(
        "22:00-02:00 +1",
      );
      // UTC+14 lands the whole window on the next local day - shifted, but not split.
      expect(formatLocalWindow(localSessionWindow(OVERLAP_WINDOW, REF, "Pacific/Kiritimati"))).toBe(
        "02:00-06:00",
      );
      // UTC-11 keeps it wholly within the same local day.
      expect(formatLocalWindow(localSessionWindow(OVERLAP_WINDOW, REF, "Pacific/Niue"))).toBe(
        "01:00-05:00",
      );
    });

    it("stays out of the session list, so it can't become a fourth card", () => {
      expect(TRADING_SESSIONS.map((s) => s.id)).toEqual(["asia_pacific", "london", "new_york"]);
      expect(TRADING_SESSIONS).not.toContain(OVERLAP_WINDOW);
    });

    it("matches the London and New York windows it is derived from", () => {
      const london = TRADING_SESSIONS.find((s) => s.id === "london")!;
      const newYork = TRADING_SESSIONS.find((s) => s.id === "new_york")!;
      // The overlap is exactly where the two windows intersect.
      expect(OVERLAP_WINDOW.startHour).toBe(newYork.startHour);
      expect(OVERLAP_WINDOW.endHour).toBe(london.endHour);
    });
  });

  it("labels the zone so local times can't be mistaken for UTC", () => {
    expect(localZoneLabel(REF, "Africa/Nairobi")).toBe("GMT+3");
    expect(localZoneLabel(REF, "America/Los_Angeles")).toBe("PDT");
    expect(localZoneLabel(new Date("2026-01-14T12:00:00Z"), "America/Los_Angeles")).toBe("PST");
    expect(localZoneLabel(REF, "UTC")).toBe("UTC");
  });

  it("resolves the browser zone when none is passed, without hardcoding one", () => {
    expect(resolvedTimeZone("Africa/Nairobi")).toBe("Africa/Nairobi");
    expect(resolvedTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  describe("the weekend reopen label", () => {
    // The market reopens Sun 19 July 2026 at 21:00 UTC.
    const reopen = new Date("2026-07-19T21:00:00Z");

    it.each([
      ["Africa/Nairobi", "Monday 00:00"],
      ["America/Los_Angeles", "Sunday 14:00"],
      ["Pacific/Kiritimati", "Monday 11:00"],
      ["Asia/Kolkata", "Monday 02:30"],
      ["UTC", "Sunday 21:00"],
    ])("reads correctly in %s", (zone, expected) => {
      expect(formatLocalDayTime(reopen, zone)).toBe(expected);
    });

    it("carries the weekday across, so a reopen can land on Monday locally", () => {
      // Worth stating outright: east of UTC+3 the "Sunday" open is Monday for
      // the reader, and printing "Sunday" would be simply wrong for them.
      expect(formatLocalDayTime(reopen, "Africa/Nairobi")).toMatch(/^Monday/);
      expect(formatLocalDayTime(reopen, "America/Los_Angeles")).toMatch(/^Sunday/);
    });
  });

  describe("display never feeds back into the logic", () => {
    const zones = ["UTC", "Africa/Nairobi", "America/Los_Angeles", "Pacific/Kiritimati"];

    it("keeps open/closed identical whatever zone is rendered", () => {
      // Sat 14:00 UTC is Sunday 04:00 in Kiritimati and Saturday 07:00 in LA -
      // the market is shut for all of them, because the rule is not local.
      const saturday = new Date("2026-07-18T14:00:00Z");
      for (const zone of zones) {
        // The window still renders...
        expect(window("london", zone, saturday)).toMatch(/^\d{2}:\d{2}-\d{2}:\d{2}/);
        // ...while the verdict stays put.
        expect(isWeekendClosure(saturday)).toBe(true);
        expect(activeIds(saturday)).toEqual([]);
      }
    });

    it("keeps the mid-week active set identical whatever zone is rendered", () => {
      const overlapTime = new Date("2026-07-15T14:00:00Z");
      for (const zone of zones) {
        expect(window("new_york", zone, overlapTime)).toBeTruthy();
        expect(activeIds(overlapTime)).toEqual(["london", "new_york"]);
        expect(isOverlapActive(overlapTime)).toBe(true);
      }
    });
  });
});

describe("formatCountdown", () => {
  it.each([
    [8 * HOUR, "8h 0m"],
    [7 * HOUR + 30 * MINUTE, "7h 30m"],
    [90 * MINUTE, "1h 30m"],
    [45 * MINUTE, "45m"],
    [MINUTE, "1m"],
    [59 * 1000, "<1m"],
    [0, "<1m"],
  ])("renders %i ms as %s", (ms, label) => {
    expect(formatCountdown(ms)).toBe(label);
  });

  it("rounds down so it never overstates the time left", () => {
    expect(formatCountdown(2 * HOUR - 1)).toBe("1h 59m");
  });
});
