import * as SQLite from "expo-sqlite";

import { Edge } from "@/domain/edge";
import Goal from "@/domain/goal";
import { LifeMap } from "@/domain/lifeMap";
import { isGoalNode, isRecordNode, isTaskNode, Node } from "@/domain/node";
import { Record as RecordNode } from "@/domain/record";
import { Status } from "@/domain/status";
import { Task } from "@/domain/task";

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

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("lifemap.db").then(async (db) => {
      await db.execAsync(SCHEMA);
      return db;
    });
  }
  return dbPromise;
}

// ---------- kind-specific fields <-> JSON ----------

function serializeKindData(node: Node): string {
  if (isGoalNode(node)) {
    return JSON.stringify({
      description: node.description ?? null,
      targetDate: node.targetDate?.getTime() ?? null,
      completedAt: node.completedAt?.getTime() ?? null,
    });
  }
  if (isTaskNode(node)) {
    return JSON.stringify({
      status: node.status,
      startedAt: node.startedAt?.getTime() ?? null,
      completedAt: node.completedAt?.getTime() ?? null,
    });
  }
  if (isRecordNode(node)) {
    return JSON.stringify({
      note: node.note,
      createdAt: node.createdAt.getTime(),
      occuredAt: node.occuredAt.getTime(),
    });
  }
  return "{}";
}

export interface NodeRow {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  color: string | null;
  data: string;
}

