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
  NoteData,
  RecurRule,
} from "./doc";
import { ClipboardPayload } from "./clipboard";
import { parseRecurLog, parseRecurRule } from "./recur";
import { PALETTE } from "@/ui/palette";

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

function makeNodeOfKind(
  kind: NodeKind,
  x: number,
  y: number,
  title: string,
  detail?: string,
  occurredAt?: number,
  targetDate?: number,
): NodeData {
  if (kind === "task") return makeTask(x, y, title);
  if (kind === "record") return makeRecordNode(x, y, title, detail ?? "", occurredAt ?? Date.now());
  const extra: Partial<NodeData> = {};
  if (detail) extra.description = detail;
  if (targetDate !== undefined) extra.targetDate = targetDate;
  return makeGoal(x, y, title, Object.keys(extra).length > 0 ? extra : undefined);
}

function mustNode(draft: Draft<LifeMapDoc>, id: Id): NodeData {
  const node = draft.nodes[id];
  if (!node) throw new DomainError(`no such node: ${id}`);
  return node;
}

// ---------- node creation ----------

// a node with no edges, placed on the canvas (double-tap create).
// occurredAt backdates a record, targetDate sets a goal's target; both
// ignored for other kinds
export function addFreeNode(
  kind: NodeKind,
  title: string,
  detail: string,
  pos: { x: number; y: number },
  occurredAt?: number,
  targetDate?: number,
) {
  const node = makeNodeOfKind(kind, pos.x, pos.y, title, detail, occurredAt, targetDate);
  return {
    nodeId: node.id,
    recipe: (draft: Draft<LifeMapDoc>) => {
      draft.nodes[node.id] = node;
      if (!draft.rootNodeIds.includes(node.id)) draft.rootNodeIds.push(node.id);
    },
  };
}

