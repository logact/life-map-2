import { Draft } from "immer";

import {
  EdgeData,
  Id,
  LifeMapDoc,
  makeEdgeData,
  makeGoal,
  makeRecordNode,
  makeTask,
  newId,
  NodeData,
  NodeKind,
} from "./doc";
import { ClipboardPayload } from "./clipboard";

// ---------- commands: the ONLY way a doc changes ----------
// A command factory mints any fresh ids up front and returns a Recipe — a
// function the store runs inside Immer's produceWithPatches. The recipe gets
// mutable ergonomics on the draft; the store gets a new immutable doc plus
// patches/inverse-patches for undo and persistence.
//
// Domain invariants live HERE and nowhere else: records are leaves,
// summarize needs one directed chain with exactly two boundary nodes, status
// transitions follow the machine. A violated invariant throws, the produce
// aborts, and the store applies nothing.

export type Recipe = (draft: Draft<LifeMapDoc>) => void;

export class DomainError extends Error {}

// ---------- shared recipe fragments ----------

// insert an edge into its container and de-isolate its endpoints
function linkEdge(draft: Draft<LifeMapDoc>, edge: EdgeData) {
  draft.edges[edge.id] = edge;
  if (edge.parentEdgeId) {
    draft.edges[edge.parentEdgeId]?.childEdgeIds.push(edge.id);
  } else {
    draft.rootEdgeIds.push(edge.id);
  }
  draft.rootNodeIds = draft.rootNodeIds.filter((id) => id !== edge.fromId && id !== edge.toId);
}

// remove an edge but keep its children: they rise one level into the removed
// edge's container. Endpoints left with no edges become isolated root nodes.
function removeEdgeRaw(draft: Draft<LifeMapDoc>, edgeId: Id) {
  const edge = draft.edges[edgeId];
  if (!edge) return;

  if (edge.parentEdgeId) {
    const parent = draft.edges[edge.parentEdgeId];
    if (parent) parent.childEdgeIds = parent.childEdgeIds.filter((id) => id !== edgeId);
  } else {
    draft.rootEdgeIds = draft.rootEdgeIds.filter((id) => id !== edgeId);
  }

  for (const childId of edge.childEdgeIds) {
    const child = draft.edges[childId];
    if (!child) continue;
    child.parentEdgeId = edge.parentEdgeId;
    if (edge.parentEdgeId) {
      draft.edges[edge.parentEdgeId]?.childEdgeIds.push(childId);
    } else {
      draft.rootEdgeIds.push(childId);
    }
  }

  delete draft.edges[edgeId];

  for (const nodeId of [edge.fromId, edge.toId]) {
    const stillConnected = Object.values(draft.edges).some(
      (e) => e.fromId === nodeId || e.toId === nodeId,
    );
    if (!stillConnected && !draft.rootNodeIds.includes(nodeId)) {
      draft.rootNodeIds.push(nodeId);
    }
  }
}

function makeNodeOfKind(kind: NodeKind, x: number, y: number, title: string, detail?: string): NodeData {
  if (kind === "task") return makeTask(x, y, title);
  if (kind === "record") return makeRecordNode(x, y, title, detail ?? "", Date.now());
  return makeGoal(x, y, title, detail ? { description: detail } : undefined);
}

function mustNode(draft: Draft<LifeMapDoc>, id: Id): NodeData {
  const node = draft.nodes[id];
  if (!node) throw new DomainError(`no such node: ${id}`);
  return node;
}

// ---------- node creation ----------

// a node with no edges, placed on the canvas (double-tap create)
export function addFreeNode(kind: NodeKind, title: string, detail: string, pos: { x: number; y: number }) {
  const node = makeNodeOfKind(kind, pos.x, pos.y, title, detail);
  return {
    nodeId: node.id,
    recipe: (draft: Draft<LifeMapDoc>) => {
      draft.nodes[node.id] = node;
      if (!draft.rootNodeIds.includes(node.id)) draft.rootNodeIds.push(node.id);
    },
  };
}

