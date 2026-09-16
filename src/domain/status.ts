import { EdgeData, Id, isRecord, isTask, LifeMapDoc, Status } from "./doc";
import { getIndexes } from "./indexes";

// ---------- status as pure derivation over the doc ----------
//
// Goal status is DERIVED, never stored: manual completion (completedAt set)
// wins; otherwise roll up child tasks. Synthetic expand-midpoints are
// structure, not real child tasks, so they are skipped — expanding an edge
// under a goal must never flip the goal's status (B13).

export function nodeStatus(doc: LifeMapDoc, id: Id): Status | null {
  const n = doc.nodes[id];
  if (!n) return null;
  if (isTask(n)) return n.status ?? "todo";
  if (n.kind === "goal") return goalStatus(doc, id);
  return null;
}

export function goalStatus(doc: LifeMapDoc, goalId: Id): Status {
  const goal = doc.nodes[goalId];
  if (!goal) return "todo";
  if (goal.completedAt) return "done";
  const idx = getIndexes(doc);
  const tasks = (idx.outEdgeIds.get(goalId) ?? [])
    .map((eid) => doc.edges[eid]?.toId)
    .map((nid) => (nid ? doc.nodes[nid] : undefined))
    .filter((n): n is NonNullable<typeof n> => !!n && isTask(n) && !n.synthetic);
  if (tasks.length === 0) return "todo";
  if (tasks.every((t) => (t.status ?? "todo") === "done")) return "done";
  if (tasks.some((t) => (t.status ?? "todo") !== "todo")) return "in-progress";
  return "todo";
}

// ---------- Edge status: frontier semantics ----------
//
// An edge shows the status of the first unfinished step on the road it
// represents: walk the hidden child chain -> to-node, take the first
// non-done status; if everything is done, the road is done. The source
// node's own status is skipped — it is already drawn on the node itself.
// Records have no status, so edges touching one stay plain (null).

// the chain an edge stands for, in travel order: expand() children form
// from -> ... -> to; side-branch children follow in insertion order
function flattenChain(doc: LifeMapDoc, edge: EdgeData): Id[] {
  if (edge.childEdgeIds.length === 0) return [edge.fromId, edge.toId];
  const seq: Id[] = [];
  for (const childId of edge.childEdgeIds) {
    const child = doc.edges[childId];
    if (!child) continue;
    const part = flattenChain(doc, child);
    if (seq.length > 0 && seq[seq.length - 1] === part[0]) part.shift();
    seq.push(...part);
  }
  return seq;
}

export function edgeStatus(doc: LifeMapDoc, edgeId: Id): Status | null {
  const edge = doc.edges[edgeId];
  if (!edge) return null;
  const from = doc.nodes[edge.fromId];
  const to = doc.nodes[edge.toId];
  if (!from || !to || isRecord(from) || isRecord(to)) return null;
  for (const nodeId of flattenChain(doc, edge).slice(1)) {
    const s = nodeStatus(doc, nodeId);
    if (s !== null && s !== "done") return s;
  }
  return "done";
}
