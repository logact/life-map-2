import { describe, expect, it } from "@jest/globals";

import { enablePatches, produce } from "immer";

import {
  addChildNode,
  addFreeNode,
  connectNodes,
  expandEdge,
  Recipe,
  transitionNodeStatus,
} from "../commands";
import { emptyDoc, Id, LifeMapDoc } from "../doc";
import { snapshotEdge, snapshotNode, snapshotRoad } from "../clipboard";
import { buildSeedDoc } from "../seedDoc";
import { edgeStatus, goalStatus, nodeStatus } from "../status";
import { findRoutes } from "../route";
import { revealEdge, visibleEdges, visibleIsolatedNodes, zoomInIds, zoomOutIds } from "../visibility";

enablePatches();

function byTitle(doc: LifeMapDoc, title: string): Id {
  const n = Object.values(doc.nodes).find((n) => n.title === title);
  if (!n) throw new Error(`fixture node missing: ${title}`);
  return n.id;
}

function edgeBetween(doc: LifeMapDoc, fromTitle: string, toTitle: string): Id {
  const from = byTitle(doc, fromTitle);
  const to = byTitle(doc, toTitle);
  const e = Object.values(doc.edges).find((e) => e.fromId === from && e.toId === to && e.parentEdgeId === null);
  if (!e) throw new Error(`fixture edge missing: ${fromTitle} -> ${toTitle}`);
  return e.id;
}

// the seed doc is the shared fixture: the tour's last segment is layered
// (it expands into two zoom micro-lessons), "Ideas" is isolated, and a
// record dots the roadside
describe("visibility frontier", () => {
  const doc = buildSeedDoc(400, 300);

  it("a visible edge's children are never co-visible", () => {
    const zoomed = new Set<Id>();
    const visible = visibleEdges(doc, zoomed);
    // nothing zoomed: frontier is exactly the root edges, in order
    expect(visible.map((e) => e.id)).toEqual(doc.rootEdgeIds);

    const layersEdge = edgeBetween(doc, "Double-tap empty space to create", "Roads have layers — pinch to peek inside");
    const { next, revealed } = zoomInIds(doc, zoomed, [layersEdge]);
    expect(revealed.length).toBeGreaterThan(0);
    const after = visibleEdges(doc, next);
    const visibleIds = new Set(after.map((e) => e.id));
    expect(visibleIds.has(layersEdge)).toBe(false); // zoomed edge replaced by its children
    for (const id of revealed) expect(visibleIds.has(id)).toBe(true);
    // invariant: no visible edge has a visible ancestor
    for (const e of after) {
      let p = e.parentEdgeId;
      while (p) {
        expect(visibleIds.has(p)).toBe(false);
        p = doc.edges[p]?.parentEdgeId ?? null;
      }
    }
  });

  it("zoomIn on a childless edge changes nothing", () => {
    const leaf = edgeBetween(doc, "Tap any node — its card opens below", "Notes hide one tap deeper");
    const { next, revealed } = zoomInIds(doc, new Set(), [leaf]);
    expect(revealed).toHaveLength(0);
    expect(visibleEdges(doc, next).map((e) => e.id)).toEqual(doc.rootEdgeIds);
  });

  it("zoomOut folds the deepest frontier back into its parents", () => {
    const layersEdge = edgeBetween(doc, "Double-tap empty space to create", "Roads have layers — pinch to peek inside");
    const z1 = zoomInIds(doc, new Set(), [layersEdge]);
    const { next, parents } = zoomOutIds(doc, z1.next, z1.revealed);
    expect(parents).toEqual([layersEdge]);
    expect(next.has(layersEdge)).toBe(false);
    expect(visibleEdges(doc, next).map((e) => e.id)).toEqual(doc.rootEdgeIds);
  });

  it("reveal opens every ancestor so a hidden edge becomes visible", () => {
    const layersEdge = edgeBetween(doc, "Double-tap empty space to create", "Roads have layers — pinch to peek inside");
    const z1 = zoomInIds(doc, new Set(), [layersEdge]);
    // one revealed edge is a leaf; the expanded sibling is the way down
    const deepChild = z1.revealed.find((id) => doc.edges[id].childEdgeIds.length > 0)!;
    const z2 = zoomInIds(doc, z1.next, [deepChild]);
    const grandChild = z2.revealed[0];
    // fully collapsed: the grandchild is hidden
    expect(visibleEdges(doc, new Set()).map((e) => e.id)).not.toContain(grandChild);
    const revealedLens = revealEdge(doc, new Set(), grandChild);
    expect(revealedLens.has(layersEdge)).toBe(true);
    expect(revealedLens.has(deepChild)).toBe(true);
    expect(visibleEdges(doc, revealedLens).map((e) => e.id)).toContain(grandChild);
  });

  it("isolated nodes come from rootNodeIds", () => {
    const isolated = visibleIsolatedNodes(doc).map((n) => n.title);
    expect(isolated).toContain("Ideas");
  });
});

