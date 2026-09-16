import * as SQLite from "expo-sqlite";

import { EdgeData, Id, LifeMapDoc, NodeData } from "@/domain/doc";

// ---------- schema ----------
// nodes carry their kind-specific fields as a JSON blob in `data`; edges
// store the tree structure (parent_edge_id + position among siblings).
// Zoom/selection stay in memory — they are pure view state.

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  color TEXT,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  node1_id TEXT NOT NULL,
  node2_id TEXT NOT NULL,
  parent_edge_id TEXT,
  position INTEGER NOT NULL,
  layer INTEGER NOT NULL,
  color TEXT,
  bend_x REAL,
  bend_y REAL
);
`;

// ---------- migrations ----------
// Existing installs are user_version 0. Each entry migrates v -> v+1.

async function migrate0to1(db: SQLite.SQLiteDatabase): Promise<void> {
  // rename the legacy occuredAt key in record JSON blobs to occurredAt
  const rows = await db.getAllAsync<{ id: string; data: string }>(
    "SELECT id, data FROM nodes WHERE kind = 'record'",
  );
  for (const row of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(row.data || "{}");
    } catch {
      continue; // corrupt rows are handled (and reported) at load time
    }
    if (typeof data.occuredAt === "number" && typeof data.occurredAt !== "number") {
      data.occurredAt = data.occuredAt;
      delete data.occuredAt;
      await db.runAsync("UPDATE nodes SET data = ? WHERE id = ?", [JSON.stringify(data), row.id]);
    }
  }
  await db.execAsync("PRAGMA user_version = 1");
}

const MIGRATIONS: ((db: SQLite.SQLiteDatabase) => Promise<void>)[] = [migrate0to1];

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const from = row?.user_version ?? 0;
  for (let v = from; v < MIGRATIONS.length; v++) {
    await MIGRATIONS[v](db);
  }
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("lifemap.db")
      .then(async (db) => {
        await db.execAsync(SCHEMA);
        await db.execAsync("PRAGMA foreign_keys = ON");
        await migrate(db);
        return db;
      })
      .catch((err) => {
        // do not cache a rejected promise: the next caller retries
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

// ---------- row shapes (the persisted form) ----------

export interface NodeRow {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  color: string | null;
  data: string;
}

export interface NoteRow {
  id: string;
  node_id: string;
  text: string;
  created_at: number;
  updated_at: number;
  position: number;
}

export interface EdgeRow {
  id: string;
  node1_id: string;
  node2_id: string;
  parent_edge_id: string | null;
  position: number;
  layer: number;
  color: string | null;
  bend_x: number | null;
  bend_y: number | null;
}

// ---------- doc <-> rows (pure; unit-tested without sqlite) ----------

function serializeKindData(node: NodeData): string {
  if (node.kind === "goal") {
    return JSON.stringify({
      description: node.description ?? null,
      targetDate: node.targetDate ?? null,
      completedAt: node.completedAt ?? null,
    });
  }
  if (node.kind === "task") {
    return JSON.stringify({
      status: node.status ?? "todo",
      startedAt: node.startedAt ?? null,
      completedAt: node.completedAt ?? null,
      synthetic: node.synthetic ?? null,
    });
  }
  if (node.kind === "record") {
    return JSON.stringify({
      note: node.note ?? "",
      createdAt: node.createdAt ?? null,
      occurredAt: node.occurredAt ?? null,
    });
  }
  return "{}";
}

function millis(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function docToRows(doc: LifeMapDoc): { nodes: NodeRow[]; notes: NoteRow[]; edges: EdgeRow[] } {
  const nodes: NodeRow[] = [];
  const notes: NoteRow[] = [];
  for (const node of Object.values(doc.nodes)) {
    nodes.push({
      id: node.id,
      kind: node.kind,
      title: node.title,
      x: node.x,
      y: node.y,
      color: node.color ?? null,
      data: serializeKindData(node),
    });
    node.notes.forEach((note, i) => {
      notes.push({
        id: note.id,
        node_id: node.id,
        text: note.text,
        created_at: note.createdAt,
        updated_at: note.updatedAt,
        position: i,
      });
    });
  }

  // walk the edge tree so position = index among siblings and layer = depth
  const edges: EdgeRow[] = [];
  const collect = (id: Id, position: number, layer: number, parentEdgeId: Id | null) => {
    const e = doc.edges[id];
    if (!e) return;
    edges.push({
      id: e.id,
      node1_id: e.fromId,
      node2_id: e.toId,
      parent_edge_id: parentEdgeId,
      position,
      layer,
      color: e.color ?? null,
      bend_x: e.bend?.x ?? null,
      bend_y: e.bend?.y ?? null,
    });
    e.childEdgeIds.forEach((childId, i) => collect(childId, i, layer + 1, e.id));
  };
  doc.rootEdgeIds.forEach((id, i) => collect(id, i, 0, null));
  return { nodes, notes, edges };
}

function parseNodeRow(row: NodeRow): NodeData | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(row.data || "{}");
  } catch (err) {
    console.warn(`[mapDb] skipping node ${row.id}: corrupt data blob`, err);
    return null;
  }
  const node: NodeData = {
    id: row.id,
    kind: (row.kind as NodeData["kind"]) ?? "goal",
    x: row.x,
    y: row.y,
    title: row.title,
    notes: [],
  };
  if (row.color !== null) node.color = row.color;
  if (node.kind === "task") {
    node.status = (data.status as NodeData["status"]) ?? "todo";
    const startedAt = millis(data.startedAt);
    const completedAt = millis(data.completedAt);
    if (startedAt !== undefined) node.startedAt = startedAt;
    if (completedAt !== undefined) node.completedAt = completedAt;
    if (data.synthetic === true) node.synthetic = true;
  } else if (node.kind === "record") {
    node.note = typeof data.note === "string" ? data.note : "";
    // occurredAt renamed from the legacy occuredAt (migration 1 rewrites the
    // blobs; the fallback keeps pre-migration reads safe)
    node.occurredAt = millis(data.occurredAt) ?? millis(data.occuredAt) ?? Date.now();
    node.createdAt = millis(data.createdAt) ?? Date.now();
  } else {
    if (typeof data.description === "string") node.description = data.description;
    const targetDate = millis(data.targetDate);
    const completedAt = millis(data.completedAt);
    if (targetDate !== undefined) node.targetDate = targetDate;
    if (completedAt !== undefined) node.completedAt = completedAt;
  }
  return node;
}

export function rowsToDoc(nodeRows: NodeRow[], noteRows: NoteRow[], edgeRows: EdgeRow[]): LifeMapDoc {
  const doc: LifeMapDoc = { schemaVersion: 2, nodes: {}, edges: {}, rootNodeIds: [], rootEdgeIds: [] };

  for (const row of nodeRows) {
    const node = parseNodeRow(row);
    if (node) doc.nodes[node.id] = node;
  }

  for (const row of noteRows) {
    doc.nodes[row.node_id]?.notes.push({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  // parents sit one layer below their children, so ordering by layer
  // guarantees every parent edge exists before its children are linked
  const ordered = [...edgeRows].sort((a, b) => a.layer - b.layer || a.position - b.position);
  const connectedNodeIds = new Set<Id>();
  for (const row of ordered) {
    if (!doc.nodes[row.node1_id] || !doc.nodes[row.node2_id]) continue; // orphan from a skipped node
    if (row.parent_edge_id !== null && !doc.edges[row.parent_edge_id]) continue;
    const edge: EdgeData = {
      id: row.id,
      fromId: row.node1_id,
      toId: row.node2_id,
      parentEdgeId: row.parent_edge_id,
      childEdgeIds: [],
    };
    if (row.color !== null) edge.color = row.color;
    if (row.bend_x !== null && row.bend_y !== null) {
      edge.bend = { x: row.bend_x, y: row.bend_y };
    }
    doc.edges[edge.id] = edge;
    if (row.parent_edge_id) doc.edges[row.parent_edge_id].childEdgeIds.push(edge.id);
    else doc.rootEdgeIds.push(edge.id);
    connectedNodeIds.add(row.node1_id);
    connectedNodeIds.add(row.node2_id);
  }

  // nodes untouched by any edge are the isolated root nodes
  for (const row of nodeRows) {
    if (doc.nodes[row.id] && !connectedNodeIds.has(row.id)) {
      doc.rootNodeIds.push(row.id);
    }
  }
  return doc;
}

// ---------- save: full rewrite inside one transaction ----------
// Correct at current scale; the queue below serializes writes so a queued
// save always persists the latest document.

export async function saveDoc(doc: LifeMapDoc): Promise<void> {
  const db = await getDb();
  const rows = docToRows(doc);
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync("DELETE FROM notes; DELETE FROM edges; DELETE FROM nodes;");
    for (const row of rows.nodes) {
      await txn.runAsync("INSERT INTO nodes (id, kind, title, x, y, color, data) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        row.id,
        row.kind,
        row.title,
        row.x,
        row.y,
        row.color,
        row.data,
      ]);
    }
    for (const row of rows.notes) {
      await txn.runAsync(
        "INSERT INTO notes (id, node_id, text, created_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?)",
        [row.id, row.node_id, row.text, row.created_at, row.updated_at, row.position],
      );
    }
    for (const row of rows.edges) {
      await txn.runAsync(
        "INSERT INTO edges (id, node1_id, node2_id, parent_edge_id, position, layer, color, bend_x, bend_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          row.id,
          row.node1_id,
          row.node2_id,
          row.parent_edge_id,
          row.position,
          row.layer,
          row.color,
          row.bend_x,
          row.bend_y,
        ],
      );
    }
  });
}

// ---------- load ----------

// returns null when the database has never been written to, so the caller
// can seed initial content
export async function loadDoc(): Promise<LifeMapDoc | null> {
  const db = await getDb();
  const nodeRows = await db.getAllAsync<NodeRow>("SELECT * FROM nodes");
  if (nodeRows.length === 0) {
    return null;
  }
  // notes are read in position order; edge ordering happens inside rowsToDoc
  const noteRows = await db.getAllAsync<NoteRow>("SELECT * FROM notes ORDER BY position ASC");
  const edgeRows = await db.getAllAsync<EdgeRow>("SELECT * FROM edges");
  return rowsToDoc(nodeRows, noteRows, edgeRows);
}

// ---------- save queue ----------
// mutations arrive faster than sqlite writes; chaining keeps saves ordered
// and a queued save naturally persists the latest in-memory document

let saveQueue: Promise<void> = Promise.resolve();

export function scheduleSave(doc: LifeMapDoc): void {
  saveQueue = saveQueue
    .then(() => saveDoc(doc))
    .catch((err) => console.warn("[mapDb] save failed", err));
}
