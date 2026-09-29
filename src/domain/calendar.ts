import { Id, isGoal, isRecord, isTask, LifeMapDoc, NodeData } from "./doc";
import { dayStart, isDueOn } from "./recur";

// ---------- the calendar read model ----------
// Pure derivation over the doc: which days of a month hold something —
// records, goal target dates, task/goal stamps, and habit schedules, logs
// and misses. Like the recurrence derivations, `now` is passed explicitly
// so the rules stay pure and testable; the screen captures it after mount.

export type CalTone = "attention" | "primary" | "done" | "neutral" | "future";

export interface CalItem {
  nodeId: Id;
  // stable row identity: which of the node's calendar slots produced the item
  // ("record" | "habit" | "target" | "started" | "completed" | "due"). Unlike
  // the label it never changes over time, so a day's manual order
  // (doc.dayOrder) survives reclassification
  key: string;
  title: string;
  // short caption for the row: "Due today" | "Missed" | "Overdue" |
  // "Due date" | "Logged" | "Scheduled" | "Target date" | "Completed" |
  // "Started" | "Record"
  label: string;
  tone: CalTone;
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
      item = { nodeId: node.id, key, title: node.title, label: "Logged", tone: "done" };
    } else if (isDueOn(rule, dayMs)) {
      if (dayMs < today) item = { nodeId: node.id, key, title: node.title, label: "Missed", tone: "attention" };
      else if (dayMs === today)
        item = { nodeId: node.id, key, title: node.title, label: "Due today", tone: "attention" };
      else item = { nodeId: node.id, key, title: node.title, label: "Scheduled", tone: "future" };
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
  const push = (node: NodeData, ms: number | undefined, slot: string, label: string, tone: CalTone) => {
    if (ms === undefined || !inMonth(ms, year, month0)) return;
    const day = new Date(ms).getDate();
    const list = byDay.get(day) ?? [];
    list.push({ nodeId: node.id, key: `${node.id}:${slot}`, title: node.title, label, tone });
    byDay.set(day, list);
  };

  for (const node of Object.values(doc.nodes)) {
    if (isRecord(node)) {
      push(node, node.occurredAt, "record", "Record", "neutral");
    } else if (node.recur) {
      // a recurring task never completes: its schedule and log ARE its days
      habitItems(node, year, month0, today, byDay);
    } else if (isGoal(node)) {
      push(node, node.targetDate, "target", "Target date", "primary");
      push(node, node.startedAt, "started", "Started", "neutral");
      push(node, node.completedAt, "completed", "Completed", "done");
    } else if (isTask(node)) {
      // a one-off due date is a deadline pin: it asks for attention on the
      // day and while overdue; a finished task's due date is plain history
      if (node.dueDate !== undefined) {
        if (node.completedAt !== undefined) {
          push(node, node.dueDate, "due", "Due date", "neutral");
        } else {
          const d = dayStart(node.dueDate);
          if (d < today) push(node, node.dueDate, "due", "Overdue", "attention");
          else if (d === today) push(node, node.dueDate, "due", "Due today", "attention");
          else push(node, node.dueDate, "due", "Due date", "primary");
        }
      }
      push(node, node.startedAt, "started", "Started", "neutral");
      push(node, node.completedAt, "completed", "Completed", "done");
    }
  }
  for (const [day, list] of byDay) {
    list.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
    const dayMs = new Date(year, month0, day).getTime();
    byDay.set(day, applyDayOrder(list, doc.dayOrder[String(dayMs)]));
  }
  return byDay;
}
