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

// recurrence rule for a standing habit task ("gym every 2 days", "journal
// every week on Sun"). The task is never permanently done: each completion
// appends to its occurrence log and the rule derives what is asked of you
// now (see src/domain/recur.ts)
export type RecurFreq = "daily" | "weekly" | "monthly";

export interface RecurRule {
  freq: RecurFreq;
  // every N freq units (every 2 days, every 3 weeks), >= 1
  interval: number;
  // weekly only: scheduled weekdays, 0 = Sunday .. 6 = Saturday; omitted
  // means "the anchor's weekday"
  weekdays?: number[];
  // the first scheduled day (epoch millis); time-of-day is ignored
  anchor: number;
}

export interface NoteData {
  id: Id;
  text: string;
  createdAt: number;
  updatedAt: number;
}

// a named, colored label in the doc-level registry; nodes reference tags
// by id, so a rename/recolor happens in one place
export interface TagData {
  id: Id;
  name: string;
  color: string;
}

export interface NodeData {
  id: Id;
  kind: NodeKind;
  x: number;
  y: number;
  title: string;
  notes: NoteData[];
  // ids into the doc's tag registry
  tagIds?: Id[];
  // task fields (goal shares completedAt)
  status?: Status;
  startedAt?: number;
  completedAt?: number;
  // recurring task fields: the rule and its occurrence log (ascending
  // timestamps). While recur is set the stored status stays "todo" and the
  // DERIVED state (due/overdue/…) takes over — see src/domain/recur.ts
  recur?: RecurRule;
  log?: number[];
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
  // optional bend point in world coordinates; when set the edge renders as
  // two segments from -> bend -> to instead of a straight line
  bend?: { x: number; y: number };
}

export interface LifeMapDoc {
  schemaVersion: 3;
  nodes: Record<Id, NodeData>;
  edges: Record<Id, EdgeData>;
  // the tag registry, keyed by tag id
  tags: Record<Id, TagData>;
  // nodes no edge touches ("isolated"), in layout order
  rootNodeIds: Id[];
  // top-level edges, in layout order
  rootEdgeIds: Id[];
}

export function newId(): Id {
  return uuidv4();
}

export function emptyDoc(): LifeMapDoc {
  return {
    schemaVersion: 3,
    nodes: {},
    edges: {},
    tags: {},
    rootNodeIds: [],
    rootEdgeIds: [],
  };
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

// tag names are unique after trim + case-fold; this is how a caller finds
// the existing tag for a name instead of creating a twin
export function findTagByName(doc: LifeMapDoc, name: string): TagData | undefined {
  const folded = name.trim().toLowerCase();
  return Object.values(doc.tags).find((t) => t.name.toLowerCase() === folded);
}

// depth of an edge in the detail tree (top-level edges are 0). Derived from
// the parent chain — the doc deliberately does not store it. Memoized per
// doc identity (docs are immutable, so a WeakMap keyed on the doc is an
// exact cache — see getIndexes): the view-model loop asks for every visible
// edge's depth on each derivation, and sibling edges share most of the
// parent walk
const depthCache = new WeakMap<LifeMapDoc, Map<Id, number>>();

export function edgeDepth(doc: LifeMapDoc, edgeId: Id): number {
  let map = depthCache.get(doc);
  if (!map) {
    map = new Map();
    depthCache.set(doc, map);
  }
  const hit = map.get(edgeId);
  if (hit !== undefined) return hit;
  let depth = 0;
  let e = doc.edges[edgeId];
  while (e && e.parentEdgeId !== null) {
    depth++;
    e = doc.edges[e.parentEdgeId];
  }
  map.set(edgeId, depth);
  return depth;
}