// "Add to": a new child under an existing node (goal/task/record as child)
export function addChildNode(
  parentId: Id,
  kind: NodeKind,
  title: string,
  detail: string,
  pos: { x: number; y: number },
) {
  const node = makeNodeOfKind(kind, pos.x, pos.y, title, detail);
  const edge = makeEdgeData(parentId, node.id, null);
  return {
    nodeId: node.id,
    edgeId: edge.id,
    recipe: (draft: Draft<LifeMapDoc>) => {
      const parent = mustNode(draft, parentId);
      if (parent.kind === "record") throw new DomainError("records are leaves");
      draft.nodes[node.id] = node;
      linkEdge(draft, edge);
    },
  };
}

// "Be added to": a new node that becomes the PARENT of an existing node
export function addParentNode(
  childId: Id,
  kind: NodeKind,
  title: string,
  detail: string,
  pos: { x: number; y: number },
) {
  if (kind === "record") throw new DomainError("records are leaves");
  const node = makeNodeOfKind(kind, pos.x, pos.y, title, detail);
  const edge = makeEdgeData(node.id, childId, null);
  return {
    nodeId: node.id,
    edgeId: edge.id,
    recipe: (draft: Draft<LifeMapDoc>) => {
      mustNode(draft, childId);
      draft.nodes[node.id] = node;
      linkEdge(draft, edge);
    },
  };
}

// connect two existing nodes, optionally as a child of a parent edge
export function connectNodes(fromId: Id, toId: Id, parentEdgeId: Id | null = null) {
  const edge = makeEdgeData(fromId, toId, parentEdgeId);
  return {
    edgeId: edge.id,
    recipe: (draft: Draft<LifeMapDoc>) => {
      mustNode(draft, fromId);
      mustNode(draft, toId);
      linkEdge(draft, edge);
    },
  };
}

// ---------- node/edge edits ----------

export function moveNode(id: Id, x: number, y: number): Recipe {
  return (draft) => {
    const node = draft.nodes[id];
    if (!node || (node.x === x && node.y === y)) return;
    node.x = x;
    node.y = y;
  };
}

export function renameNode(id: Id, title: string): Recipe {
  return (draft) => {
    const node = draft.nodes[id];
    if (node) node.title = title;
  };
}

export function setNodeColor(id: Id, color?: string): Recipe {
  return (draft) => {
    const node = draft.nodes[id];
    if (node) node.color = color;
  };
}

export function setEdgeColor(id: Id, color?: string): Recipe {
  return (draft) => {
    const edge = draft.edges[id];
    if (edge) edge.color = color;
  };
}

// null clears the bend ("straighten")
export function setEdgeBend(id: Id, bend: { x: number; y: number } | null): Recipe {
  return (draft) => {
    const edge = draft.edges[id];
    if (!edge) return;
    if (bend) edge.bend = bend;
    else delete edge.bend;
  };
}

// ---------- deletion ----------

export function removeNode(id: Id): Recipe {
  return (draft) => {
    if (!draft.nodes[id]) return;
    const incident = Object.values(draft.edges)
      .filter((e) => e.fromId === id || e.toId === id)
      .map((e) => e.id);
    for (const edgeId of incident) removeEdgeRaw(draft, edgeId);
    draft.rootNodeIds = draft.rootNodeIds.filter((nid) => nid !== id);
    delete draft.nodes[id];
  };
}

export function removeEdge(id: Id): Recipe {
  return (draft) => removeEdgeRaw(draft, id);
}

// ---------- structure ----------

// insert a synthetic midpoint task into a leaf edge, as two child edges:
// from -> mid -> to. The midpoint is placed between the endpoints (offset
// so the bend shows) and marked synthetic so status rollups skip it.
export function expandEdge(edgeId: Id, offset: { dx: number; dy: number } = { dx: -40, dy: 0 }) {
  const mid = makeTask(0, 0, "");
  mid.synthetic = true;
  const e1 = makeEdgeData("", mid.id, edgeId);
  const e2 = makeEdgeData(mid.id, "", edgeId);
  return {
    midNodeId: mid.id,
    childEdgeIds: [e1.id, e2.id],
    recipe: (draft: Draft<LifeMapDoc>) => {
      const edge = draft.edges[edgeId];
      if (!edge || edge.childEdgeIds.length > 0) return;
      const from = mustNode(draft, edge.fromId);
      const to = mustNode(draft, edge.toId);
      mid.title = `${from.title}-${to.title}`;
      mid.x = (from.x + to.x) / 2 + offset.dx;
      mid.y = (from.y + to.y) / 2 + offset.dy;
      draft.nodes[mid.id] = mid;
      e1.fromId = edge.fromId;
      e2.toId = edge.toId;
      linkEdge(draft, e1);
      linkEdge(draft, e2);
    },
  };
}

