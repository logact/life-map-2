import { describe, expect, it } from "@jest/globals";
import { produce } from "immer";

import { addChildNode, addFreeNode, Recipe } from "@/domain/commands";
import { emptyDoc, LifeMapDoc } from "@/domain/doc";
import { deriveViewModel } from "../viewModel";

function run(doc: LifeMapDoc, recipe: Recipe): LifeMapDoc {
  return produce(doc, recipe);
}

// goal G -> task T -> record R (both edges top-level), plus an isolated
// task and an isolated record
function fixture() {
  let doc = emptyDoc();
  const g = addFreeNode("goal", "G", "", { x: 0, y: 0 });
  const t = addChildNode(g.nodeId, "task", "T", "", { x: 10, y: 10 });
  const r = addChildNode(t.nodeId, "record", "R", "", { x: 20, y: 20 });
  const ti = addFreeNode("task", "TI", "", { x: 100, y: 100 });
  const ri = addFreeNode("record", "RI", "", { x: 200, y: 200 });
  for (const c of [g, t, r, ti, ri]) doc = run(doc, c.recipe);
  return {
    doc,
    g: g.nodeId,
    t: t.nodeId,
    r: r.nodeId,
    ti: ti.nodeId,
    ri: ri.nodeId,
    gtEdge: t.edgeId,
    trEdge: r.edgeId,
  };
}

const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime();
const NO_ZOOM = new Set<string>();

// issue #48: records are hidden on the map by default; the eye toggle
// (showRecords) is the only way they enter the view model
describe("deriveViewModel record visibility", () => {
  it("hides record nodes and their edges by default", () => {
    const f = fixture();
    const vm = deriveViewModel(f.doc, NO_ZOOM, NOW, false);
    const nodeIds = vm.nodes.map((n) => n.id);
    expect(nodeIds).toEqual(expect.arrayContaining([f.g, f.t, f.ti]));
    expect(nodeIds).not.toContain(f.r);
    expect(nodeIds).not.toContain(f.ri); // isolated records hide too
    const edgeIds = vm.edges.map((e) => e.id);
    expect(edgeIds).toContain(f.gtEdge); // goal -> task stays
    expect(edgeIds).not.toContain(f.trEdge); // task -> record drops
  });

  it("restores records and their edges when showRecords is on", () => {
    const f = fixture();
    const vm = deriveViewModel(f.doc, NO_ZOOM, NOW, true);
    const nodeIds = vm.nodes.map((n) => n.id);
    expect(nodeIds).toEqual(expect.arrayContaining([f.g, f.t, f.r, f.ti, f.ri]));
    const edgeIds = vm.edges.map((e) => e.id);
    expect(edgeIds).toEqual(expect.arrayContaining([f.gtEdge, f.trEdge]));
  });
});
