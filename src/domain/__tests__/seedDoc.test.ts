import { describe, expect, it } from "@jest/globals";

import { docToRows, rowsToDoc } from "@/data/mapDb";
import { isRecord } from "../doc";
import { findRoutes } from "../route";
import { buildSeedDoc } from "../seedDoc";
import { edgeStatus, goalStatus } from "../status";
import { visibleEdges } from "../visibility";

// the seed is a real life, so it deserves the same invariant checks as any
// user-built doc — plus the property the whole design is about: each area
// is one directed road from its first step to its main goal
describe("buildSeedDoc", () => {
  const doc = buildSeedDoc(200, 280);

  function byTitle(title: string) {
    const n = Object.values(doc.nodes).find((n) => n.title === title);
    if (!n) throw new Error(`seed node missing: ${title}`);
    return n;
  }

  // a root edge by endpoint titles
  function segment(fromTitle: string, toTitle: string) {
    const e = Object.values(doc.edges).find(
      (e) => e.fromId === byTitle(fromTitle).id && e.toId === byTitle(toTitle).id && e.parentEdgeId === null,
    );
    if (!e) throw new Error(`seed segment missing: ${fromTitle} -> ${toTitle}`);
    return e.id;
  }

  it("contains the three life areas plus the isolated ideas node", () => {
    for (const title of ["Life Map App", "Get Stronger", "English", "Ideas"]) {
      expect(byTitle(title).kind).toBe("goal");
    }
    expect(doc.rootNodeIds).toContain(byTitle("Ideas").id);
  });

  it("each area is one directed road from its first step to its main goal", () => {
    const visible = visibleEdges(doc, new Set());
    const chain = (from: string, to: string, expected: string[]) => {
      const routes = findRoutes(doc, visible, byTitle(from).id, byTitle(to).id, 8);
      expect(routes).toHaveLength(1);
      expect(routes[0].nodes.map((n) => n.title)).toEqual(expected);
    };
    chain("Core canvas & gestures", "Life Map App", [
      "Core canvas & gestures",
      "Persistence, undo, layers",
      "Polish: routes, notes, search",
      "Trust blockers",
      "Life Map App",
    ]);
    // the collapsed program segment routes as one hop; the week phases hide inside it
    chain("Gear up & learn form", "Get Stronger", [
      "Gear up & learn form",
      "12-week beginner program",
      "Squat 100 kg",
      "Bench 70 kg",
      "Deadlift 120 kg",
      "Get Stronger",
    ]);
    chain("Anki & weekly journal", "English", [
      "Anki & weekly journal",
      "Listening without subtitles",
      "Read a whole book",
      "Find a language partner",
      "English",
    ]);
  });

  it("each road segment shows the status of the step it leads to", () => {
    expect(edgeStatus(doc, segment("Gear up & learn form", "12-week beginner program"))).toBe("done");
    expect(edgeStatus(doc, segment("12-week beginner program", "Squat 100 kg"))).toBe("in-progress");
    expect(edgeStatus(doc, segment("Bench 70 kg", "Deadlift 120 kg"))).toBe("todo");
    expect(edgeStatus(doc, segment("Polish: routes, notes, search", "Trust blockers"))).toBe(
      "in-progress",
    );
  });

  it("main goals are destinations: todo until manually marked done (GAPS.md #7)", () => {
    expect(goalStatus(doc, byTitle("Life Map App").id)).toBe("todo");
    expect(goalStatus(doc, byTitle("Get Stronger").id)).toBe("todo");
    expect(goalStatus(doc, byTitle("English").id)).toBe("todo");
    // the one reached milestone goal was completed manually
    expect(goalStatus(doc, byTitle("12-week beginner program").id)).toBe("done");
  });

  it("keeps the three areas as independent islands — no invented relations", () => {
    const visible = visibleEdges(doc, new Set());
    expect(findRoutes(doc, visible, byTitle("Get Stronger").id, byTitle("Life Map App").id, 8)).toEqual([]);
    expect(findRoutes(doc, visible, byTitle("English").id, byTitle("Get Stronger").id, 8)).toEqual([]);
  });

  it("keeps records as leaves", () => {
    for (const n of Object.values(doc.nodes)) {
      if (!isRecord(n)) continue;
      expect(Object.values(doc.edges).some((e) => e.fromId === n.id)).toBe(false);
    }
  });

  it("backdates every historical timestamp into the past", () => {
    const now = Date.now();
    for (const n of Object.values(doc.nodes)) {
      for (const t of [n.startedAt, n.completedAt, n.occurredAt, n.createdAt]) {
        if (t !== undefined) expect(t).toBeLessThanOrEqual(now);
      }
      for (const note of n.notes) {
        expect(note.createdAt).toBeLessThanOrEqual(now);
        expect(note.updatedAt).toBeLessThanOrEqual(now);
      }
    }
    // the one future date on the map is the daily-driver target
    expect(byTitle("Life Map App").targetDate).toBeDefined();
  });

  it("round-trips through the sqlite row shape exactly", () => {
    const rows = docToRows(doc);
    expect(rowsToDoc(rows.nodes, rows.notes, rows.edges)).toEqual(doc);
  });
});
