import { describe, expect, it } from "@jest/globals";
import { applyPatches, enablePatches, produceWithPatches } from "immer";

import { addChildNode, addFocusSegment, addFreeNode, Recipe } from "../commands";
import { calendarMonth } from "../calendar";
import { emptyDoc, LifeMapDoc } from "../doc";
import { fmtClock, fmtDuration, focusedMs, focusedMsOnDay } from "../focus";
import { docToRows, rowsToDoc } from "@/data/mapDb";

enablePatches();

function run(doc: LifeMapDoc, recipe: Recipe): LifeMapDoc {
  return produceWithPatches(doc, recipe)[0];
}

// every command must undo to EXACTLY the original doc via inverse patches
function expectRoundTrip(doc: LifeMapDoc, recipe: Recipe): LifeMapDoc {
  const [next, , inverse] = produceWithPatches(doc, recipe);
  expect(applyPatches(next, inverse)).toEqual(doc);
  return next;
}

// a goal with one child task
function fixture() {
  let doc = emptyDoc();
  const g = addFreeNode("goal", "G", "", { x: 0, y: 0 });
  const t = addChildNode(g.nodeId, "task", "T", "", { x: 10, y: 10 });
  for (const c of [g, t]) doc = run(doc, c.recipe);
  return { doc, g: g.nodeId, t: t.nodeId };
}

describe("addFocusSegment", () => {
  it("writes one record under the task carrying the measured duration", () => {
    const { doc, t } = fixture();
    const start = Date.now() - 25 * 60000;
    const end = Date.now();
    const seg = addFocusSegment(t, start, end, { x: 0, y: 0 });
    const next = expectRoundTrip(doc, seg.recipe);
    const rec = next.nodes[seg.nodeId];
    expect(rec.kind).toBe("record");
    expect(rec.durationMs).toBe(end - start);
    // occurredAt is the segment's END: the record lands on the day the
    // work finished
    expect(rec.occurredAt).toBe(end);
    expect(rec.title).toContain("Focus");
    // attached under the focused task
    expect(Object.values(next.edges).some((e) => e.fromId === t && e.toId === rec.id)).toBe(true);
  });

  it("clamps a backwards segment to zero duration", () => {
    const { doc, t } = fixture();
    const now = Date.now();
    const seg = addFocusSegment(t, now, now - 1000, { x: 0, y: 0 });
    const next = run(doc, seg.recipe);
    expect(next.nodes[seg.nodeId].durationMs).toBe(0);
  });
});

describe("focusedMs", () => {
  it("sums only the durations of records directly under the node", () => {
    let { doc, t } = fixture();
    const now = Date.now();
    const seg = addFocusSegment(t, now - 10 * 60000, now, { x: 0, y: 0 });
    doc = run(doc, seg.recipe);
    // a plain record under the same task contributes nothing
    const plain = addChildNode(t, "record", "R", "", { x: 1, y: 1 });
    doc = run(doc, plain.recipe);
    // a focus record elsewhere contributes nothing
    const other = addFreeNode("task", "T2", "", { x: 50, y: 50 });
    doc = run(doc, other.recipe);
    const seg2 = addFocusSegment(other.nodeId, now - 5 * 60000, now, { x: 60, y: 60 });
    doc = run(doc, seg2.recipe);
    expect(focusedMs(doc, t)).toBe(10 * 60000);
    expect(focusedMs(doc, other.nodeId)).toBe(5 * 60000);
  });
});

describe("focusedMsOnDay", () => {
  it("totals the focus records whose occurredAt lands on the day", () => {
    let { doc, t } = fixture();
    const day = new Date(2026, 9, 7, 12, 0, 0).getTime();
    const seg = addFocusSegment(t, day - 20 * 60000, day, { x: 0, y: 0 });
    doc = run(doc, seg.recipe);
    // a segment ending the next day belongs to that day
    const nextDay = day + 86400000;
    const seg2 = addFocusSegment(t, nextDay - 5 * 60000, nextDay, { x: 0, y: 0 });
    doc = run(doc, seg2.recipe);
    expect(focusedMsOnDay(doc, day)).toBe(20 * 60000);
    expect(focusedMsOnDay(doc, nextDay)).toBe(5 * 60000);
  });
});

describe("calendar surface", () => {
  it("focus records appear as day items carrying their duration", () => {
    let { doc, t } = fixture();
    const day = new Date(2026, 9, 7, 12, 0, 0).getTime();
    const seg = addFocusSegment(t, day - 30 * 60000, day, { x: 0, y: 0 });
    doc = run(doc, seg.recipe);
    const items = calendarMonth(doc, 2026, 9, day + 3600000).get(7) ?? [];
    const item = items.find((it) => it.nodeId === seg.nodeId);
    expect(item?.kind).toBe("record");
    expect(item?.durationMs).toBe(30 * 60000);
  });
});

describe("persistence", () => {
  it("durationMs survives the doc -> rows -> doc round trip", () => {
    let { doc, t } = fixture();
    const now = Date.now();
    const seg = addFocusSegment(t, now - 15 * 60000, now, { x: 0, y: 0 });
    doc = run(doc, seg.recipe);
    const rows = docToRows(doc);
    const back = rowsToDoc(rows.nodes, rows.notes, rows.edges, rows.tags, rows.dayOrder);
    expect(back.nodes[seg.nodeId].durationMs).toBe(15 * 60000);
    // a plain record has no duration after the round trip either
    const plain = addChildNode(t, "record", "R", "", { x: 1, y: 1 });
    doc = run(doc, plain.recipe);
    const rows2 = docToRows(doc);
    const back2 = rowsToDoc(rows2.nodes, rows2.notes, rows2.edges, rows2.tags, rows2.dayOrder);
    expect(back2.nodes[plain.nodeId].durationMs).toBeUndefined();
  });
});

describe("formatting", () => {
  it("fmtDuration renders compact durations", () => {
    expect(fmtDuration(45 * 1000)).toBe("45s");
    expect(fmtDuration(12 * 60000)).toBe("12m");
    expect(fmtDuration(60 * 60000)).toBe("1h");
    expect(fmtDuration(65 * 60000)).toBe("1h 5m");
  });

  it("fmtClock renders a stopwatch", () => {
    expect(fmtClock(5000)).toBe("0:05");
    expect(fmtClock(754000)).toBe("12:34");
    expect(fmtClock(3729000)).toBe("1:02:09");
  });
});
