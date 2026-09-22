import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { enablePatches, produce, produceWithPatches } from "immer";

import { addChildNode, addFreeNode, expandEdge, moveNode, renameNode, replaceDoc, setNodeRecurrence, transitionNodeStatus } from "../commands";
import { emptyDoc, LifeMapDoc } from "../doc";
import { buildSeedDoc } from "../seedDoc";
import { docToRows, getMeta, loadDoc, rowsToDoc, setMeta } from "@/data/mapDb";
import { createDocStore } from "@/state/docStore";

enablePatches();

// docStore imports mapDb (expo-sqlite); the store tests don't touch the DB,
// so only the side-effecting functions are mocked
const savedDocs: LifeMapDoc[] = [];
jest.mock("@/data/mapDb", () => ({
  ...jest.requireActual<typeof import("@/data/mapDb")>("@/data/mapDb"),
  scheduleSave: jest.fn((doc: LifeMapDoc) => savedDocs.push(doc)),
  loadDoc: jest.fn(),
  getMeta: jest.fn(),
  setMeta: jest.fn(),
}));


const mockLoadDoc = loadDoc as jest.MockedFunction<typeof loadDoc>;
const mockGetMeta = getMeta as jest.MockedFunction<typeof getMeta>;
const mockSetMeta = setMeta as jest.MockedFunction<typeof setMeta>;

beforeEach(() => {
  savedDocs.length = 0;
  mockLoadDoc.mockReset();
  // default: the seed flag is already written, so a persisted doc loads as-is
  mockGetMeta.mockReset().mockResolvedValue("1");
  mockSetMeta.mockReset().mockResolvedValue(undefined);
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

  it("load resolves once per session: concurrent callers ride one promise", async () => {
    const store = createDocStore();
    mockLoadDoc.mockResolvedValue(null); // empty DB → the seed path
    const [a, b] = await Promise.all([
      store.getState().load({ width: 800, height: 600 }),
      store.getState().load({ width: 800, height: 600 }),
    ]);
    expect(a).toBe(b);
    expect(mockLoadDoc).toHaveBeenCalledTimes(1);
    expect(store.getState().loaded).toBe(true);
    // a later remount does not reload over in-memory edits
    await store.getState().load({ width: 800, height: 600 });
    expect(mockLoadDoc).toHaveBeenCalledTimes(1);
  });

  it("the node-focus handoff queues and clears a node id", () => {
    const store = createDocStore();
    expect(store.getState().pendingNodeFocusId).toBeNull();
    store.getState().requestNodeFocus("n1");
    expect(store.getState().pendingNodeFocusId).toBe("n1");
    store.getState().clearNodeFocus();
    expect(store.getState().pendingNodeFocusId).toBeNull();
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

  it("load falls back to a seeded doc on failure — never a blank screen (B2)", async () => {
    mockLoadDoc.mockRejectedValue(new Error("db exploded"));
    const store = createDocStore();
    await store.getState().load({ width: 800, height: 600 });
    const s = store.getState();
    expect(s.loaded).toBe(true);
    expect(Object.keys(s.doc.nodes).length).toBeGreaterThan(0); // seed content
    expect(savedDocs.length).toBeGreaterThan(0); // seeded doc persisted
  });

  it("a pre-seed install gets the seed once, then keeps the user's map", async () => {
    // an install from before the seed existed: content is present but the
    // seed_applied flag was never written
    const legacyAdd = addFreeNode("goal", "Old demo map", "", { x: 0, y: 0 });
    const legacy = produce(emptyDoc(), legacyAdd.recipe);
    mockLoadDoc.mockResolvedValue(legacy);
    mockGetMeta.mockResolvedValue(null);
    const store = createDocStore();
    await store.getState().load({ width: 800, height: 600 });
    const s = store.getState();
    expect(s.loaded).toBe(true);
    expect(s.doc).not.toBe(legacy);
    expect(Object.values(s.doc.nodes).some((n) => n.title === "Make this map yours")).toBe(true);
    expect(savedDocs.length).toBeGreaterThan(0); // the replacement is persisted
    expect(mockSetMeta).toHaveBeenCalledWith("seed_applied", "1");

    // next launch: the flag is set, so the (possibly edited) map loads untouched
    const seeded = store.getState().doc;
    mockLoadDoc.mockResolvedValue(seeded);
    mockGetMeta.mockResolvedValue("1");
    const store2 = createDocStore();
    await store2.getState().load({ width: 800, height: 600 });
    expect(store2.getState().doc).toBe(seeded);
    expect(savedDocs.length).toBe(1); // nothing re-saved
  });

  it("load uses the persisted doc when present", async () => {
    const persisted = buildSeedDoc(100, 100);
    mockLoadDoc.mockResolvedValue(persisted);
    const store = createDocStore();
    await store.getState().load({ width: 800, height: 600 });
    expect(store.getState().doc).toBe(persisted);
    expect(savedDocs).toHaveLength(0);
  });

  it("replacing the whole doc (seed loader) is one undoable edit", () => {
    const store = createDocStore();
    const add = addFreeNode("goal", "G", "", { x: 1, y: 2 });
    store.getState().run(add.recipe);

    const seed = buildSeedDoc(400, 300);
    store.getState().run(replaceDoc(seed));
    const s = store.getState();
    expect(s.doc.nodes[add.nodeId]).toBeUndefined();
    expect(Object.keys(s.doc.nodes).length).toBe(Object.keys(seed.nodes).length);
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);

    // a single undo restores the pre-replacement map exactly
    store.getState().undo();
    const restored = store.getState().doc;
    expect(Object.keys(restored.nodes)).toEqual([add.nodeId]);
    expect(restored.edges).toEqual({});
    expect(store.getState().canRedo).toBe(true);
  });
});

describe("docToRows/rowsToDoc", () => {
  it("round-trips the seed doc exactly", () => {
    const doc = buildSeedDoc(400, 300);
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
    const doc = buildSeedDoc(400, 300);
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

  it("round-trips the recurrence rule and log", () => {
    let doc = emptyDoc();
    const t = addFreeNode("task", "T", "", { x: 0, y: 0 });
    doc = produceWithPatches(doc, t.recipe)[0];
    doc = produceWithPatches(
      doc,
      setNodeRecurrence(t.nodeId, { freq: "weekly", interval: 2, weekdays: [1, 3], anchor: 123 }),
    )[0];
    doc = produceWithPatches(doc, transitionNodeStatus(t.nodeId, "complete", 1000))[0];
    doc = produceWithPatches(doc, transitionNodeStatus(t.nodeId, "complete", 2000))[0];
    const rows = docToRows(doc);
    const loaded = rowsToDoc(rows.nodes, rows.notes, rows.edges);
    expect(loaded.nodes[t.nodeId].recur).toEqual({ freq: "weekly", interval: 2, weekdays: [1, 3], anchor: 123 });
    expect(loaded.nodes[t.nodeId].log).toEqual([1000, 2000]);
  });

  it("reads the legacy occuredAt key (pre-migration data)", () => {
    const doc = buildSeedDoc(400, 300);
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
