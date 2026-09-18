import { describe, expect, it } from "@jest/globals";

import { docToRows, rowsToDoc } from "@/data/mapDb";
import { isRecord } from "../doc";
import { findRoutes } from "../route";
import { buildSeedDoc } from "../seedDoc";
import { edgeStatus, goalStatus } from "../status";
import { visibleEdges } from "../visibility";

// the seed is the app's tutorial, so it deserves the same invariant checks
// as any user-built doc — plus the property the whole design is about: one
// directed road from the first lesson to the final goal
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

  it("contains the tour goals plus the isolated ideas node", () => {
    for (const title of ["Goals are the destinations", "Make this map yours", "Ideas"]) {
      expect(byTitle(title).kind).toBe("goal");
    }
    expect(doc.rootNodeIds).toContain(byTitle("Ideas").id);
  });

  it("is one directed road from the first lesson to the final goal", () => {
    const visible = visibleEdges(doc, new Set());
    const routes = findRoutes(
      doc,
      visible,
      byTitle("Tap any node — its card opens below").id,
      byTitle("Make this map yours").id,
      8,
    );
    expect(routes).toHaveLength(1);
    // the collapsed layers segment routes as one hop; the zoom lessons hide inside it
    expect(routes[0].nodes.map((n) => n.title)).toEqual([
      "Tap any node — its card opens below",
      "Notes hide one tap deeper",
      "Long-press to drag me anywhere",
      "Connect: drag from my ring to another node",
      "Goals are the destinations",
      "Double-tap empty space to create",
      "Roads have layers — pinch to peek inside",
      "Make this map yours",
    ]);
  });

  it("each road segment shows the status of the step it leads to", () => {
    expect(edgeStatus(doc, segment("Tap any node — its card opens below", "Notes hide one tap deeper"))).toBe(
      "done",
    );
    expect(edgeStatus(doc, segment("Notes hide one tap deeper", "Long-press to drag me anywhere"))).toBe(
      "in-progress",
    );
    expect(edgeStatus(doc, segment("Long-press to drag me anywhere", "Connect: drag from my ring to another node"))).toBe(
      "todo",
    );
    // the segment into the reached milestone reads done with it
    expect(edgeStatus(doc, segment("Connect: drag from my ring to another node", "Goals are the destinations"))).toBe(
      "done",
    );
    // the collapsed layers segment shows the first unfinished hidden step
    expect(edgeStatus(doc, segment("Double-tap empty space to create", "Roads have layers — pinch to peek inside"))).toBe(
      "todo",
    );
  });

  it("the milestone goal was marked done; the destination stays todo (GAPS.md #7)", () => {
    expect(goalStatus(doc, byTitle("Goals are the destinations").id)).toBe("done");
    expect(goalStatus(doc, byTitle("Make this map yours").id)).toBe("todo");
  });

  it("keeps records as leaves", () => {
    for (const n of Object.values(doc.nodes)) {
      if (!isRecord(n)) continue;
      expect(Object.values(doc.edges).some((e) => e.fromId === n.id)).toBe(false);
    }
  });

  it("stamps every timestamp at build time — a tutorial has no fake history", () => {
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
  });

  it("round-trips through the sqlite row shape exactly", () => {
    const rows = docToRows(doc);
    expect(rowsToDoc(rows.nodes, rows.notes, rows.edges)).toEqual(doc);
  });
});