describe("goalStatus", () => {
  it("goal destinations stay todo until manually completed", () => {
    const doc = buildSeedDoc(400, 300);
    // the tour's destination ends the road, so derivation finds no
    // outgoing child tasks (GAPS.md #7)
    expect(goalStatus(doc, byTitle(doc, "Make this map yours"))).toBe("todo");
    // manually completed: the mid-road milestone
    expect(goalStatus(doc, byTitle(doc, "Goals are the destinations"))).toBe("done");
  });

  it("manual completion wins over derivation", () => {
    let doc = emptyDoc();
    const g = addFreeNode("goal", "G", "", { x: 0, y: 0 });
    const t = addChildNode(g.nodeId, "task", "T", "", { x: 10, y: 10 });
    doc = produce(doc, g.recipe);
    doc = produce(doc, t.recipe);
    // the child is mid-work, yet the manually completed goal stays done
    doc = produce(doc, transitionNodeStatus(t.nodeId, "start"));
    doc = produce(doc, transitionNodeStatus(g.nodeId, "complete"));
    expect(goalStatus(doc, g.nodeId)).toBe("done");
  });

  it("expanding a goal->task edge must not flip the goal's status (B13)", () => {
    let doc = emptyDoc();
    const g = addFreeNode("goal", "G", "", { x: 0, y: 0 });
    const t = addChildNode(g.nodeId, "task", "T", "", { x: 10, y: 10 });
    doc = produce(doc, g.recipe);
    doc = produce(doc, t.recipe);
    doc = produce(doc, transitionNodeStatus(t.nodeId, "complete"));
    expect(goalStatus(doc, g.nodeId)).toBe("done");
    // expand inserts a synthetic todo task as a NEW out-edge of G; without
    // the synthetic filter this would flip the goal back to in-progress
    doc = produce(doc, expandEdge(t.edgeId).recipe);
    expect(goalStatus(doc, g.nodeId)).toBe("done");
  });

  it("records have null status", () => {
    const doc = buildSeedDoc(400, 300);
    expect(nodeStatus(doc, byTitle(doc, "Records are dated dots"))).toBeNull();
  });
});

describe("edgeStatus frontier", () => {
  it("a road segment shows the status of the step it leads to", () => {
    const doc = buildSeedDoc(400, 300);
    // the first two lessons are pre-done -> their segment is done
    expect(edgeStatus(doc, edgeBetween(doc, "Tap any node — its card opens below", "Notes hide one tap deeper"))).toBe(
      "done",
    );
    // the drag lesson is under way -> in-progress
    expect(edgeStatus(doc, edgeBetween(doc, "Notes hide one tap deeper", "Long-press to drag me anywhere"))).toBe(
      "in-progress",
    );
    // the connect lesson hasn't started -> todo
    expect(edgeStatus(doc, edgeBetween(doc, "Long-press to drag me anywhere", "Connect: drag from my ring to another node"))).toBe(
      "todo",
    );
    // the collapsed layers segment shows its first unfinished hidden step
    expect(
      edgeStatus(doc, edgeBetween(doc, "Double-tap empty space to create", "Roads have layers — pinch to peek inside")),
    ).toBe("todo");
    // edges touching records stay plain
    const rec = byTitle(doc, "Records are dated dots");
    const recEdge = Object.values(doc.edges).find((e) => e.toId === rec)!;
    expect(edgeStatus(doc, recEdge.id)).toBeNull();
  });
});