// "Add to": a new child under an existing node (goal/task/record as child).
// occurredAt backdates a record, targetDate sets a goal's target; both
// ignored for other kinds
export function addChildNode(
  parentId: Id,
  kind: NodeKind,
  title: string,
  detail: string,
  pos: { x: number; y: number },
  occurredAt?: number,
  targetDate?: number,
) {
  const node = makeNodeOfKind(kind, pos.x, pos.y, title, detail, occurredAt, targetDate);
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

// "Be added to": a new node that becomes the PARENT of an existing node.
// occurredAt backdates a record, targetDate sets a goal's target; both
// ignored for other kinds
export function addParentNode(
  childId: Id,
  kind: NodeKind,
  title: string,
  detail: string,
  pos: { x: number; y: number },
  occurredAt?: number,
  targetDate?: number,
) {
  if (kind === "record") throw new DomainError("records are leaves");
  const node = makeNodeOfKind(kind, pos.x, pos.y, title, detail, occurredAt, targetDate);
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

// the inspector's detail field: a goal's description, a record's note.
// Tasks carry no detail, so the command no-ops for them; empty clears.
export function setNodeDetail(id: Id, detail: string): Recipe {
  return (draft) => {
    const node = draft.nodes[id];
    if (!node) return;
    const value = detail.trim();
    if (node.kind === "goal") node.description = value || undefined;
    else if (node.kind === "record") node.note = value;
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

// swap in a whole document (the seed loader): one edit, so undo restores
// the previous map in a single step
export function replaceDoc(next: LifeMapDoc): Recipe {
  return (draft) => {
    draft.nodes = next.nodes;
    draft.edges = next.edges;
    draft.tags = next.tags;
    draft.rootNodeIds = next.rootNodeIds;
    draft.rootEdgeIds = next.rootEdgeIds;
  };
}

// ---------- tags ----------
// The registry lives on the doc (doc.tags); nodes hold ids into it. Tag
// names are unique after trim + case-fold: a duplicate add/renames is a
// no-op rather than a twin.

function tagByFoldedName(draft: Draft<LifeMapDoc>, folded: string) {
  return Object.values(draft.tags).find((t) => t.name.toLowerCase() === folded);
}

// mints the id up front; without an explicit color the tag takes the next
// palette entry by registry size. A name that already exists (trimmed,
// case-folded) makes the recipe a no-op — callers wanting that tag's id
// should look it up via findTagByName before adding
export function addTag(name: string, color?: string): { tagId: Id; recipe: Recipe } {
  const tagId = newId();
  const trimmed = name.trim();
  return {
    tagId,
    recipe: (draft) => {
      if (!trimmed || tagByFoldedName(draft, trimmed.toLowerCase())) return;
      draft.tags[tagId] = {
        id: tagId,
        name: trimmed,
        color: color ?? PALETTE[Object.keys(draft.tags).length % PALETTE.length].color,
      };
    },
  };
}

export function renameTag(id: Id, name: string): Recipe {
  const trimmed = name.trim();
  return (draft) => {
    const tag = draft.tags[id];
    if (!tag || !trimmed) return;
    const clash = tagByFoldedName(draft, trimmed.toLowerCase());
    if (clash && clash.id !== id) return;
    tag.name = trimmed;
  };
}

export function setTagColor(id: Id, color: string): Recipe {
  return (draft) => {
    const tag = draft.tags[id];
    if (tag) tag.color = color;
  };
}

// one recipe: the registry entry and every reference to it go together
export function deleteTag(id: Id): Recipe {
  return (draft) => {
    if (!draft.tags[id]) return;
    delete draft.tags[id];
    for (const node of Object.values(draft.nodes)) {
      if (node.tagIds?.includes(id)) {
        node.tagIds = node.tagIds.filter((tagId) => tagId !== id);
      }
    }
  };
}

// replaces the node's whole tag list, dropping ids the registry doesn't
// know; an empty result clears the field
export function setNodeTags(nodeId: Id, tagIds: Id[]): Recipe {
  return (draft) => {
    const node = draft.nodes[nodeId];
    if (!node) return;
    const known = [...new Set(tagIds)].filter((id) => draft.tags[id]);
    if (known.length > 0) node.tagIds = known;
    else delete node.tagIds;
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

// insert a REAL node mid-road: A -> B becomes A -> N -> B. The two halves
// take over the old edge's slot and parent (same layer), and the old
// edge's sub-road (if any) rides with the half that still travels to the
// original destination. Records can't be inserted: they are leaves, and a
// mid-road record would have to point onward.
export function insertNodeIntoEdge(
  edgeId: Id,
  kind: NodeKind,
  title: string,
  detail: string,
  pos: { x: number; y: number },
  targetDate?: number,
) {
  if (kind === "record") throw new DomainError("records are leaves");
  const node = makeNodeOfKind(kind, pos.x, pos.y, title, detail, undefined, targetDate);
  const e1 = makeEdgeData("", node.id, null);
  const e2 = makeEdgeData(node.id, "", null);
  return {
    nodeId: node.id,
    edgeIds: [e1.id, e2.id] as Id[],
    recipe: (draft: Draft<LifeMapDoc>) => {
      const edge = draft.edges[edgeId];
      if (!edge) throw new DomainError(`no such edge: ${edgeId}`);
      const from = mustNode(draft, edge.fromId);
      mustNode(draft, edge.toId);
      // stacked endpoints would hide the new node under the pile
      if (from.x === node.x && from.y === node.y) node.y -= 60;
      e1.fromId = edge.fromId;
      e1.parentEdgeId = edge.parentEdgeId;
      e2.toId = edge.toId;
      e2.parentEdgeId = edge.parentEdgeId;
      e2.childEdgeIds = edge.childEdgeIds;
      for (const childId of edge.childEdgeIds) {
        const child = draft.edges[childId];
        if (child) child.parentEdgeId = e2.id;
      }
      // the halves replace the old edge at its exact slot, keeping the
      // container's layout order
      const container = edge.parentEdgeId
        ? draft.edges[edge.parentEdgeId]?.childEdgeIds
        : draft.rootEdgeIds;
      const at = container?.indexOf(edgeId) ?? -1;
      if (container && at >= 0) container.splice(at, 1, e1.id, e2.id);
      else container?.push(e1.id, e2.id);
      draft.edges[e1.id] = e1;
      draft.edges[e2.id] = e2;
      draft.nodes[node.id] = node;
      delete draft.edges[edgeId];
    },
  };
}

// insert a synthetic midpoint task into a leaf edge, as two child edges:
// from -> mid -> to. By default the midpoint sits dead-center on the road
// line between the endpoints — on a vertical road that's directly above
// the lower node and directly under the upper one. Marked synthetic so
// status rollups skip it.
export function expandEdge(edgeId: Id, offset?: { dx: number; dy: number }) {
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
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      if (offset) {
        mid.x = mx + offset.dx;
        mid.y = my + offset.dy;
      } else {
        // a zero-length edge splits straight up so the midpoint doesn't
        // stack on its endpoints
        mid.x = mx;
        mid.y = my;
        if (from.x === to.x && from.y === to.y) mid.y -= 60;
      }
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
// A recurring task steps out of the machine: complete LOGS one occurrence
// (the stamp lands in `log`, sorted ascending, so a backdated log slots in
// under newer ones) and the task stays todo — the derived due state takes
// over; reopen un-logs the latest occurrence; start/pause don't apply.

export type StatusAction = "start" | "pause" | "complete" | "reopen";

// at backdates the stamp (logging yesterday's progress); defaults to now
export function transitionNodeStatus(id: Id, action: StatusAction, at?: number): Recipe {
  const stamp = () => at ?? Date.now();
  return (draft) => {
    const node = mustNode(draft, id);
    if (node.kind === "record") throw new DomainError("records have no status");
    if (node.kind === "goal") {
      if (action === "complete") node.completedAt = stamp();
      else if (action === "reopen") delete node.completedAt;
      else throw new DomainError(`cannot ${action} a goal`);
      return;
    }
    if (node.recur) {
      switch (action) {
        case "complete": {
          const atMs = stamp();
          const log = (node.log ??= []);
          let atIndex = log.length;
          while (atIndex > 0 && log[atIndex - 1] > atMs) atIndex--;
          log.splice(atIndex, 0, atMs);
          return;
        }
        case "reopen":
          if (!node.log || node.log.length === 0) {
            throw new DomainError("no logged occurrence to undo");
          }
          node.log.pop();
          return;
        default:
          throw new DomainError(`cannot ${action} a recurring task`);
      }
    }
    switch (action) {
      case "start":
        if (node.status !== "todo") throw new DomainError(`cannot start a ${node.status} task`);
        node.status = "in-progress";
        node.startedAt ??= stamp(); // records the FIRST start, never cleared
        break;
      case "pause":
        if (node.status !== "in-progress") throw new DomainError(`cannot pause a ${node.status} task`);
        node.status = "todo";
        break;
      case "complete":
        if (node.status === "done") throw new DomainError("task is already done");
        node.status = "done";
        node.completedAt = stamp();
        break;
      case "reopen":
        if (node.status !== "done") throw new DomainError(`cannot reopen a ${node.status} task`);
        node.status = "todo";
        delete node.completedAt;
        break;
    }
  };
}

// ---------- recurrence ----------

// make a task a standing habit (or stop it). Setting a rule resets the
// stored status: the derived due state takes over, startedAt/completedAt
// are cleared (the occurrence log owns the history now). Clearing the rule
// keeps the log — that history stays visible in the info card
export function setNodeRecurrence(id: Id, rule: RecurRule | null): Recipe {
  return (draft) => {
    const node = draft.nodes[id];
    if (!node || node.kind !== "task") return;
    if (rule) {
      node.recur = {
        freq: rule.freq,
        interval: Math.max(1, Math.round(rule.interval)),
        ...(rule.weekdays && rule.weekdays.length > 0 ? { weekdays: [...rule.weekdays] } : {}),
        anchor: rule.anchor,
      };
      node.status = "todo";
      delete node.startedAt;
      delete node.completedAt;
      delete node.dueDate; // the rule owns the schedule now
    } else {
      delete node.recur;
    }
  };
}

// ---------- timestamps ----------

// backdating: rewrite timestamps the creation/status commands stamped. The
// status machine keeps owning WHICH fields exist — startedAt/completedAt
// are only rewritten where already set (to start/complete, use
// transitionNodeStatus) — while a record's occurredAt, a goal's
// targetDate and a plain task's dueDate are always writable;
// targetDate/dueDate: null clears. A recurring task's schedule is its
// rule, so dueDate writes skip it
export function setNodeTimes(
  id: Id,
  times: {
    occurredAt?: number;
    startedAt?: number;
    completedAt?: number;
    targetDate?: number | null;
    dueDate?: number | null;
  },
): Recipe {
  return (draft) => {
    const node = draft.nodes[id];
    if (!node) return;
    if (node.kind === "record" && typeof times.occurredAt === "number") {
      node.occurredAt = times.occurredAt;
    }
    if (node.kind === "task") {
      if (typeof times.startedAt === "number" && node.startedAt !== undefined) {
        node.startedAt = times.startedAt;
      }
      if (typeof times.completedAt === "number" && node.completedAt !== undefined) {
        node.completedAt = times.completedAt;
      }
      if (!node.recur) {
        if (typeof times.dueDate === "number") node.dueDate = times.dueDate;
        else if (times.dueDate === null) delete node.dueDate;
      }
    }
    if (node.kind === "goal") {
      if (typeof times.completedAt === "number" && node.completedAt !== undefined) {
        node.completedAt = times.completedAt;
      }
      if (typeof times.targetDate === "number") node.targetDate = times.targetDate;
      else if (times.targetDate === null) delete node.targetDate;
    }
  };
}

// ---------- notes ----------

// notes stay newest-first BY occurred date, so a backdated note slots in
// under newer ones instead of landing on top
function insertNote(notes: NoteData[], note: NoteData) {
  const at = notes.findIndex((n) => n.createdAt <= note.createdAt);
  if (at === -1) notes.push(note);
  else notes.splice(at, 0, note);
}

// at backdates the note (logging after the fact); defaults to now
export function addNote(nodeId: Id, text: string, at?: number) {
  const noteId = newId();
  const trimmed = text.trim();
  return {
    noteId,
    recipe: (draft: Draft<LifeMapDoc>) => {
      if (!trimmed) return;
      const node = draft.nodes[nodeId];
      if (!node) return;
      const now = at ?? Date.now();
      insertNote(node.notes, { id: noteId, text: trimmed, createdAt: now, updatedAt: now });
    },
  };
}

// createdAt rewrites when the note (back)dates it; the list re-sorts so it
// stays newest-first. updatedAt always stamps the real edit time
export function updateNote(nodeId: Id, noteId: Id, text: string, createdAt?: number): Recipe {
  const trimmed = text.trim();
  return (draft) => {
    if (!trimmed) return;
    const node = draft.nodes[nodeId];
    const note = node?.notes.find((n) => n.id === noteId);
    if (!node || !note) return;
    note.text = trimmed;
    note.updatedAt = Date.now();
    if (typeof createdAt === "number" && createdAt !== note.createdAt) {
      note.createdAt = createdAt;
      node.notes.sort((a, b) => b.createdAt - a.createdAt);
    }
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
      // rule and occurrence log copy verbatim, like the other stamps
      const recur = parseRecurRule(d.recur);
      if (recur) node.recur = recur;
      const log = parseRecurLog(d.log);
      if (log) node.log = log;
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
    // tag assignments ride along; ids missing from the registry are kept
    // (they simply never render)
    if (Array.isArray(d.tagIds)) {
      node.tagIds = d.tagIds.filter((id): id is Id => typeof id === "string");
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
