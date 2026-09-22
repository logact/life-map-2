import { NodeData, RecurRule, Status } from "./doc";

// ---------- recurrence as pure derivation ----------
// A recurring task is never permanently done: it carries a rule (when the
// habit is scheduled) and a log (when it was actually done), and everything
// the UI shows — due today, overdue, streak — is derived from those two.
// Every function takes `now` explicitly so the rules stay pure and testable;
// render code receives `now` from the screen (Date.now() is impure in
// render — see mapInfoCard).

// local midnight of the day containing ms
export function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// whole calendar days from a's day to b's day (DST-safe: the comparison
// happens on year/month/day triples, not on the ms span)
function daysBetween(a: number, b: number): number {
  const da = new Date(a);
  const db = new Date(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}

function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

// the Sunday starting the week containing ms (the app's calendars start on
// Sunday — see datePicker's DOW row)
function weekStart(ms: number): number {
  const d = new Date(ms);
  return addDays(dayStart(ms), -d.getDay());
}

function weeksBetween(a: number, b: number): number {
  return Math.round(daysBetween(weekStart(a), weekStart(b)) / 7);
}

function monthsBetween(a: number, b: number): number {
  const da = new Date(a);
  const db = new Date(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

// the weekdays a weekly rule schedules on; omitted means the anchor's weekday
function scheduledWeekdays(rule: RecurRule): number[] {
  if (rule.weekdays && rule.weekdays.length > 0) return rule.weekdays;
  return [new Date(rule.anchor).getDay()];
}

// is `dayMs` a scheduled day under the rule?
export function isDueOn(rule: RecurRule, dayMs: number): boolean {
  if (dayStart(dayMs) < dayStart(rule.anchor)) return false;
  if (rule.freq === "daily") {
    return daysBetween(rule.anchor, dayMs) % rule.interval === 0;
  }
  if (rule.freq === "weekly") {
    if (!scheduledWeekdays(rule).includes(new Date(dayMs).getDay())) return false;
    return weeksBetween(rule.anchor, dayMs) % rule.interval === 0;
  }
  // monthly: the anchor's day-of-month, clamped into short months (an anchor
  // on the 31st schedules on Feb 28/29)
  if (monthsBetween(rule.anchor, dayMs) % rule.interval !== 0) return false;
  const d = new Date(dayMs);
  const dom = Math.min(
    new Date(rule.anchor).getDate(),
    daysInMonth(d.getFullYear(), d.getMonth()),
  );
  return d.getDate() === dom;
}

// the most recent scheduled day at or before now; null when the anchor is
// still in the future. The scan is bounded by the rule's own gap
export function prevDue(rule: RecurRule, now: number): number | null {
  for (let d = dayStart(now); d >= dayStart(rule.anchor); d = addDays(d, -1)) {
    if (isDueOn(rule, d)) return d;
  }
  return null;
}

// the first scheduled day strictly after now (for the "next" line when the
// current period is handled)
export function nextDue(rule: RecurRule, now: number): number {
  let d = addDays(dayStart(now), 1);
  while (!isDueOn(rule, d)) d = addDays(d, 1);
  return d;
}

export type DueState = "done-today" | "due" | "overdue" | "scheduled";

// what the habit asks of you right now. A log on a scheduled day covers it;
// a catch-up log AFTER a missed day also cures the overdue (streaks still
// record the miss — forgiving to use, honest in the count)
export function dueState(task: NodeData, now: number): DueState {
  const rule = task.recur;
  if (!rule) return "scheduled";
  const log = task.log ?? [];
  const today = dayStart(now);
  if (log.some((t) => dayStart(t) === today)) return "done-today";
  if (isDueOn(rule, now)) return "due";
  const prev = prevDue(rule, now);
  if (prev !== null) {
    const last = log.length > 0 ? log[log.length - 1] : undefined;
    if (last === undefined || dayStart(last) < prev) return "overdue";
  }
  return "scheduled";
}

// the status a recurring task shows in rollups (edges, the node outline):
// attention semantics — something is asked of you only on the due day and
// while overdue; a current habit reads as done so it never blocks a road
export function recurStatus(task: NodeData, now: number): Status {
  const s = dueState(task, now);
  return s === "due" || s === "overdue" ? "todo" : "done";
}

export function recurStats(rule: RecurRule, log: number[], now: number): { total: number; streak: number } {
  if (log.length === 0) return { total: 0, streak: 0 };
  const logged = new Set(log.map(dayStart));
  const today = dayStart(now);
  const earliest = dayStart(log[0]);
  let streak = 0;
  // walk scheduled days down from today: today-unlogged is still open and
  // doesn't break the run; the first missed scheduled day ends it; going
  // below the earliest log means every earlier day is a miss
  for (let d = today; d >= earliest; d = addDays(d, -1)) {
    if (!isDueOn(rule, d)) continue;
    if (d === today && !logged.has(d)) continue;
    if (logged.has(d)) streak++;
    else break;
  }
  return { total: log.length, streak };
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------- blob parsing: loose validation for JSON sources ----------
// (the SQLite data blob, clipboard payloads). Anything unrecognizable is
// dropped rather than trusted

export function parseRecurRule(value: unknown): RecurRule | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (r.freq !== "daily" && r.freq !== "weekly" && r.freq !== "monthly") return undefined;
  if (typeof r.interval !== "number" || typeof r.anchor !== "number") return undefined;
  const rule: RecurRule = {
    freq: r.freq,
    interval: Math.max(1, Math.round(r.interval)),
    anchor: r.anchor,
  };
  if (Array.isArray(r.weekdays)) {
    const days = r.weekdays.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6);
    if (days.length > 0) rule.weekdays = days;
  }
  return rule;
}

export function parseRecurLog(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const log = value.filter((t): t is number => typeof t === "number");
  return log.length > 0 ? log : undefined;
}

function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// one-line human rule for the info card and the editor sheet:
// "Every day", "Every 2 days", "Every week on Mon, Fri", "Every month on the 15th"
export function describeRecur(rule: RecurRule): string {
  const every = rule.interval === 1 ? "Every" : `Every ${rule.interval}`;
  if (rule.freq === "daily") return rule.interval === 1 ? "Every day" : `${every} days`;
  if (rule.freq === "weekly") {
    const unit = rule.interval === 1 ? "week" : "weeks";
    const days = [...scheduledWeekdays(rule)]
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_NAMES[d])
      .join(", ");
    return `${every} ${unit} on ${days}`;
  }
  const unit = rule.interval === 1 ? "month" : "months";
  return `${every} ${unit} on the ${ordinal(new Date(rule.anchor).getDate())}`;
}
