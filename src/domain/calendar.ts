import { Id, isGoal, isRecord, isTask, LifeMapDoc, NodeData } from "./doc";
import { dayStart, isDueOn } from "./recur";

// ---------- the calendar read model ----------
// Pure derivation over the doc: which days of a month hold something —
// records, goal target dates, task/goal stamps, and habit schedules, logs
// and misses. Items carry a kind (goal/task/habit/record) for the day
// list's filters; groupDayItems collapses a node's same-day rows to the
// most meaningful one. Like the recurrence derivations, `now` is passed
// explicitly so the rules stay pure and testable; the screen captures it
// after mount.

export type CalTone = "attention" | "primary" | "done" | "neutral" | "future";

// what kind of node produced the item; a task with a recur rule is a habit
export type CalKind = "goal" | "task" | "habit" | "record";

export interface CalItem {
  nodeId: Id;
  // stable row identity: which of the node's calendar slots produced the item
  // ("record" | "habit" | "target" | "started" | "completed" | "due"). Unlike
  // the label it never changes over time, so a day's manual order
  // (doc.dayOrder) survives reclassification
  key: string;
  kind: CalKind;
  title: string;
  // short caption for the row: "Due today" | "Missed" | "Overdue" |
  // "Due date" | "Logged" | "Scheduled" | "Target date" | "Completed" |
  // "Started" | "Record"
  label: string;
  tone: CalTone;
  // a focus segment record's measured duration — the day row shows it and
  // the day header sums it
  durationMs?: number;
}

// the day list's state partition, one chip per tone group: To do asks
// (attention/primary/future — due today, overdue, missed, target dates,
// scheduled), Done is logged/completed, Log is neutral history (records,
// started, a finished task's due date)
export type CalState = "todo" | "done" | "log";

export function itemState(item: CalItem): CalState {
  if (item.tone === "done") return "done";
  if (item.tone === "neutral") return "log";
  return "todo";
}

// most meaningful label wins when a node has several rows on one day
// (Completed/Logged > Missed/Due today/Overdue > Target/Due date > Started >
// Scheduled > Record) — a task due today that was completed today answers
// Done, not To do
const LABEL_RANK: Record<string, number> = {
  Completed: 0,
  Logged: 0,
  Missed: 1,
  "Due today": 1,
  Overdue: 1,
  "Target date": 2,
  "Due date": 2,
  Started: 3,
  Scheduled: 4,
  Record: 5,
};

// the day's rows, one per node: the best-ranked label wins, first appearance
// keeps the derivation order (tone order, or the stored day order). The
// losing slots still happened — the map holds their stamps
export function groupDayItems(items: CalItem[]): CalItem[] {
  const best = new Map<string, CalItem>();
  const order: string[] = [];
  for (const it of items) {
    const cur = best.get(it.nodeId);
    if (!cur) {
      best.set(it.nodeId, it);
      order.push(it.nodeId);
    } else if (LABEL_RANK[it.label] < LABEL_RANK[cur.label]) {
      best.set(it.nodeId, it);
    }
  }
  return order.map((id) => best.get(id)!);
}

// default row order inside a day: what asks for attention first, then
// deadlines, finished work, plain history, and the future last. A manual
// order stored on the doc (dayOrder) overrides this for the days it covers
const TONE_RANK: Record<CalTone, number> = {
  attention: 0,
  primary: 1,
  done: 2,
  neutral: 3,
  future: 4,
};

// a day's rows once a manual order exists: rows the stored order knows come
// first in that order; rows it doesn't (arrived later) follow, keeping the
// tone-sorted order. Stored keys with no item on the day drop out
function applyDayOrder(items: CalItem[], stored: string[] | undefined): CalItem[] {
  if (!stored || stored.length === 0) return items;
  const rank = new Map(stored.map((k, i) => [k, i]));
  const known = items
    .filter((it) => rank.has(it.key))
    .sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
  const fresh = items.filter((it) => !rank.has(it.key));
  return [...known, ...fresh];
}

