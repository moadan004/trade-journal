import { describe, expect, it } from "vitest";

import {
  formatCountdown,
  formatSessionWindow,
  isOverlapActive,
  msOfUtcDay,
  sessionStates,
  TRADING_SESSIONS,
} from "@/lib/sessions";

/** A fixed UTC instant. The calendar date is arbitrary - only the UTC clock matters. */
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
  it("uses the boundary set the backend buckets are derived from", () => {
    // app/services/risk.py partitions the day at 0 / 8 / 13 / 16 / 21. The
    // overlapping windows here must induce exactly those boundaries, or the
    // widget and the session stats would disagree about when London is on.
    const boundaries = new Set<number>();
    for (const s of TRADING_SESSIONS) {
      boundaries.add(s.startHour);
      boundaries.add(s.endHour);
    }
    expect([...boundaries].sort((a, b) => a - b)).toEqual([0, 8, 13, 16, 21]);
  });

  it("formats its window for display", () => {
    expect(formatSessionWindow(TRADING_SESSIONS[0])).toBe("00:00-08:00 UTC");
    expect(formatSessionWindow(TRADING_SESSIONS[1])).toBe("08:00-16:00 UTC");
    expect(formatSessionWindow(TRADING_SESSIONS[2])).toBe("13:00-21:00 UTC");
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
    [0, ["asian"]],
    [4, ["asian"]],
    [7, ["asian"]],
    [8, ["london"]],
    [12, ["london"]],
    [13, ["london", "new_york"]],
    [14, ["london", "new_york"]],
    [15, ["london", "new_york"]],
    [16, ["new_york"]],
    [20, ["new_york"]],
    [21, []],
    [22, []],
    [23, []],
  ];

  it.each(expected)("at %i:00 UTC exactly %j are open", (hour, ids) => {
    expect(activeIds(utc(hour))).toEqual(ids);
  });

  it("leaves 21:00-24:00 UTC with no session open", () => {
    for (let hour = 21; hour < 24; hour++) {
      expect(activeIds(utc(hour))).toEqual([]);
    }
  });
});

describe("London / New York overlap", () => {
  it("reports both open across 13:00-16:00 UTC", () => {
    for (const hour of [13, 14, 15]) {
      const ids = activeIds(utc(hour));
      expect(ids).toContain("london");
      expect(ids).toContain("new_york");
      expect(isOverlapActive(utc(hour))).toBe(true);
    }
  });

  it("starts the overlap exactly at 13:00, not 12:59", () => {
    expect(isOverlapActive(utc(12, 59, 59))).toBe(false);
    expect(activeIds(utc(12, 59, 59))).toEqual(["london"]);

    expect(isOverlapActive(utc(13, 0, 0))).toBe(true);
    expect(activeIds(utc(13, 0, 0))).toEqual(["london", "new_york"]);
  });

  it("ends the overlap exactly at 16:00, leaving New York alone", () => {
    expect(isOverlapActive(utc(15, 59, 59))).toBe(true);

    expect(isOverlapActive(utc(16, 0, 0))).toBe(false);
    expect(activeIds(utc(16, 0, 0))).toEqual(["new_york"]);
  });
});

describe("boundaries are half-open [start, end)", () => {
  it("hands over from Asian to London at 08:00 with no gap and no double-count", () => {
    expect(activeIds(utc(7, 59, 59))).toEqual(["asian"]);
    expect(activeIds(utc(8, 0, 0))).toEqual(["london"]);
  });

  it("opens Asian exactly at 00:00", () => {
    expect(activeIds(utc(23, 59, 59))).toEqual([]);
    expect(activeIds(utc(0, 0, 0))).toEqual(["asian"]);
  });

  it("closes New York exactly at 21:00", () => {
    expect(activeIds(utc(20, 59, 59))).toEqual(["new_york"]);
    expect(activeIds(utc(21, 0, 0))).toEqual([]);
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
    // 00:00, Asian closes 08:00 -> 8h.
    expect(stateOf(utc(0), "asian").msUntilChange).toBe(8 * HOUR);
  });

  it("counts down to today's open when it hasn't happened yet", () => {
    // 03:00, London opens 08:00 -> 5h.
    expect(stateOf(utc(3), "london").msUntilChange).toBe(5 * HOUR);
    // 08:00, New York opens 13:00 -> 5h.
    expect(stateOf(utc(8), "new_york").msUntilChange).toBe(5 * HOUR);
  });

  it("rolls to tomorrow's open once today's session has closed", () => {
    // 21:00. Asian next opens 00:00 tomorrow -> 3h.
    expect(stateOf(utc(21), "asian").msUntilChange).toBe(3 * HOUR);
    // ...London 08:00 tomorrow -> 11h, New York 13:00 tomorrow -> 16h.
    expect(stateOf(utc(21), "london").msUntilChange).toBe(11 * HOUR);
    expect(stateOf(utc(21), "new_york").msUntilChange).toBe(16 * HOUR);
  });

  it("rolls Asian over even at 08:00, the moment it closes", () => {
    // Not 0 and not negative: the next Asian open is 16h away.
    expect(stateOf(utc(8), "asian").msUntilChange).toBe(16 * HOUR);
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