// the route-test subgraph: five distinct directed paths RT Start -> RT End
// (some sharing segments), a dead end that must NOT appear in the results,
// and a back-road whose wrong direction must NOT be traversable. Built
// inline so the test owns its fixture.
function buildRouteTestDoc(): LifeMapDoc {
  let doc = emptyDoc();
  const cx = 400;
  const cy = 300;
  const apply = (r: Recipe) => {
    doc = produce(doc, r);
  };
  const free = (kind: "goal" | "task", title: string, x: number, y: number): Id => {
    const c = addFreeNode(kind, title, "", { x, y });
    apply(c.recipe);
    return c.nodeId;
  };
  const link = (fromId: Id, toId: Id) => apply(connectNodes(fromId, toId).recipe);

  const start = free("goal", "RT Start", cx - 160, cy + 360);
  const end = free("goal", "RT End", cx + 160, cy + 360);
  link(start, end); // path 1: direct

  const a1 = free("task", "RT A1", cx, cy + 310); // path 2: 2 steps
  link(start, a1);
  link(a1, end);

  const b1 = free("task", "RT B1", cx - 70, cy + 430); // path 3: 3 steps
  const b2 = free("task", "RT B2", cx + 70, cy + 450);
  link(start, b1);
  link(b1, b2);
  link(b2, end);

  const c1 = free("task", "RT C1", cx - 30, cy + 530); // path 4: merges into path 3 at B2
  link(start, c1);
  link(c1, b2);

  const d1 = free("task", "RT D1", cx - 110, cy + 290); // path 5: merges into path 2 at A1
  link(start, d1);
  link(d1, a1);

  const x = free("task", "RT X", cx - 270, cy + 430); // dead end: never reaches RT End
  const y = free("task", "RT Y", cx - 330, cy + 500);
  link(start, x);
  link(x, y);

  const z = free("task", "RT Z", cx + 270, cy + 430); // back-road: directed End -> Z -> Start
  link(end, z);
  link(z, start);

  return doc;
}

describe("findRoutes (B24)", () => {
  const doc = buildRouteTestDoc();
  const visible = visibleEdges(doc, new Set());

  it("finds the 5 routes from RT Start to RT End, shortest first", () => {
    const routes = findRoutes(doc, visible, byTitle(doc, "RT Start"), byTitle(doc, "RT End"), 8);
    expect(routes).toHaveLength(5);
    // direct road is shortest and first
    expect(routes[0].edges).toHaveLength(1);
    for (let i = 1; i < routes.length; i++) {
      expect(routes[i].length).toBeGreaterThanOrEqual(routes[i - 1].length);
    }
    // no route travels the dead end
    const rtX = byTitle(doc, "RT X");
    for (const r of routes) expect(r.nodes.map((n) => n.id)).not.toContain(rtX);
  });

  it("respects direction: the back-road is traversable End -> Start only", () => {
    const routes = findRoutes(doc, visible, byTitle(doc, "RT End"), byTitle(doc, "RT Start"), 8);
    expect(routes).toHaveLength(1); // End -> Z -> Start
    expect(routes[0].nodes.map((n) => n.title)).toEqual(["RT End", "RT Z", "RT Start"]);
  });

  it("returns [] for identical endpoints and unknown nodes", () => {
    const s = byTitle(doc, "RT Start");
    expect(findRoutes(doc, visible, s, s)).toEqual([]);
    expect(findRoutes(doc, visible, s, "no-such-node")).toEqual([]);
  });
});

describe("clipboard snapshots", () => {
  const doc = buildSeedDoc(400, 300);

  it("node snapshots carry payload only, no adjacency", () => {
    const payload = snapshotNode(doc, byTitle(doc, "Goals are the destinations"));
    expect(payload.kind).toBe("node");
    expect(payload.nodes).toHaveLength(1);
    expect(payload.rootEdges).toHaveLength(0);
    expect(payload.nodes[0].data).toMatchObject({ completedAt: expect.any(Number) });
  });

  it("edge snapshots deep-copy the subtree; road snapshots dedupe shared edges", () => {
    const layersEdge = edgeBetween(doc, "Double-tap empty space to create", "Roads have layers — pinch to peek inside");
    const one = snapshotEdge(doc, layersEdge);
    expect(one.kind).toBe("edge");
    expect(one.rootEdges).toHaveLength(1);
    // the hidden zoom lessons ride along
    expect(one.rootEdges[0].children.length).toBeGreaterThan(1);

    const road = snapshotRoad(doc, [layersEdge, layersEdge]); // same edge twice
    expect(road.rootEdges).toHaveLength(1); // captured once
  });
});
