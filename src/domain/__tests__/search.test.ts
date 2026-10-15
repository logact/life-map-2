import { describe, expect, it } from "@jest/globals";

import { enablePatches, produce } from "immer";

import { addChildNode, addFreeNode, addNote, expandEdge, summarizeEdges } from "../commands";
import { emptyDoc, LifeMapDoc } from "../doc";
import { searchNodes, searchNotes } from "../search";

enablePatches();

function apply(doc: LifeMapDoc, recipe: (draft: LifeMapDoc) => void): LifeMapDoc {
  return produce(doc, recipe);
}

describe("searchNodes", () => {
  it("matches titles case-insensitively, by substring", () => {
    let doc = emptyDoc();
    doc = apply(doc, addFreeNode("goal", "Ship the app", "", { x: 0, y: 0 }).recipe);
    doc = apply(doc, addFreeNode("task", "Buy groceries", "", { x: 100, y: 0 }).recipe);

    expect(searchNodes(doc, "SHIP").map((n) => n.title)).toEqual(["Ship the app"]);
    expect(searchNodes(doc, "app").map((n) => n.title)).toEqual(["Ship the app"]);
    expect(searchNodes(doc, "zzz")).toEqual([]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    let doc = emptyDoc();
    doc = apply(doc, addFreeNode("goal", "Ship the app", "", { x: 0, y: 0 }).recipe);
    expect(searchNodes(doc, "")).toEqual([]);
    expect(searchNodes(doc, "   ")).toEqual([]);
  });

  it("skips synthetic expand midpoints (their A-B titles are structure)", () => {
    let doc = emptyDoc();
    const a = addFreeNode("goal", "Alpha", "", { x: 0, y: 0 });
    doc = apply(doc, a.recipe);
    const b = addChildNode(a.nodeId, "task", "Beta", "", { x: 0, y: -100 });
    doc = apply(doc, b.recipe);
    doc = apply(doc, expandEdge(b.edgeId).recipe);

    // the midpoint's title is "Alpha-Beta"; a query that matches only it
    // must come back empty
    expect(searchNodes(doc, "alpha-beta")).toEqual([]);
    expect(searchNodes(doc, "alpha").map((n) => n.title)).toEqual(["Alpha"]);
  });

  it("finds nodes hidden inside a collapsed (summarized) layer", () => {
    let doc = emptyDoc();
    const a = addFreeNode("goal", "Start", "", { x: 0, y: 0 });
    doc = apply(doc, a.recipe);
    const m = addChildNode(a.nodeId, "task", "Middle step", "", { x: 0, y: -100 });
    doc = apply(doc, m.recipe);
    const z = addChildNode(m.nodeId, "goal", "End", "", { x: 0, y: -200 });
    doc = apply(doc, z.recipe);
    // fold the chain into one parent edge: "Middle step" is now hidden
    // inside the collapsed road
    doc = apply(doc, summarizeEdges([m.edgeId, z.edgeId]).recipe);

    expect(searchNodes(doc, "middle").map((n) => n.id)).toEqual([m.nodeId]);
  });
});

describe("searchNotes", () => {
  it("matches note text and returns the owning node", () => {
    let doc = emptyDoc();
    const g = addFreeNode("goal", "Ship the app", "", { x: 0, y: 0 });
    doc = apply(doc, g.recipe);
    doc = apply(doc, addNote(g.nodeId, "remember the store screenshots").recipe);

    const results = searchNotes(doc, "SCREENSHOTS");
    expect(results).toHaveLength(1);
    expect(results[0].node.id).toBe(g.nodeId);
    expect(results[0].note.text).toBe("remember the store screenshots");
  });

  it("returns nothing for an empty query", () => {
    let doc = emptyDoc();
    const g = addFreeNode("goal", "Ship the app", "", { x: 0, y: 0 });
    doc = apply(doc, g.recipe);
    doc = apply(doc, addNote(g.nodeId, "a note").recipe);
    expect(searchNotes(doc, " ")).toEqual([]);
  });
});
