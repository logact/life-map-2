import { describe, expect, it } from "@jest/globals";

import { enablePatches, produce } from "immer";

import { addChildNode, addFreeNode, expandEdge, transitionNodeStatus } from "../commands";
import { emptyDoc, Id, LifeMapDoc } from "../doc";
import { snapshotEdge, snapshotNode, snapshotRoad } from "../clipboard";
import { buildDemoDoc } from "../demoDoc";
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

describe("visibility frontier", () => {
  const doc = buildDemoDoc(400, 300);

  it("a visible edge's children are never co-visible", () => {
    const zoomed = new Set<Id>();
    const visible = visibleEdges(doc, zoomed);
    // nothing zoomed: frontier is exactly the root edges, in order
    expect(visible.map((e) => e.id)).toEqual(doc.rootEdgeIds);

    const hc = edgeBetween(doc, "Health", "Career");
    const { next, revealed } = zoomInIds(doc, zoomed, [hc]);
    expect(revealed.length).toBeGreaterThan(0);
    const after = visibleEdges(doc, next);
    const visibleIds = new Set(after.map((e) => e.id));
    expect(visibleIds.has(hc)).toBe(false); // zoomed edge replaced by its children
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
    const cf = edgeBetween(doc, "Career", "Friends");
    const { next, revealed } = zoomInIds(doc, new Set(), [cf]);
    expect(revealed).toHaveLength(0);
    expect(visibleEdges(doc, next).map((e) => e.id)).toEqual(doc.rootEdgeIds);
  });

  it("zoomOut folds the deepest frontier back into its parents", () => {
    const hc = edgeBetween(doc, "Health", "Career");
    const z1 = zoomInIds(doc, new Set(), [hc]);
    const { next, parents } = zoomOutIds(doc, z1.next, z1.revealed);
    expect(parents).toEqual([hc]);
    expect(next.has(hc)).toBe(false);
    expect(visibleEdges(doc, next).map((e) => e.id)).toEqual(doc.rootEdgeIds);
  });

  it("reveal opens every ancestor so a hidden edge becomes visible", () => {
    const hc = edgeBetween(doc, "Health", "Career");
    const z1 = zoomInIds(doc, new Set(), [hc]);
    const deepChild = z1.revealed[0];
    const z2 = zoomInIds(doc, z1.next, [deepChild]);
    const grandChild = z2.revealed[0];
    // fully collapsed: the grandchild is hidden
    expect(visibleEdges(doc, new Set()).map((e) => e.id)).not.toContain(grandChild);
    const revealedLens = revealEdge(doc, new Set(), grandChild);
    expect(revealedLens.has(hc)).toBe(true);
    expect(revealedLens.has(deepChild)).toBe(true);
    expect(visibleEdges(doc, revealedLens).map((e) => e.id)).toContain(grandChild);
  });

  it("isolated nodes come from rootNodeIds", () => {
    const isolated = visibleIsolatedNodes(doc).map((n) => n.title);
    expect(isolated).toContain("Learning");
  });
});

describe("goalStatus", () => {
  it("rolls up child tasks; manual completion wins", () => {
    const doc = buildDemoDoc(400, 300);
    // Health: manual complete beats the in-progress Sleep task
    expect(goalStatus(doc, byTitle(doc, "Health"))).toBe("done");
    // Family: one done + one todo task -> in-progress
    expect(goalStatus(doc, byTitle(doc, "Family"))).toBe("in-progress");
    // Career: no tasks -> todo
    expect(goalStatus(doc, byTitle(doc, "Career"))).toBe("todo");
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
    const doc = buildDemoDoc(400, 300);
    expect(nodeStatus(doc, byTitle(doc, "Ran 4.8km"))).toBeNull();
  });
});

describe("edgeStatus frontier", () => {
  it("a collapsed edge shows the first unfinished step on its road", () => {
    const doc = buildDemoDoc(400, 300);
    // hc2 done, hc3 in progress, the rest todo -> in-progress
    expect(edgeStatus(doc, edgeBetween(doc, "Health", "Career"))).toBe("in-progress");
    // untouched road: first non-done step is its todo midpoint -> todo
    expect(edgeStatus(doc, edgeBetween(doc, "Health", "Family"))).toBe("todo");
    // edges touching records stay plain
    const rec = byTitle(doc, "Ran 4.8km");
    const recEdge = Object.values(doc.edges).find((e) => e.toId === rec)!;
    expect(edgeStatus(doc, recEdge.id)).toBeNull();
  });
});

describe("findRoutes (B24)", () => {
  const doc = buildDemoDoc(400, 300);
  const visible = visibleEdges(doc, new Set());

  it("finds the 5 demo routes from RT Start to RT End, shortest first", () => {
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
  const doc = buildDemoDoc(400, 300);

  it("node snapshots carry payload only, no adjacency", () => {
    const payload = snapshotNode(doc, byTitle(doc, "Health"));
    expect(payload.kind).toBe("node");
    expect(payload.nodes).toHaveLength(1);
    expect(payload.rootEdges).toHaveLength(0);
    expect(payload.nodes[0].data).toMatchObject({ completedAt: expect.any(Number) });
  });

  it("edge snapshots deep-copy the subtree; road snapshots dedupe shared edges", () => {
    const hc = edgeBetween(doc, "Health", "Career");
    const one = snapshotEdge(doc, hc);
    expect(one.kind).toBe("edge");
    expect(one.rootEdges).toHaveLength(1);
    // the expanded subtree rides along: chain children + side branch
    expect(one.rootEdges[0].children.length).toBeGreaterThan(1);

    const road = snapshotRoad(doc, [hc, hc]); // same edge twice
    expect(road.rootEdges).toHaveLength(1); // captured once
  });
});
