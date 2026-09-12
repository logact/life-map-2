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

interface NodeRow {
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

// ---------- save: full rewrite inside one transaction ----------

export async function saveLifeMap(map: LifeMap): Promise<void> {
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync("DELETE FROM notes; DELETE FROM edges; DELETE FROM nodes;");

    for (const node of map.allNodes()) {
      await txn.runAsync(
        "INSERT INTO nodes (id, kind, title, x, y, color, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [node.id, node.kind, node.title, node.x, node.y, node.color ?? null, serializeKindData(node)],
      );
      for (let i = 0; i < node.notes.length; i++) {
        const note = node.notes[i];
        await txn.runAsync(
          "INSERT INTO notes (id, node_id, text, created_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?)",
          [note.id, node.id, note.text, note.createdAt.getTime(), note.updatedAt.getTime(), i],
        );
      }
    }

    const insertEdge = async (edge: Edge, position: number) => {
      await txn.runAsync(
        "INSERT INTO edges (id, node1_id, node2_id, parent_edge_id, position, layer, color, bend_x, bend_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          edge.id,
          edge.node1.id,
          edge.node2.id,
          edge.parentEdge?.id ?? null,
          position,
          edge.layer,
          edge.color ?? null,
          edge.bend?.x ?? null,
          edge.bend?.y ?? null,
        ],
      );
      for (let i = 0; i < edge.childrenEdges.length; i++) {
        await insertEdge(edge.childrenEdges[i], i);
      }
    };
    for (let i = 0; i < map.rootEdges.length; i++) {
      await insertEdge(map.rootEdges[i], i);
    }
  });
}

// ---------- load ----------

interface NoteRow {
  id: string;
  node_id: string;
  text: string;
  created_at: number;
  updated_at: number;
  position: number;
}

interface EdgeRow {
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

// returns null when the database has never been written to, so the caller
// can seed initial content
export async function loadLifeMap(): Promise<LifeMap | null> {
  const db = await getDb();
  const nodeRows = await db.getAllAsync<NodeRow>("SELECT * FROM nodes");
  if (nodeRows.length === 0) {
    return null;
  }

  const nodes = new Map<string, Node>();
  for (const row of nodeRows) {
    nodes.set(row.id, deserializeNode(row));
  }

  const noteRows = await db.getAllAsync<NoteRow>("SELECT * FROM notes ORDER BY position ASC");
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
  const edgeRows = await db.getAllAsync<EdgeRow>(
    "SELECT * FROM edges ORDER BY layer ASC, position ASC",
  );
  const map = new LifeMap();
  const edgeById = new Map<string, Edge>();
  const connectedNodeIds = new Set<string>();
  for (const row of edgeRows) {
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

// ---------- save queue ----------
// mutations arrive faster than sqlite writes; chaining keeps saves ordered
// and a queued save naturally persists the latest in-memory state

let saveQueue: Promise<void> = Promise.resolve();

export function scheduleSave(map: LifeMap): void {
  saveQueue = saveQueue
    .then(() => saveLifeMap(map))
    .catch((err) => console.warn("[lifeMapStore] save failed", err));
}
