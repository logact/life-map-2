import { describe, expect, it } from "@jest/globals";

import { applyPatches, enablePatches, produceWithPatches } from "immer";

import {
  addChildNode,
  addFreeNode,
  addParentNode,
  addNote,
  connectNodes,
  DomainError,
  expandEdge,
  insertNodeIntoEdge,
  moveNode,
  pastePayload,
  Recipe,
  removeEdge,
  removeNode,
  removeNote,
  renameNode,
  setEdgeBend,
  setEdgeColor,
  setNodeColor,
  setNodeDetail,
  summarizeEdges,
  transitionNodeStatus,
  updateNote,
} from "../commands";
import { emptyDoc, LifeMapDoc } from "../doc";
import { snapshotEdge } from "../clipboard";

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

// a small fixture: goal H with child tasks T1/T2, plus isolated node I
function fixture() {
  let doc = emptyDoc();
  const h = addFreeNode("goal", "H", "", { x: 0, y: 0 });
  const t1 = addChildNode(h.nodeId, "task", "T1", "", { x: 10, y: 10 });
  const t2 = addChildNode(h.nodeId, "task", "T2", "", { x: 20, y: 20 });
  const iso = addFreeNode("goal", "I", "", { x: 99, y: 99 });
  for (const c of [h, t1, t2, iso]) doc = run(doc, c.recipe);
  return { doc, h: h.nodeId, t1: t1.nodeId, t2: t2.nodeId, iso: iso.nodeId, e1: t1.edgeId, e2: t2.edgeId };
}

describe("status machine", () => {
  it("walks todo -> in-progress -> done -> todo", () => {
    let { doc, t1 } = fixture();
    doc = run(doc, transitionNodeStatus(t1, "start"));
    expect(doc.nodes[t1].status).toBe("in-progress");
    expect(doc.nodes[t1].startedAt).toEqual(expect.any(Number));
    doc = run(doc, transitionNodeStatus(t1, "complete"));
    expect(doc.nodes[t1].status).toBe("done");
    doc = run(doc, transitionNodeStatus(t1, "reopen"));
    expect(doc.nodes[t1].status).toBe("todo");
    expect(doc.nodes[t1].completedAt).toBeUndefined();
    // startedAt records the first start and is never cleared
    expect(doc.nodes[t1].startedAt).toEqual(expect.any(Number));
  });

  it("rejects illegal transitions", () => {
    const { doc, t1 } = fixture();
    expect(() => run(doc, transitionNodeStatus(t1, "pause"))).toThrow(DomainError);
    expect(() => run(doc, transitionNodeStatus(t1, "reopen"))).toThrow(DomainError);
  });

  it("completes and reopens goals, but never starts one", () => {
    let { doc, h } = fixture();
    expect(() => run(doc, transitionNodeStatus(h, "start"))).toThrow(DomainError);
    doc = run(doc, transitionNodeStatus(h, "complete"));
    expect(doc.nodes[h].completedAt).toEqual(expect.any(Number));
    doc = run(doc, transitionNodeStatus(h, "reopen"));
    expect(doc.nodes[h].completedAt).toBeUndefined();
  });

  it("records have no status", () => {
    let { doc, t1 } = fixture();
    const rec = addChildNode(t1, "record", "R", "note", { x: 0, y: 0 });
    doc = run(doc, rec.recipe);
    expect(() => run(doc, transitionNodeStatus(rec.nodeId, "start"))).toThrow(DomainError);
  });
});

describe("records are leaves (B3)", () => {
  it("a record cannot become a parent", () => {
    let { doc, t1 } = fixture();
    const rec = addChildNode(t1, "record", "R", "", { x: 0, y: 0 });
    doc = run(doc, rec.recipe);
    expect(() => run(doc, addChildNode(rec.nodeId, "task", "X", "", { x: 0, y: 0 }).recipe)).toThrow(
      DomainError,
    );
    expect(() => addParentNode(t1, "record", "X", "", { x: 0, y: 0 })).toThrow(DomainError);
  });
});