const inMonth = (ms: number, y: number, m: number) => {
  const d = new Date(ms);
  return d.getFullYear() === y && d.getMonth() === m;
};

// a habit owns its whole month: every scheduled day (classified against
// today) and every logged day — a log on an unscheduled day (a catch-up)
// still happened, and a logged scheduled day reads as done, never missed
function habitItems(
  node: NodeData,
  y: number,
  m: number,
  today: number,
  byDay: Map<number, CalItem[]>,
) {
  const rule = node.recur;
  if (!rule) return;
  const loggedDays = new Set((node.log ?? []).map(dayStart));
  const days = new Date(y, m + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    const dayMs = new Date(y, m, day).getTime();
    const key = `${node.id}:habit`;
    let item: CalItem | null = null;
    if (loggedDays.has(dayMs)) {
      item = { nodeId: node.id, key, kind: "habit", title: node.title, label: "Logged", tone: "done" };
    } else if (isDueOn(rule, dayMs)) {
      if (dayMs < today)
        item = { nodeId: node.id, key, kind: "habit", title: node.title, label: "Missed", tone: "attention" };
      else if (dayMs === today)
        item = { nodeId: node.id, key, kind: "habit", title: node.title, label: "Due today", tone: "attention" };
      else item = { nodeId: node.id, key, kind: "habit", title: node.title, label: "Scheduled", tone: "future" };
    }
    if (item) {
      const list = byDay.get(day) ?? [];
      list.push(item);
      byDay.set(day, list);
    }
  }
}

// every item of one month, keyed by day-of-month, days with nothing absent
export function calendarMonth(
  doc: LifeMapDoc,
  year: number,
  month0: number,
  now: number,
): Map<number, CalItem[]> {
  const today = dayStart(now);
  const byDay = new Map<number, CalItem[]>();
  const push = (
    node: NodeData,
    kind: CalKind,
    ms: number | undefined,
    slot: string,
    label: string,
    tone: CalTone,
  ) => {
    if (ms === undefined || !inMonth(ms, year, month0)) return;
    const day = new Date(ms).getDate();
    const list = byDay.get(day) ?? [];
    const item: CalItem = { nodeId: node.id, key: `${node.id}:${slot}`, kind, title: node.title, label, tone };
    if (isRecord(node) && node.durationMs !== undefined) item.durationMs = node.durationMs;
    list.push(item);
    byDay.set(day, list);
  };

  for (const node of Object.values(doc.nodes)) {
    if (node.synthetic) continue; // midpoint structure, not a real child (see scheduleSheet)
    if (isRecord(node)) {
      push(node, "record", node.occurredAt, "record", "Record", "neutral");
    } else if (node.recur) {
      // a recurring task never completes: its schedule and log ARE its days
      habitItems(node, year, month0, today, byDay);
    } else if (isGoal(node)) {
      push(node, "goal", node.targetDate, "target", "Target date", "primary");
      push(node, "goal", node.startedAt, "started", "Started", "neutral");
      push(node, "goal", node.completedAt, "completed", "Completed", "done");
    } else if (isTask(node)) {
      // a one-off due date is a deadline pin: it asks for attention on the
      // day and while overdue; a finished task's due date is plain history
      if (node.dueDate !== undefined) {
        if (node.completedAt !== undefined) {
          push(node, "task", node.dueDate, "due", "Due date", "neutral");
        } else {
          const d = dayStart(node.dueDate);
          if (d < today) push(node, "task", node.dueDate, "due", "Overdue", "attention");
          else if (d === today) push(node, "task", node.dueDate, "due", "Due today", "attention");
          else push(node, "task", node.dueDate, "due", "Due date", "primary");
        }
      }
      push(node, "task", node.startedAt, "started", "Started", "neutral");
      push(node, "task", node.completedAt, "completed", "Completed", "done");
    }
  }
  for (const [day, list] of byDay) {
    list.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
    const dayMs = new Date(year, month0, day).getTime();
    byDay.set(day, applyDayOrder(list, doc.dayOrder[String(dayMs)]));
  }
  return byDay;
}
