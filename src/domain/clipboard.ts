import { EdgeData, Id, LifeMapDoc, NodeData, NodeKind } from "./doc";

// ---------- clipboard: copy/paste as plain-data snapshots ----------
// Copy captures a JSON-able snapshot (never live document references), so a
// paste still works after the original is edited or deleted, and the same
// snapshot can be pasted any number of times. Node, edge, and road copies
// all produce the same payload — a mini-graph of node records plus an edge
// tree — so there is exactly one paste path (commands.pastePayload).
//
// Copy rules:
// - node: payload only (title/kind/color/notes/kind data), no adjacency
// - edge/road: deep copy — endpoints and the whole child-edge subtree come
//   along; endpoint copies are trimmed (their outside edges are not)
// - shared nodes/edges are captured once via an id -> key memo, so a diamond
//   in the original stays a diamond in the copy
// - statuses and timestamps copy verbatim (exact duplicate)

export interface ClipboardNodeData {
  key: string;
  kind: NodeKind;
  title: string;
  color?: string;
  // kind-specific fields, same shape as the store's node `data` blob
  data: Record<string, unknown>;
  notes: { text: string; createdAt: number; updatedAt: number }[];
  // position relative to the payload anchor (bounding-box center)
  rx: number;
  ry: number;
}

export interface ClipboardEdgeData {
  fromKey: string;
  toKey: string;
  color?: string;
  bend?: { rx: number; ry: number };
  children: ClipboardEdgeData[];
}

export interface ClipboardPayload {
  kind: "node" | "edge" | "road";
  nodes: ClipboardNodeData[];
  rootEdges: ClipboardEdgeData[];
}

// ---------- snapshot ----------

interface Capture {
  doc: LifeMapDoc;
  nodes: ClipboardNodeData[]; // rx/ry hold absolute coords until buildPayload
  nodeKeyById: Map<Id, string>;
  seenEdgeIds: Set<Id>;
  nextKey: number;
}

function newCapture(doc: LifeMapDoc): Capture {
  return { doc, nodes: [], nodeKeyById: new Map(), seenEdgeIds: new Set(), nextKey: 0 };
}

function captureKindData(node: NodeData): Record<string, unknown> {
  if (node.kind === "goal") {
    return {
      description: node.description ?? null,
      targetDate: node.targetDate ?? null,
      completedAt: node.completedAt ?? null,
    };
  }
  if (node.kind === "task") {
    return {
      status: node.status ?? "todo",
      startedAt: node.startedAt ?? null,
      completedAt: node.completedAt ?? null,
    };
  }
  if (node.kind === "record") {
    return {
      note: node.note ?? "",
      createdAt: node.createdAt ?? null,
      occurredAt: node.occurredAt ?? null,
    };
  }
  return {};
}

function captureNode(cap: Capture, nodeId: Id): string {
  const existing = cap.nodeKeyById.get(nodeId);
  if (existing) return existing;
  const node = cap.doc.nodes[nodeId];
  if (!node) return "";
  const key = `n${++cap.nextKey}`;
  cap.nodeKeyById.set(nodeId, key);
  cap.nodes.push({
    key,
    kind: node.kind,
    title: node.title,
    color: node.color,
    data: captureKindData(node),
    notes: node.notes.map((n) => ({ text: n.text, createdAt: n.createdAt, updatedAt: n.updatedAt })),
    rx: node.x,
    ry: node.y,
  });
  return key;
}

function captureEdge(cap: Capture, edge: EdgeData): ClipboardEdgeData {
  return {
    fromKey: captureNode(cap, edge.fromId),
    toKey: captureNode(cap, edge.toId),
    color: edge.color,
    bend: edge.bend ? { rx: edge.bend.x, ry: edge.bend.y } : undefined,
    children: edge.childEdgeIds
      .map((id) => cap.doc.edges[id])
      .filter((c): c is EdgeData => !!c)
      .map((c) => captureEdge(cap, c)),
  };
}

// recenter every captured position on the bounding-box center, so a paste
// lands with the whole structure centered on the target point
function buildPayload(
  kind: ClipboardPayload["kind"],
  cap: Capture,
  rootEdges: ClipboardEdgeData[],
): ClipboardPayload {
  if (cap.nodes.length === 0) {
    return { kind, nodes: [], rootEdges: [] };
  }
  const xs = cap.nodes.map((n) => n.rx);
  const ys = cap.nodes.map((n) => n.ry);
  const ax = (Math.min(...xs) + Math.max(...xs)) / 2;
  const ay = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const n of cap.nodes) {
    n.rx -= ax;
    n.ry -= ay;
  }
  const normalizeEdge = (e: ClipboardEdgeData) => {
    if (e.bend) e.bend = { rx: e.bend.rx - ax, ry: e.bend.ry - ay };
    e.children.forEach(normalizeEdge);
  };
  rootEdges.forEach(normalizeEdge);
  return { kind, nodes: cap.nodes, rootEdges };
}

export function snapshotNode(doc: LifeMapDoc, nodeId: Id): ClipboardPayload {
  const cap = newCapture(doc);
  captureNode(cap, nodeId);
  return buildPayload("node", cap, []);
}

export function snapshotEdge(doc: LifeMapDoc, edgeId: Id): ClipboardPayload {
  const cap = newCapture(doc);
  const edge = doc.edges[edgeId];
  return buildPayload("edge", cap, edge ? [captureEdge(cap, edge)] : []);
}

// a road is a list of visible edges (a route or the current selection);
// edges shared between routes are captured once
export function snapshotRoad(doc: LifeMapDoc, edgeIds: Id[]): ClipboardPayload {
  const cap = newCapture(doc);
  const roots: ClipboardEdgeData[] = [];
  for (const id of edgeIds) {
    if (cap.seenEdgeIds.has(id)) continue;
    cap.seenEdgeIds.add(id);
    const edge = cap.doc.edges[id];
    if (edge) roots.push(captureEdge(cap, edge));
  }
  return buildPayload("road", cap, roots);
}
