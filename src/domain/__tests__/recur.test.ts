import { describe, expect, it } from "@jest/globals";

import { makeTask, RecurRule } from "../doc";
import {
  dayStart,
  describeRecur,
  dueState,
  isDueOn,
  nextDue,
  parseRecurLog,
  parseRecurRule,
  prevDue,
  recurStats,
  recurStatus,
} from "../recur";

// fixed local dates; 2026-09-14 is a Monday (so 19 = Sat, 20 = Sun, 21 = Mon)
const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime();

const rule = (r: Partial<RecurRule> & Pick<RecurRule, "freq">): RecurRule => ({
  interval: 1,
  anchor: at("2026-09-14"),
  ...r,
});

describe("isDueOn", () => {
  it("daily every 2 days from the anchor", () => {
    const r = rule({ freq: "daily", interval: 2 });
    expect(isDueOn(r, at("2026-09-14"))).toBe(true); // anchor
    expect(isDueOn(r, at("2026-09-16"))).toBe(true);
    expect(isDueOn(r, at("2026-09-15"))).toBe(false);
    expect(isDueOn(r, at("2026-09-13"))).toBe(false); // before the anchor
  });

  it("weekly schedules the picked weekdays", () => {
    const r = rule({ freq: "weekly", weekdays: [1, 3, 5] }); // Mon/Wed/Fri
    expect(isDueOn(r, at("2026-09-14"))).toBe(true); // Mon
    expect(isDueOn(r, at("2026-09-16"))).toBe(true); // Wed
    expect(isDueOn(r, at("2026-09-15"))).toBe(false); // Tue
    expect(isDueOn(r, at("2026-09-19"))).toBe(false); // Sat
  });

  it("weekly with an interval schedules whole weeks", () => {
    const r = rule({ freq: "weekly", interval: 2, weekdays: [1] });
    expect(isDueOn(r, at("2026-09-14"))).toBe(true); // anchor week
    expect(isDueOn(r, at("2026-09-21"))).toBe(false); // the off week
    expect(isDueOn(r, at("2026-09-28"))).toBe(true);
  });

  it("weekly without weekdays takes the anchor's weekday", () => {
    const r = rule({ freq: "weekly", anchor: at("2026-09-16") }); // a Wednesday
    expect(isDueOn(r, at("2026-09-16"))).toBe(true);
    expect(isDueOn(r, at("2026-09-23"))).toBe(true);
    expect(isDueOn(r, at("2026-09-14"))).toBe(false);
  });

  it("monthly clamps the anchor's day into short months", () => {
    const r = rule({ freq: "monthly", anchor: at("2026-01-31") });
    expect(isDueOn(r, at("2026-02-28"))).toBe(true); // clamped
    expect(isDueOn(r, at("2026-03-31"))).toBe(true);
    expect(isDueOn(r, at("2026-04-30"))).toBe(true); // clamped again
    expect(isDueOn(r, at("2026-02-27"))).toBe(false);
  });

  it("monthly respects the interval", () => {
    const r = rule({ freq: "monthly", interval: 2, anchor: at("2026-01-31") });
    expect(isDueOn(r, at("2026-02-28"))).toBe(false);
    expect(isDueOn(r, at("2026-03-31"))).toBe(true);
  });

  it("never schedules before the anchor", () => {
    const r = rule({ freq: "daily", anchor: at("2026-09-20") });
    expect(isDueOn(r, at("2026-09-18"))).toBe(false);
  });
});

describe("prevDue/nextDue", () => {
  it("finds the bracketing scheduled days", () => {
    const r = rule({ freq: "daily", interval: 2 }); // 14, 16, 18, …
    expect(prevDue(r, at("2026-09-17"))).toBe(dayStart(at("2026-09-16")));
    expect(nextDue(r, at("2026-09-16"))).toBe(dayStart(at("2026-09-18")));
  });

  it("prevDue is null while the anchor is in the future", () => {
    const r = rule({ freq: "daily", anchor: at("2026-09-20") });
    expect(prevDue(r, at("2026-09-18"))).toBeNull();
    expect(nextDue(r, at("2026-09-18"))).toBe(dayStart(at("2026-09-20")));
  });
});

describe("dueState", () => {
  const task = (log: number[]) => Object.assign(makeTask(0, 0, "T"), { recur: rule({ freq: "daily", interval: 2 }), log });

  it("is due on a scheduled day until logged", () => {
    expect(dueState(task([]), at("2026-09-16"))).toBe("due");
    expect(dueState(task([at("2026-09-16")]), at("2026-09-16"))).toBe("done-today");
  });

  it("is overdue after a missed day until a log covers it", () => {
    // scheduled 14, 16, 18; now the 19th
    expect(dueState(task([]), at("2026-09-19"))).toBe("overdue");
    expect(dueState(task([at("2026-09-16")]), at("2026-09-19"))).toBe("overdue");
    expect(dueState(task([at("2026-09-18")]), at("2026-09-19"))).toBe("scheduled");
  });

  it("a catch-up log cures the overdue", () => {
    // Saturdays only; missed Sat the 19th, logged Sun the 20th, seen Mon the 21st
    const t = Object.assign(makeTask(0, 0, "T"), {
      recur: rule({ freq: "weekly", weekdays: [6], anchor: at("2026-09-05") }),
      log: [at("2026-09-20")],
    });
    expect(dueState(t, at("2026-09-21"))).toBe("scheduled");
    expect(dueState(Object.assign(t, { log: [] }), at("2026-09-21"))).toBe("overdue");
  });
});