// fold a directed chain of sibling edges into one parent edge. Throws unless
// the selection is exactly one directed chain (two boundary nodes) sharing
// one parent — a star or disjoint selection is rejected.
export function summarizeEdges(edgeIds: Id[]) {
  const newEdge = makeEdgeData("", "", null);
  return {
    newEdgeId: newEdge.id,
    recipe: (draft: Draft<LifeMapDoc>) => {
      if (edgeIds.length < 2) throw new DomainError("summarize needs at least two edges");
      const edges = edgeIds.map((id) => {
        const e = draft.edges[id];
        if (!e) throw new DomainError(`no such edge: ${id}`);
        return e;
      });
      const parentEdgeId = edges[0].parentEdgeId;
      if (edges.some((e) => e.parentEdgeId !== parentEdgeId)) {
        throw new DomainError("edges to summarize must share the same parent");
      }

      // boundary nodes: touched by exactly one selected edge
      const touched = new Map<Id, number>();
      for (const e of edges) {
        touched.set(e.fromId, (touched.get(e.fromId) ?? 0) + 1);
        touched.set(e.toId, (touched.get(e.toId) ?? 0) + 1);
      }
      const boundary = [...touched.entries()].filter(([, c]) => c === 1).map(([id]) => id);
      if (boundary.length !== 2) {
        throw new DomainError("selected edges must form one chain with two open ends");
      }

      // walk the chain from the boundary node with no incoming selected edge
      const selected = new Set(edgeIds);
      const start = boundary.find(
        (id) => !edges.some((e) => e.toId === id && selected.has(e.id)),
      );
      if (!start) throw new DomainError("selected edges must form one directed chain");
      const ordered: EdgeData[] = [];
      let cursor = start;
      while (ordered.length < edges.length) {
        const next = edges.find((e) => e.fromId === cursor && !ordered.includes(e));
        if (!next) throw new DomainError("selected edges must form one directed chain");
        ordered.push(next);
        cursor = next.toId;
      }
      if (cursor === start) throw new DomainError("selected edges must not form a loop");

      // detach the chain from its container, fold it under the new edge
      const container = parentEdgeId ? draft.edges[parentEdgeId]?.childEdgeIds : draft.rootEdgeIds;
      if (!container) throw new DomainError("broken parent edge");
      const selectedIds = new Set(edgeIds);
      const kept = container.filter((id) => !selectedIds.has(id));
      if (parentEdgeId) draft.edges[parentEdgeId]!.childEdgeIds = kept;
      else draft.rootEdgeIds = kept;

      newEdge.fromId = start;
      newEdge.toId = cursor;
      newEdge.parentEdgeId = parentEdgeId;
      for (const e of ordered) {
        e.parentEdgeId = newEdge.id;
        newEdge.childEdgeIds.push(e.id);
      }
      linkEdge(draft, newEdge);
    },
  };
}

// ---------- status machine ----------
// todo --start--> in-progress --complete--> done; in-progress --pause--> todo;
// todo --complete--> done; done --reopen--> todo. Goals only complete/reopen
// (manual completion wins over derivation); records have no status.

export type StatusAction = "start" | "pause" | "complete" | "reopen";

export function transitionNodeStatus(id: Id, action: StatusAction): Recipe {
  return (draft) => {
    const node = mustNode(draft, id);
    if (node.kind === "record") throw new DomainError("records have no status");
    if (node.kind === "goal") {
      if (action === "complete") node.completedAt = Date.now();
      else if (action === "reopen") delete node.completedAt;
      else throw new DomainError(`cannot ${action} a goal`);
      return;
    }
    switch (action) {
      case "start":
        if (node.status !== "todo") throw new DomainError(`cannot start a ${node.status} task`);
        node.status = "in-progress";
        node.startedAt ??= Date.now(); // records the FIRST start, never cleared
        break;
      case "pause":
        if (node.status !== "in-progress") throw new DomainError(`cannot pause a ${node.status} task`);
        node.status = "todo";
        break;
      case "complete":
        if (node.status === "done") throw new DomainError("task is already done");
        node.status = "done";
        node.completedAt = Date.now();
        break;
      case "reopen":
        if (node.status !== "done") throw new DomainError(`cannot reopen a ${node.status} task`);
        node.status = "todo";
        delete node.completedAt;
        break;
    }
  };
}

