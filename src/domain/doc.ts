import { v4 as uuidv4 } from "uuid";

// ---------- the LifeMap document: plain, normalized, JSON-shaped ----------
// The whole document is one immutable value: nodes and edges live in id-keyed
// records and reference each other BY ID only (never by object reference), so
// the doc has no cycles and JSON.stringify(doc) is a faithful serialization.
// All edits go through commands (src/domain/commands.ts) run inside Immer, so
// every edit yields a NEW doc plus patches; nothing mutates a doc in place.
//
// Field rules: numbers/strings/booleans/arrays/plain objects only — no Date,
// Map, Set, or class instances. Timestamps are epoch millis.

export type Id = string;

export type NodeKind = "goal" | "task" | "record";

export type Status = "todo" | "in-progress" | "done";

export interface NoteData {
  id: Id;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface NodeData {
  id: Id;
  kind: NodeKind;
  x: number;
  y: number;
  title: string;
  color?: string;
  notes: NoteData[];
  // task fields (goal shares completedAt)
  status?: Status;
  startedAt?: number;
  completedAt?: number;
  // goal fields
  description?: string;
  targetDate?: number;
  // record fields
  note?: string;
  occurredAt?: number;
  createdAt?: number;
  // set on the synthetic midpoint node expand() inserts into an edge, so
  // status rollups can skip it (it is structure, not a real child task)
  synthetic?: boolean;
}

export interface EdgeData {
  id: Id;
  fromId: Id;
  toId: Id;
  // tree of detail: an expanded/summarized edge's children carry its
  // sub-structure. Array order is the sibling position (persisted).
  parentEdgeId: Id | null;
  childEdgeIds: Id[];
  color?: string;
  // optional bend point in world coordinates; when set the edge renders as
  // two segments from -> bend -> to instead of a straight line
  bend?: { x: number; y: number };
}

export interface LifeMapDoc {
  schemaVersion: 2;
  nodes: Record<Id, NodeData>;
  edges: Record<Id, EdgeData>;
  // nodes no edge touches ("isolated"), in layout order
  rootNodeIds: Id[];
  // top-level edges, in layout order
  rootEdgeIds: Id[];
}

export function newId(): Id {
  return uuidv4();
}

export function emptyDoc(): LifeMapDoc {
  return { schemaVersion: 2, nodes: {}, edges: {}, rootNodeIds: [], rootEdgeIds: [] };
}

// ---------- factories ----------

export function makeGoal(x: number, y: number, title: string, extra?: Partial<NodeData>): NodeData {
  return { id: newId(), kind: "goal", x, y, title, notes: [], ...extra };
}

export function makeTask(x: number, y: number, title: string, extra?: Partial<NodeData>): NodeData {
  return { id: newId(), kind: "task", x, y, title, notes: [], status: "todo", ...extra };
}

export function makeRecordNode(
  x: number,
  y: number,
  title: string,
  note: string,
  occurredAt: number,
): NodeData {
  return { id: newId(), kind: "record", x, y, title, notes: [], note, occurredAt, createdAt: Date.now() };
}

export function makeEdgeData(fromId: Id, toId: Id, parentEdgeId: Id | null): EdgeData {
  return { id: newId(), fromId, toId, parentEdgeId, childEdgeIds: [] };
}

// ---------- type guards ----------

export function isGoal(n: NodeData): boolean {
  return n.kind === "goal";
}

export function isTask(n: NodeData): boolean {
  return n.kind === "task";
}

export function isRecord(n: NodeData): boolean {
  return n.kind === "record";
}

// ---------- lookups ----------

export function getNode(doc: LifeMapDoc, id: Id): NodeData | undefined {
  return doc.nodes[id];
}

export function getEdge(doc: LifeMapDoc, id: Id): EdgeData | undefined {
  return doc.edges[id];
}

// depth of an edge in the detail tree (top-level edges are 0). Derived from
// the parent chain — the doc deliberately does not store it.
export function edgeDepth(doc: LifeMapDoc, edgeId: Id): number {
  let depth = 0;
  let e = doc.edges[edgeId];
  while (e && e.parentEdgeId !== null) {
    depth++;
    e = doc.edges[e.parentEdgeId];
  }
  return depth;
}