describe("expandEdge", () => {
  it("splits a leaf edge into from -> mid -> to with a synthetic midpoint", () => {
    const { doc, e1, h, t1 } = fixture();
    const ex = expandEdge(e1, { dx: -40, dy: 0 });
    const next = expectRoundTrip(doc, ex.recipe);
    const mid = next.nodes[ex.midNodeId];
    expect(mid.kind).toBe("task");
    expect(mid.synthetic).toBe(true);
    expect(mid.title).toBe("H-T1");
    expect(mid.x).toBe((doc.nodes[h].x + doc.nodes[t1].x) / 2 - 40);
    const [c1, c2] = ex.childEdgeIds.map((id) => next.edges[id]);
    expect([c1.fromId, c1.toId]).toEqual([h, ex.midNodeId]);
    expect([c2.fromId, c2.toId]).toEqual([ex.midNodeId, t1]);
    expect(next.edges[e1].childEdgeIds).toEqual(ex.childEdgeIds);
  });

  it("is a no-op on an edge that already has children", () => {
    let { doc, e1 } = fixture();
    doc = run(doc, expandEdge(e1).recipe);
    const again = expandEdge(e1);
    expect(run(doc, again.recipe)).toBe(doc); // untouched draft -> same reference
    expect(run(doc, again.recipe).edges[again.childEdgeIds[0]]).toBeUndefined();
  });

  it("places the midpoint dead-center on the edge by default", () => {
    const { doc, e1, h, t1 } = fixture();
    const ex = expandEdge(e1);
    const next = expectRoundTrip(doc, ex.recipe);
    const a = doc.nodes[h];
    const b = doc.nodes[t1];
    const mid = next.nodes[ex.midNodeId];
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2);
    expect(mid.y).toBeCloseTo((a.y + b.y) / 2);
  });
});

describe("insertNodeIntoEdge", () => {
  it("splits an edge into from -> N -> to at the old edge's slot", () => {
    const { doc, e1, h, t1 } = fixture();
    const ins = insertNodeIntoEdge(e1, "task", "N", "d", { x: 5, y: 5 });
    const next = expectRoundTrip(doc, ins.recipe);
    expect(next.edges[e1]).toBeUndefined();
    const [h1, h2] = ins.edgeIds.map((id) => next.edges[id]);
    expect([h1.fromId, h1.toId]).toEqual([h, ins.nodeId]);
    expect([h2.fromId, h2.toId]).toEqual([ins.nodeId, t1]);
    expect(h1.parentEdgeId).toBeNull();
    expect(h2.parentEdgeId).toBeNull();
    // the halves occupy the old edge's exact slot in rootEdgeIds
    const slot = doc.rootEdgeIds.indexOf(e1);
    expect(next.rootEdgeIds.slice(slot, slot + 2)).toEqual(ins.edgeIds);
    const n = next.nodes[ins.nodeId];
    expect(n.kind).toBe("task");
    expect([n.title, n.x, n.y]).toEqual(["N", 5, 5]);
  });

  it("keeps the old sub-road on the half that still reaches the destination", () => {
    let { doc, e1 } = fixture();
    doc = run(doc, setEdgeColor(e1, "#f00"));
    const ex = expandEdge(e1);
    doc = run(doc, ex.recipe);
    const ins = insertNodeIntoEdge(e1, "goal", "N", "", { x: 5, y: 5 });
    const next = expectRoundTrip(doc, ins.recipe);
    const [h1, h2] = ins.edgeIds.map((id) => next.edges[id]);
    expect(h2.childEdgeIds).toEqual(ex.childEdgeIds);
    expect(next.edges[ex.childEdgeIds[0]].parentEdgeId).toBe(h2.id);
    expect(h1.childEdgeIds).toEqual([]);
    // both halves inherit the old road's color
    expect(h1.color).toBe("#f00");
    expect(h2.color).toBe("#f00");
  });

  it("splices the halves into the parent edge's child list at the same slot", () => {
    let { doc, e1 } = fixture();
    const ex = expandEdge(e1); // children [H -> mid, mid -> T1]
    doc = run(doc, ex.recipe);
    const ins = insertNodeIntoEdge(ex.childEdgeIds[0], "task", "N", "", { x: 1, y: 1 });
    const next = expectRoundTrip(doc, ins.recipe);
    expect(next.edges[e1].childEdgeIds).toEqual([...ins.edgeIds, ex.childEdgeIds[1]]);
    const [h1, h2] = ins.edgeIds.map((id) => next.edges[id]);
    expect(h1.parentEdgeId).toBe(e1);
    expect(h2.parentEdgeId).toBe(e1);
  });

  it("rejects records and missing edges", () => {
    const { doc, e1 } = fixture();
    expect(() => insertNodeIntoEdge(e1, "record", "R", "", { x: 0, y: 0 })).toThrow(DomainError);
    const ins = insertNodeIntoEdge("nope", "task", "N", "", { x: 0, y: 0 });
    expect(() => run(doc, ins.recipe)).toThrow(DomainError);
  });

  it("nudges the node off a stacked endpoint", () => {
    const { doc, e1, h } = fixture();
    const a = doc.nodes[h];
    const ins = insertNodeIntoEdge(e1, "task", "N", "", { x: a.x, y: a.y });
    const next = run(doc, ins.recipe);
    expect(next.nodes[ins.nodeId].y).toBe(a.y - 60);
  });
});

