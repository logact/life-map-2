import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { enablePatches, produceWithPatches } from "immer";

import { addChildNode, addFreeNode, expandEdge, moveNode, renameNode } from "../commands";
import { emptyDoc, LifeMapDoc } from "../doc";
import { buildDemoDoc } from "../demoDoc";
import { docToRows, loadDoc, rowsToDoc } from "@/data/mapDb";
import { createDocStore } from "@/state/docStore";

enablePatches();

// docStore imports mapDb (expo-sqlite); the store tests don't touch the DB,
// so only the two side-effecting functions are mocked
const savedDocs: LifeMapDoc[] = [];
jest.mock("@/data/mapDb", () => ({
  ...jest.requireActual<typeof import("@/data/mapDb")>("@/data/mapDb"),
  scheduleSave: jest.fn((doc: LifeMapDoc) => savedDocs.push(doc)),
  loadDoc: jest.fn(),
}));


const mockLoadDoc = loadDoc as jest.MockedFunction<typeof loadDoc>;

beforeEach(() => {
  savedDocs.length = 0;
  mockLoadDoc.mockReset();
});

describe("docStore", () => {
  it("run applies the recipe, records history, saves", () => {
    const store = createDocStore();
    const add = addFreeNode("goal", "G", "", { x: 1, y: 2 });
    store.getState().run(add.recipe);
    const s = store.getState();
    expect(s.doc.nodes[add.nodeId]?.title).toBe("G");
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
    expect(savedDocs).toHaveLength(1);
  });

  it("no-op recipes create no history and no save", () => {
    const store = createDocStore();
    const add = addFreeNode("goal", "G", "", { x: 1, y: 2 });
    store.getState().run(add.recipe);
    savedDocs.length = 0;
    // move to the same coordinates produces zero patches
    store.getState().run(moveNode(add.nodeId, 1, 2));
    expect(savedDocs).toHaveLength(0);
    store.getState().undo(); // must undo the ADD, not a phantom no-op
    expect(store.getState().doc.nodes[add.nodeId]).toBeUndefined();
  });

  it("undo/redo walks the patch history exactly", () => {
    const store = createDocStore();
    const add = addFreeNode("goal", "G", "", { x: 1, y: 2 });
    store.getState().run(add.recipe);
    store.getState().run(renameNode(add.nodeId, "G2"));
    store.getState().run(moveNode(add.nodeId, 50, 60));

    store.getState().undo();
    expect(store.getState().doc.nodes[add.nodeId]).toMatchObject({ title: "G2", x: 1, y: 2 });
    store.getState().undo();
    expect(store.getState().doc.nodes[add.nodeId]?.title).toBe("G");
    store.getState().undo();
    expect(store.getState().doc.nodes[add.nodeId]).toBeUndefined();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);

    store.getState().redo();
    store.getState().redo();
    expect(store.getState().doc.nodes[add.nodeId]).toMatchObject({ title: "G2", x: 1, y: 2 });
  });

  it("a new edit clears the redo stack", () => {
    const store = createDocStore();
    const add = addFreeNode("goal", "G", "", { x: 1, y: 2 });
    store.getState().run(add.recipe);
    store.getState().run(renameNode(add.nodeId, "G2"));
    store.getState().undo(); // back to "G"; redo now offers "G2"
    expect(store.getState().canRedo).toBe(true);
    store.getState().run(renameNode(add.nodeId, "fresh edit"));
    expect(store.getState().canRedo).toBe(false);
    store.getState().redo(); // no-op
    expect(store.getState().doc.nodes[add.nodeId]?.title).toBe("fresh edit");
  });

  it("a thrown invariant applies nothing and records nothing", () => {
    const store = createDocStore();
    const add = addFreeNode("record", "R", "", { x: 0, y: 0 });
    store.getState().run(add.recipe);
    const before = store.getState().doc;
    expect(() =>
      store.getState().run(addChildNode(add.nodeId, "task", "X", "", { x: 0, y: 0 }).recipe),
    ).toThrow();
    expect(store.getState().doc).toBe(before);
    expect(store.getState().canUndo).toBe(true); // only the add
    store.getState().undo();
    expect(store.getState().canUndo).toBe(false);
  });

  it("load falls back to a seeded demo doc on failure — never a blank screen (B2)", async () => {
    mockLoadDoc.mockRejectedValue(new Error("db exploded"));
    const store = createDocStore();
    await store.getState().load({ width: 800, height: 600 });
    const s = store.getState();
    expect(s.loaded).toBe(true);
    expect(Object.keys(s.doc.nodes).length).toBeGreaterThan(0); // demo content
    expect(savedDocs.length).toBeGreaterThan(0); // seeded doc persisted
  });

  it("load uses the persisted doc when present", async () => {
    const persisted = buildDemoDoc(100, 100);
    mockLoadDoc.mockResolvedValue(persisted);
    const store = createDocStore();
    await store.getState().load({ width: 800, height: 600 });
    expect(store.getState().doc).toBe(persisted);
    expect(savedDocs).toHaveLength(0);
  });
});

describe("docToRows/rowsToDoc", () => {
  it("round-trips the demo doc exactly", () => {
    const doc = buildDemoDoc(400, 300);
    const rows = docToRows(doc);
    expect(rowsToDoc(rows.nodes, rows.notes, rows.edges)).toEqual(doc);
  });

  it("computes layer from tree depth for storage", () => {
    let doc = emptyDoc();
    const h = addFreeNode("goal", "H", "", { x: 0, y: 0 });
    const t = addChildNode(h.nodeId, "task", "T", "", { x: 1, y: 1 });
    for (const c of [h, t]) doc = produceWithPatches(doc, c.recipe)[0];
    doc = produceWithPatches(doc, expandEdgeRecipe(t.edgeId))[0];
    const rows = docToRows(doc);
    const byId = new Map(rows.edges.map((r) => [r.id, r]));
    expect(byId.get(t.edgeId)!.layer).toBe(0);
    for (const childId of t.edgeId ? rows.edges.filter((r) => r.parent_edge_id === t.edgeId) : []) {
      expect(childId.layer).toBe(1);
    }
  });

  it("skips corrupt node rows and their orphan edges instead of throwing (B2)", () => {
    const doc = buildDemoDoc(400, 300);
    const rows = docToRows(doc);
    rows.nodes[0].data = "{not json";
    const corruptNodeId = rows.nodes[0].id;
    const loaded = rowsToDoc(rows.nodes, rows.notes, rows.edges);
    expect(loaded.nodes[corruptNodeId]).toBeUndefined();
    for (const e of Object.values(loaded.edges)) {
      expect(e.fromId).not.toBe(corruptNodeId);
      expect(e.toId).not.toBe(corruptNodeId);
    }
  });

  it("reads the legacy occuredAt key (pre-migration data)", () => {
    const doc = buildDemoDoc(400, 300);
    const rows = docToRows(doc);
    const recRow = rows.nodes.find((r) => r.kind === "record")!;
    const data = JSON.parse(recRow.data);
    data.occuredAt = data.occurredAt;
    delete data.occurredAt;
    recRow.data = JSON.stringify(data);
    const loaded = rowsToDoc(rows.nodes, rows.notes, rows.edges);
    expect(loaded.nodes[recRow.id].occurredAt).toBe(data.occuredAt);
  });
});

function expandEdgeRecipe(edgeId: string) {
  return expandEdge(edgeId).recipe;
}