describe("recurStatus", () => {
  const task = (log: number[]) => Object.assign(makeTask(0, 0, "T"), { recur: rule({ freq: "daily", interval: 2 }), log });

  it("asks for attention only when due or overdue", () => {
    expect(recurStatus(task([]), at("2026-09-16"))).toBe("todo"); // due
    expect(recurStatus(task([]), at("2026-09-19"))).toBe("todo"); // overdue
    expect(recurStatus(task([at("2026-09-18")]), at("2026-09-19"))).toBe("done"); // current
    expect(recurStatus(task([at("2026-09-16")]), at("2026-09-16"))).toBe("done"); // done today
  });
});

describe("recurStats", () => {
  const r = rule({ freq: "daily" });

  it("counts consecutive scheduled days, today still open", () => {
    const log = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"].map(at);
    expect(recurStats(r, log, at("2026-09-19"))).toEqual({ total: 5, streak: 5 });
    expect(recurStats(r, [...log, at("2026-09-19")], at("2026-09-19"))).toEqual({ total: 6, streak: 6 });
  });

  it("the first missed scheduled day breaks the streak", () => {
    const log = ["2026-09-14", "2026-09-15", "2026-09-17", "2026-09-18"].map(at);
    expect(recurStats(r, log, at("2026-09-19")).streak).toBe(2);
  });

  it("duplicate logs on one day count once toward the streak", () => {
    const log = [at("2026-09-18"), at("2026-09-18")];
    expect(recurStats(r, log, at("2026-09-19"))).toEqual({ total: 2, streak: 1 });
  });

  it("no logs means no streak", () => {
    expect(recurStats(r, [], at("2026-09-19"))).toEqual({ total: 0, streak: 0 });
  });

  it("weekly streaks count scheduled weeks' days", () => {
    const sat = rule({ freq: "weekly", weekdays: [6], anchor: at("2026-09-05") });
    const log = ["2026-09-05", "2026-09-12", "2026-09-19"].map(at);
    expect(recurStats(sat, log, at("2026-09-20")).streak).toBe(3);
  });
});

describe("describeRecur", () => {
  it("renders the rule in one line", () => {
    expect(describeRecur(rule({ freq: "daily" }))).toBe("Every day");
    expect(describeRecur(rule({ freq: "daily", interval: 3 }))).toBe("Every 3 days");
    expect(describeRecur(rule({ freq: "weekly", weekdays: [1, 3, 5] }))).toBe("Every week on Mon, Wed, Fri");
    expect(describeRecur(rule({ freq: "weekly", interval: 2 }))).toBe("Every 2 weeks on Mon");
    expect(describeRecur(rule({ freq: "monthly", anchor: at("2026-01-31") }))).toBe("Every month on the 31st");
    expect(describeRecur(rule({ freq: "monthly", interval: 2, anchor: at("2026-01-03") }))).toBe(
      "Every 2 months on the 3rd",
    );
  });
});

describe("blob parsing", () => {
  it("round-trips a valid rule", () => {
    const r = rule({ freq: "weekly", interval: 2, weekdays: [1, 5] });
    expect(parseRecurRule(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("drops what it cannot recognize", () => {
    expect(parseRecurRule(null)).toBeUndefined();
    expect(parseRecurRule({ freq: "hourly", interval: 1, anchor: 1 })).toBeUndefined();
    expect(parseRecurRule({ freq: "daily", interval: "2", anchor: 1 })).toBeUndefined();
    expect(parseRecurRule({ freq: "daily", anchor: 1 })).toBeUndefined();
  });

  it("normalizes interval and weekdays", () => {
    const parsed = parseRecurRule({ freq: "weekly", interval: 1.6, anchor: 5, weekdays: [1, 9, "x", 3] });
    expect(parsed).toEqual({ freq: "weekly", interval: 2, anchor: 5, weekdays: [1, 3] });
    // an all-invalid weekday list drops the key entirely
    expect(parseRecurRule({ freq: "weekly", interval: 1, anchor: 5, weekdays: [9] })).toEqual({
      freq: "weekly",
      interval: 1,
      anchor: 5,
    });
  });

  it("parses logs as number arrays", () => {
    expect(parseRecurLog([1, "x", 2])).toEqual([1, 2]);
    expect(parseRecurLog([])).toBeUndefined();
    expect(parseRecurLog("nope")).toBeUndefined();
  });
});