describe("summarizeEdges (B4)", () => {
  function chain() {
    // A -> B -> C as sibling root edges
    let doc = emptyDoc();
    const a = addFreeNode("goal", "A", "", { x: 0, y: 0 });
    const b = addFreeNode("goal", "B", "", { x: 10, y: 0 });
    const c = addFreeNode("goal", "C", "", { x: 20, y: 0 });
    const e1 = connectNodes(a.nodeId, b.nodeId);
    const e2 = connectNodes(b.nodeId, c.nodeId);
    for (const s of [a, b, c, e1, e2]) doc = run(doc, s.recipe);
    return { doc, a: a.nodeId, b: b.nodeId, c: c.nodeId, e1: e1.edgeId, e2: e2.edgeId };
  }

  it("folds a directed chain into one parent edge", () => {
    const { doc, a, c, e1, e2 } = chain();
    const sum = summarizeEdges([e2, e1]); // selection order must not matter
    const next = expectRoundTrip(doc, sum.recipe);
    const folded = next.edges[sum.newEdgeId];
    expect([folded.fromId, folded.toId]).toEqual([a, c]);
    expect(folded.childEdgeIds).toEqual([e1, e2]); // chain order
    expect(next.edges[e1].parentEdgeId).toBe(sum.newEdgeId);
    expect(next.rootEdgeIds).toEqual([sum.newEdgeId]);
  });

  it("rejects a star (3 boundary nodes)", () => {
    let doc = emptyDoc();
    const a = addFreeNode("goal", "A", "", { x: 0, y: 0 });
    const mk = (t: string) => addFreeNode("goal", t, "", { x: 1, y: 1 });
    const [b, c, d] = [mk("B"), mk("C"), mk("D")];
    const e1 = connectNodes(a.nodeId, b.nodeId);
    const e2 = connectNodes(a.nodeId, c.nodeId);
    const e3 = connectNodes(a.nodeId, d.nodeId);
    for (const s of [a, b, c, d, e1, e2, e3]) doc = run(doc, s.recipe);
    expect(() => run(doc, summarizeEdges([e1.edgeId, e2.edgeId, e3.edgeId]).recipe)).toThrow(DomainError);
  });

  it("rejects a disjoint selection", () => {
    const { doc, e1 } = chain();
    const d = addFreeNode("goal", "D", "", { x: 0, y: 0 });
    const e = addFreeNode("goal", "E", "", { x: 0, y: 0 });
    const e3 = connectNodes(d.nodeId, e.nodeId);
    let next = run(doc, d.recipe);
    next = run(next, e.recipe);
    next = run(next, e3.recipe);
    expect(() => run(next, summarizeEdges([e1, e3.edgeId]).recipe)).toThrow(DomainError);
  });

  it("rejects fewer than two edges", () => {
    const { doc, e1 } = chain();
    expect(() => run(doc, summarizeEdges([e1]).recipe)).toThrow(DomainError);
  });
});

describe("removeEdge", () => {
  it("re-homes children one level up and isolates untouched endpoints", () => {
    let { doc, e1, h, t1 } = fixture();
    const ex = expandEdge(e1);
    doc = run(doc, ex.recipe);
    const [c1, c2] = ex.childEdgeIds;
    const next = expectRoundTrip(doc, removeEdge(e1));
    // children rose to the root, keeping their own structure
    expect(next.rootEdgeIds).toContain(c1);
    expect(next.rootEdgeIds).toContain(c2);
    expect(next.edges[c1].parentEdgeId).toBeNull();
    // h still has edge e2 (to T2) so it is not isolated; the removed edge is gone
    expect(next.edges[e1]).toBeUndefined();
    expect(next.rootNodeIds).not.toContain(h);
    expect(next.rootNodeIds).not.toContain(t1);
  });

  it("isolated endpoints become root nodes", () => {
    const { doc, e2, t2 } = fixture();
    const next = run(doc, removeEdge(e2));
    expect(next.edges[e2]).toBeUndefined();
    expect(next.rootNodeIds).toContain(t2);
  });
});