function toMillis(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function deserializeNode(row: NodeRow): Node {
  const data = JSON.parse(row.data || "{}");
  let node: Node;
  if (row.kind === "task") {
    const task = new Task(row.x, row.y, row.title, [], []);
    task.status = (data.status as Status) ?? "todo";
    const startedAt = toMillis(data.startedAt);
    const completedAt = toMillis(data.completedAt);
    if (startedAt !== null) task.startedAt = new Date(startedAt);
    if (completedAt !== null) task.completedAt = new Date(completedAt);
    node = task;
  } else if (row.kind === "record") {
    const record = new RecordNode(
      row.x,
      row.y,
      row.title,
      [],
      [],
      typeof data.note === "string" ? data.note : "",
      new Date(toMillis(data.occuredAt) ?? Date.now()),
    );
    record.createdAt = new Date(toMillis(data.createdAt) ?? Date.now());
    node = record;
  } else {
    const goal = new Goal(row.x, row.y, row.title, [], []);
    if (typeof data.description === "string") goal.description = data.description;
    const targetDate = toMillis(data.targetDate);
    const completedAt = toMillis(data.completedAt);
    if (targetDate !== null) goal.targetDate = new Date(targetDate);
    if (completedAt !== null) goal.completedAt = new Date(completedAt);
    node = goal;
  }
  node.id = row.id;
  node.color = row.color ?? undefined;
  return node;
}

// ---------- snapshots: map <-> plain rows ----------
// A snapshot is the same row shape the database uses, held in memory as a
// JSON-safe deep copy. Undo/redo restore a snapshot; save writes one out.

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

export interface LifeMapSnapshot {
  nodes: NodeRow[];
  notes: NoteRow[];
  edges: EdgeRow[];
}

export function snapshotLifeMap(map: LifeMap): LifeMapSnapshot {
  const nodes: NodeRow[] = [];
  const notes: NoteRow[] = [];
  for (const node of map.allNodes()) {
    nodes.push({
      id: node.id,
      kind: node.kind,
      title: node.title,
      x: node.x,
      y: node.y,
      color: node.color ?? null,
      data: serializeKindData(node),
    });
    for (let i = 0; i < node.notes.length; i++) {
      const note = node.notes[i];
      notes.push({
        id: note.id,
        node_id: node.id,
        text: note.text,
        created_at: note.createdAt.getTime(),
        updated_at: note.updatedAt.getTime(),
        position: i,
      });
    }
  }

  const edges: EdgeRow[] = [];
  const collectEdge = (edge: Edge, position: number) => {
    edges.push({
      id: edge.id,
      node1_id: edge.node1.id,
      node2_id: edge.node2.id,
      parent_edge_id: edge.parentEdge?.id ?? null,
      position,
      layer: edge.layer,
      color: edge.color ?? null,
      bend_x: edge.bend?.x ?? null,
      bend_y: edge.bend?.y ?? null,
    });
    for (let i = 0; i < edge.childrenEdges.length; i++) {
      collectEdge(edge.childrenEdges[i], i);
    }
  };
  for (let i = 0; i < map.rootEdges.length; i++) {
    collectEdge(map.rootEdges[i], i);
  }
  return { nodes, notes, edges };
}

function buildMapFromRows(nodeRows: NodeRow[], noteRows: NoteRow[], edgeRows: EdgeRow[]): LifeMap {
  const nodes = new Map<string, Node>();
  for (const row of nodeRows) {
    nodes.set(row.id, deserializeNode(row));
  }

  for (const row of noteRows) {
    nodes.get(row.node_id)?.notes.push({
      id: row.id,
      text: row.text,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  // parents sit one layer below their children, so ordering by layer
  // guarantees every parent edge exists before its children are created
  const orderedEdges = [...edgeRows].sort((a, b) => a.layer - b.layer || a.position - b.position);
  const map = new LifeMap();
  const edgeById = new Map<string, Edge>();
  const connectedNodeIds = new Set<string>();
  for (const row of orderedEdges) {
    const node1 = nodes.get(row.node1_id);
    const node2 = nodes.get(row.node2_id);
    if (!node1 || !node2) continue;
    const parent = row.parent_edge_id ? edgeById.get(row.parent_edge_id) : undefined;
    const edge = new Edge(node1, node2, parent, []);
    edge.id = row.id;
    edge.layer = row.layer;
    edge.color = row.color ?? undefined;
    if (row.bend_x !== null && row.bend_y !== null) {
      edge.bend = { x: row.bend_x, y: row.bend_y };
    }
    edgeById.set(row.id, edge);
    if (parent) {
      parent.childrenEdges.push(edge);
    } else {
      map.rootEdges.push(edge);
    }
    connectedNodeIds.add(row.node1_id);
    connectedNodeIds.add(row.node2_id);
  }

  // nodes untouched by any edge are the isolated root nodes
  for (const [id, node] of nodes) {
    if (!connectedNodeIds.has(id)) {
      map.rootNodes.push(node);
    }
  }
  return map;
}

export function restoreLifeMap(snapshot: LifeMapSnapshot): LifeMap {
  return buildMapFromRows(snapshot.nodes, snapshot.notes, snapshot.edges);
}

// ---------- save: full rewrite inside one transaction ----------

export async function saveLifeMap(map: LifeMap): Promise<void> {
  const db = await getDb();
  const snapshot = snapshotLifeMap(map);
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync("DELETE FROM notes; DELETE FROM edges; DELETE FROM nodes;");

    for (const row of snapshot.nodes) {
      await txn.runAsync(
        "INSERT INTO nodes (id, kind, title, x, y, color, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [row.id, row.kind, row.title, row.x, row.y, row.color, row.data],
      );
    }
    for (const row of snapshot.notes) {
      await txn.runAsync(
        "INSERT INTO notes (id, node_id, text, created_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?)",
        [row.id, row.node_id, row.text, row.created_at, row.updated_at, row.position],
      );
    }
    for (const row of snapshot.edges) {
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
export async function loadLifeMap(): Promise<LifeMap | null> {
  const db = await getDb();
  const nodeRows = await db.getAllAsync<NodeRow>("SELECT * FROM nodes");
  if (nodeRows.length === 0) {
    return null;
  }

  // notes are read per node in position order; edge ordering happens inside
  // buildMapFromRows
  const noteRows = await db.getAllAsync<NoteRow>("SELECT * FROM notes ORDER BY position ASC");
  const edgeRows = await db.getAllAsync<EdgeRow>("SELECT * FROM edges");
  return buildMapFromRows(nodeRows, noteRows, edgeRows);
}

// ---------- save queue ----------
// mutations arrive faster than sqlite writes; chaining keeps saves ordered
// and a queued save naturally persists the latest in-memory state

let saveQueue: Promise<void> = Promise.resolve();

export function scheduleSave(map: LifeMap): void {
  saveQueue = saveQueue
    .then(() => saveLifeMap(map))
    .catch((err) => console.warn("[lifeMapStore] save failed", err));
}