// ---------- notes ----------

export function addNote(nodeId: Id, text: string) {
  const noteId = newId();
  const trimmed = text.trim();
  return {
    noteId,
    recipe: (draft: Draft<LifeMapDoc>) => {
      if (!trimmed) return;
      const node = draft.nodes[nodeId];
      if (!node) return;
      const now = Date.now();
      node.notes.unshift({ id: noteId, text: trimmed, createdAt: now, updatedAt: now });
    },
  };
}

export function updateNote(nodeId: Id, noteId: Id, text: string): Recipe {
  const trimmed = text.trim();
  return (draft) => {
    if (!trimmed) return;
    const note = draft.nodes[nodeId]?.notes.find((n) => n.id === noteId);
    if (!note) return;
    note.text = trimmed;
    note.updatedAt = Date.now();
  };
}

export function removeNote(nodeId: Id, noteId: Id): Recipe {
  return (draft) => {
    const node = draft.nodes[nodeId];
    if (node) node.notes = node.notes.filter((n) => n.id !== noteId);
  };
}

// ---------- clipboard paste ----------

// recreate a clipboard payload centered on `at` with fresh ids; pasted edges
// become new root edges, untouched pasted nodes become isolated root nodes
export function pastePayload(payload: ClipboardPayload, at: { x: number; y: number }) {
  // mint every fresh id up front, keyed by the payload's local keys
  const nodeIdByKey = new Map<string, Id>();
  const preparedNodes: NodeData[] = [];
  for (const n of payload.nodes) {
    const node = makeNodeOfKind(n.kind, at.x + n.rx, at.y + n.ry, n.title);
    node.id = newId();
    node.color = n.color;
    node.notes = n.notes.map((note) => ({
      id: newId(),
      text: note.text,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }));
    const d = n.data;
    if (n.kind === "task") {
      if (typeof d.status === "string") node.status = d.status as NodeData["status"];
      if (typeof d.startedAt === "number") node.startedAt = d.startedAt;
      if (typeof d.completedAt === "number") node.completedAt = d.completedAt;
    } else if (n.kind === "record") {
      if (typeof d.note === "string") node.note = d.note;
      // occurredAt renamed from the legacy occuredAt — accept both
      const occurred = typeof d.occurredAt === "number" ? d.occurredAt : d.occuredAt;
      node.occurredAt = typeof occurred === "number" ? occurred : Date.now();
      node.createdAt = typeof d.createdAt === "number" ? d.createdAt : Date.now();
    } else {
      if (typeof d.description === "string") node.description = d.description;
      if (typeof d.targetDate === "number") node.targetDate = d.targetDate;
      if (typeof d.completedAt === "number") node.completedAt = d.completedAt;
    }
    nodeIdByKey.set(n.key, node.id);
    preparedNodes.push(node);
  }

  const preparedEdges: EdgeData[] = [];
  const rootEdgeIds: Id[] = [];
  const prepareEdge = (e: ClipboardPayload["rootEdges"][number], parentId: Id | null) => {
    const fromId = nodeIdByKey.get(e.fromKey);
    const toId = nodeIdByKey.get(e.toKey);
    if (!fromId || !toId) return;
    const edge = makeEdgeData(fromId, toId, parentId);
    edge.color = e.color;
    if (e.bend) edge.bend = { x: at.x + e.bend.rx, y: at.y + e.bend.ry };
    preparedEdges.push(edge);
    if (!parentId) rootEdgeIds.push(edge.id);
    e.children.forEach((c) => prepareEdge(c, edge.id));
  };
  payload.rootEdges.forEach((e) => prepareEdge(e, null));

  const connectedNodeIds = new Set(preparedEdges.flatMap((e) => [e.fromId, e.toId]));

  return {
    nodeIds: preparedNodes.map((n) => n.id),
    rootEdgeIds,
    recipe: (draft: Draft<LifeMapDoc>) => {
      for (const node of preparedNodes) {
        draft.nodes[node.id] = node;
        if (!connectedNodeIds.has(node.id) && !draft.rootNodeIds.includes(node.id)) {
          draft.rootNodeIds.push(node.id);
        }
      }
      for (const edge of preparedEdges) linkEdge(draft, edge);
    },
  };
}
