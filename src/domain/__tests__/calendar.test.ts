import { describe, expect, it } from "@jest/globals";

import { enablePatches, produceWithPatches } from "immer";

import { calendarMonth } from "../calendar";
import { addFreeNode } from "../commands";
import { emptyDoc, LifeMapDoc, makeGoal, makeRecordNode, makeTask, NodeData } from "../doc";

enablePatches();

// fixed local dates inside September 2026 (month0 = 8); 2026-09-14 is a
// Monday, so 23 = Wed. `now` is Wednesday the 23rd at noon
const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const Y = 2026;
const M = 8;
const NOW = at("2026-09-23");

function docWith(...nodes: NodeData[]): LifeMapDoc {
  const doc = emptyDoc();
  for (const n of nodes) doc.nodes[n.id] = n;
  return doc;
}

describe("calendarMonth", () => {
  it("places a record on its occurred day", () => {
    const rec = makeRecordNode(0, 0, "Shipped v1", "notes", at("2026-09-05"));
    const month = calendarMonth(docWith(rec), Y, M, NOW);
    expect(month.get(5)).toEqual([
      { nodeId: rec.id, title: "Shipped v1", label: "Record", tone: "neutral" },
    ]);
    expect(month.has(6)).toBe(false);
  });

  it("places a goal's target date and stamps", () => {
    const goal = makeGoal(0, 0, "Launch", {
      targetDate: at("2026-09-30"),
      startedAt: at("2026-09-01"),
      completedAt: at("2026-09-28"),
    });
    const month = calendarMonth(docWith(goal), Y, M, NOW);
    expect(month.get(30)).toEqual([
      { nodeId: goal.id, title: "Launch", label: "Target date", tone: "primary" },
    ]);
    expect(month.get(1)?.[0].label).toBe("Started");
    expect(month.get(28)?.[0].tone).toBe("done");
  });

  it("places a plain task's stamps but no schedule", () => {
    const task = makeTask(0, 0, "Fix the leak", {
      startedAt: at("2026-09-10"),
      completedAt: at("2026-09-12"),
    });
    const month = calendarMonth(docWith(task), Y, M, NOW);
    expect(month.get(10)?.[0].label).toBe("Started");
    expect(month.get(12)?.[0].label).toBe("Completed");
    expect(month.get(11)).toBeUndefined();
  });

  it("classifies a daily habit against today: missed, due, scheduled, logged", () => {
    const habit = makeTask(0, 0, "Gym", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-09-20") },
      log: [at("2026-09-21")],
    });
    const month = calendarMonth(docWith(habit), Y, M, NOW);
    expect(month.get(20)).toEqual([
      { nodeId: habit.id, title: "Gym", label: "Missed", tone: "attention" },
    ]);
    expect(month.get(21)?.[0].label).toBe("Logged");
    expect(month.get(21)?.[0].tone).toBe("done");
    expect(month.get(22)).toEqual([
      { nodeId: habit.id, title: "Gym", label: "Missed", tone: "attention" },
    ]);
    expect(month.get(23)).toEqual([
      { nodeId: habit.id, title: "Gym", label: "Due today", tone: "attention" },
    ]);
    expect(month.get(24)).toEqual([
      { nodeId: habit.id, title: "Gym", label: "Scheduled", tone: "future" },
    ]);
    expect(month.has(19)).toBe(false); // before the anchor
  });

  it("shows a catch-up log on an unscheduled day", () => {
    const habit = makeTask(0, 0, "Journal", {
      recur: { freq: "daily", interval: 2, anchor: at("2026-09-14") },
      log: [at("2026-09-15")], // not a scheduled day under every-2-days
    });
    const month = calendarMonth(docWith(habit), Y, M, NOW);
    expect(month.get(15)?.[0].label).toBe("Logged");
    expect(month.get(15)?.[0].tone).toBe("done");
  });

  it("a logged scheduled day reads as done, never missed", () => {
    const habit = makeTask(0, 0, "Gym", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-09-20") },
      log: [at("2026-09-20")],
    });
    const month = calendarMonth(docWith(habit), Y, M, NOW);
    expect(month.get(20)?.[0].label).toBe("Logged");
  });

  it("orders a day's rows: attention, deadline, done, history, future", () => {
    const habit = makeTask(0, 0, "Gym", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-09-01") },
    });
    const goal = makeGoal(0, 0, "Launch", { targetDate: at("2026-09-23") });
    const done = makeTask(0, 0, "Fix", { completedAt: at("2026-09-23") });
    const rec = makeRecordNode(0, 0, "Shipped", "", at("2026-09-23"));
    const month = calendarMonth(docWith(habit, goal, done, rec), Y, M, NOW);
    expect(month.get(23)?.map((it) => it.label)).toEqual([
      "Due today",
      "Target date",
      "Completed",
      "Record",
    ]);
  });

  it("ignores stamps outside the viewed month", () => {
    const goal = makeGoal(0, 0, "Launch", { targetDate: at("2026-10-01") });
    const rec = makeRecordNode(0, 0, "Shipped", "", at("2026-08-31"));
    const month = calendarMonth(docWith(goal, rec), Y, M, NOW);
    expect(month.size).toBe(0);
  });

  it("classifies a task's due date against today", () => {
    const overdue = makeTask(0, 0, "Old", { dueDate: at("2026-09-20") });
    const dueToday = makeTask(0, 0, "Now", { dueDate: at("2026-09-23") });
    const future = makeTask(0, 0, "Soon", { dueDate: at("2026-09-28") });
    const done = makeTask(0, 0, "Finished", {
      dueDate: at("2026-09-25"),
      completedAt: at("2026-09-22"),
    });
    const month = calendarMonth(docWith(overdue, dueToday, future, done), Y, M, NOW);
    expect(month.get(20)).toEqual([
      { nodeId: overdue.id, title: "Old", label: "Overdue", tone: "attention" },
    ]);
    expect(month.get(23)).toEqual([
      { nodeId: dueToday.id, title: "Now", label: "Due today", tone: "attention" },
    ]);
    expect(month.get(28)).toEqual([
      { nodeId: future.id, title: "Soon", label: "Due date", tone: "primary" },
    ]);
    // a finished task's due date is plain history; the completion stamp
    // still shows on its own day
    expect(month.get(25)).toEqual([
      { nodeId: done.id, title: "Finished", label: "Due date", tone: "neutral" },
    ]);
    expect(month.get(22)?.some((it) => it.nodeId === done.id && it.label === "Completed")).toBe(true);
  });

  it("a habit shows its rule, never a stale due date", () => {
    const habit = makeTask(0, 0, "Gym", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-09-23") },
      dueDate: at("2026-09-28"), // setNodeRecurrence clears these; belt and braces
    });
    const month = calendarMonth(docWith(habit), Y, M, NOW);
    expect(month.get(28)?.some((it) => it.label === "Due date")).toBe(false);
    expect(month.get(28)?.[0].label).toBe("Scheduled");
  });

  it("lists what the calendar's '+ New' creates on a day, pinned by kind", () => {
    // the screen's exact wiring: addFreeNode with the day as targetDate
    // (goal), dueDate (task) and occurredAt (record)
    const day = new Date(2026, 8, 29).getTime(); // local midnight, as the screen computes it
    let doc = emptyDoc();
    const adds = [
      addFreeNode("goal", "Ship it", "", { x: 0, y: 0 }, undefined, day),
      addFreeNode("task", "Book flights", "", { x: 0, y: 0 }, undefined, undefined, day),
      addFreeNode("record", "Called grandma", "", { x: 0, y: 0 }, day),
    ];
    for (const a of adds) doc = produceWithPatches(doc, a.recipe)[0];
    const items = calendarMonth(doc, Y, M, NOW).get(29) ?? [];
    expect(items.map((it) => it.label)).toEqual(["Target date", "Due date", "Record"]);
  });
});