describe("removeNode", () => {
  it("removes the node and its incident edges, re-homing grandchildren edges", () => {
    let { doc, t1, e1 } = fixture();
    doc = run(doc, expandEdge(e1).recipe);
    const next = expectRoundTrip(doc, removeNode(t1));
    expect(next.nodes[t1]).toBeUndefined();
    // T1's incident edges are gone; their children (from expand) survive at root
    expect(Object.values(next.edges).some((e) => e.fromId === t1 || e.toId === t1)).toBe(false);
    expect(next.rootNodeIds).not.toContain(t1);
  });

  it("removes an isolated node outright", () => {
    const { doc, iso } = fixture();
    const next = run(doc, removeNode(iso));
    expect(next.nodes[iso]).toBeUndefined();
    expect(next.rootNodeIds).not.toContain(iso);
  });
});

describe("small edits", () => {
  it("moveNode / renameNode / colors / bend round-trip through inverse patches", () => {
    const { doc, t1, e1 } = fixture();
    let next = expectRoundTrip(doc, moveNode(t1, 42, 43));
    expect(next.nodes[t1].x).toBe(42);
    next = expectRoundTrip(doc, renameNode(t1, "Renamed"));
    expect(next.nodes[t1].title).toBe("Renamed");
    next = expectRoundTrip(doc, setNodeColor(t1, "red"));
    expect(next.nodes[t1].color).toBe("red");
    next = expectRoundTrip(doc, setEdgeBend(e1, { x: 1, y: 2 }));
    expect(next.edges[e1].bend).toEqual({ x: 1, y: 2 });
    next = expectRoundTrip(next, setEdgeBend(e1, null));
    expect(next.edges[e1].bend).toBeUndefined();
  });

  it("moveNode to the same spot is a no-op (no patches, no undo entry)", () => {
    const { doc, t1 } = fixture();
    const [, patches] = produceWithPatches(doc, moveNode(t1, doc.nodes[t1].x, doc.nodes[t1].y));
    expect(patches).toHaveLength(0);
  });
});

describe("notes", () => {
  it("adds newest-first, updates, removes; blank text is a no-op", () => {
    let { doc, t1 } = fixture();
    const n1 = addNote(t1, "first");
    doc = expectRoundTrip(doc, n1.recipe);
    const n2 = addNote(t1, "second");
    doc = run(doc, n2.recipe);
    expect(doc.nodes[t1].notes.map((n) => n.text)).toEqual(["second", "first"]);
    doc = expectRoundTrip(doc, updateNote(t1, n1.noteId, "first v2"));
    expect(doc.nodes[t1].notes[1].text).toBe("first v2");
    doc = expectRoundTrip(doc, removeNote(t1, n1.noteId));
    expect(doc.nodes[t1].notes.map((n) => n.text)).toEqual(["second"]);
    const blank = addNote(t1, "   ");
    const [, patches] = produceWithPatches(doc, blank.recipe);
    expect(patches).toHaveLength(0);
  });
});

describe("pastePayload", () => {
  it("pastes an edge snapshot with fresh ids and identical structure", () => {
    let { doc, e1, t1 } = fixture();
    doc = run(doc, expandEdge(e1).recipe);
    doc = run(doc, setEdgeBend(e1, { x: 5, y: 6 }));
    const payload = snapshotEdge(doc, e1);
    const paste = pastePayload(payload, { x: 500, y: 500 });
    const next = expectRoundTrip(doc, paste.recipe);
    // fresh ids, same shape: 3 nodes, 3 edges (1 root + 2 children)
    expect(paste.nodeIds).toHaveLength(3);
    expect(paste.rootEdgeIds).toHaveLength(1);
    expect(paste.nodeIds).not.toContain(t1);
    const root = next.edges[paste.rootEdgeIds[0]];
    expect(root.childEdgeIds).toHaveLength(2);
    expect(root.bend).toBeDefined();
    expect(next.rootEdgeIds).toContain(paste.rootEdgeIds[0]);
  });
});


describe("setNodeDetail", () => {
  it("sets and clears a goal's description", () => {
    const { doc, h } = fixture();
    const next = expectRoundTrip(doc, setNodeDetail(h, "feel great"));
    expect(next.nodes[h].description).toBe("feel great");
    const cleared = run(next, setNodeDetail(h, "   "));
    expect(cleared.nodes[h].description).toBeUndefined();
  });

  it("sets a record's note and no-ops on tasks", () => {
    let { doc, t1 } = fixture();
    const r = addFreeNode("record", "R", "", { x: 0, y: 0 });
    doc = run(doc, r.recipe);
    doc = expectRoundTrip(doc, setNodeDetail(r.nodeId, "it happened"));
    expect(doc.nodes[r.nodeId].note).toBe("it happened");
    const [, patches] = produceWithPatches(doc, setNodeDetail(t1, "nope"));
    expect(patches).toHaveLength(0);
  });
});
