import { EdgeData, edgeDepth, Id, LifeMapDoc, NodeData } from "./doc";

// ---------- selection-scoped zoom: the lens ----------
// `zoomedIds` is pure view state (owned by the UI, never persisted): the ids
// of edges currently zoomed open. Everything here is a pure function of
// (doc, lens) — there is no LayerView object to keep in sync, so the visible
// frontier can never disagree with the document.

// the visible frontier: walk the edge tree, descending into zoomed edges and
// keeping every other edge visible. Invariant: a visible edge's children are
// never visible at the same time.
export function visibleEdges(doc: LifeMapDoc, zoomedIds: ReadonlySet<Id>): EdgeData[] {
  const result: EdgeData[] = [];
  const walk = (id: Id) => {
    const e = doc.edges[id];
    if (!e) return;
    if (zoomedIds.has(id) && e.childEdgeIds.length > 0) {
      e.childEdgeIds.forEach(walk);
    } else {
      result.push(e);
    }
  };
  doc.rootEdgeIds.forEach(walk);
  return result;
}

export function visibleIsolatedNodes(doc: LifeMapDoc): NodeData[] {
  return doc.rootNodeIds.map((id) => doc.nodes[id]).filter((n): n is NodeData => !!n);
}

// zoom the given visible edges one level deeper. Returns the next lens and
// the revealed child edge ids (so the caller can inherit them into its
// selection). Edges without children are a no-op.
export function zoomInIds(
  doc: LifeMapDoc,
  zoomedIds: ReadonlySet<Id>,
  edgeIds: Id[],
): { next: Set<Id>; revealed: Id[] } {
  const ids = new Set(edgeIds);
  const next = new Set(zoomedIds);
  const revealed: Id[] = [];
  for (const e of visibleEdges(doc, zoomedIds)) {
    if (ids.has(e.id) && e.childEdgeIds.length > 0) {
      next.add(e.id);
      revealed.push(...e.childEdgeIds);
    }
  }
  return { next: revealed.length > 0 ? next : new Set(zoomedIds), revealed };
}

// collapse the deepest selected frontier one level: each affected edge folds
// back into its parent together with its whole sibling group (the frontier
// invariant forbids collapsing just one child). Returns the parent edges so
// the caller can inherit them into its selection.
export function zoomOutIds(
  doc: LifeMapDoc,
  zoomedIds: ReadonlySet<Id>,
  edgeIds: Id[],
): { next: Set<Id>; parents: Id[] } {
  const ids = new Set(edgeIds);
  const candidates = visibleEdges(doc, zoomedIds).filter(
    (e) => ids.has(e.id) && e.parentEdgeId !== null && zoomedIds.has(e.parentEdgeId),
  );
  if (candidates.length === 0) {
    return { next: new Set(zoomedIds), parents: [] };
  }
  // mixed-depth selections collapse one level at a time, deepest first
  const deepest = Math.max(...candidates.map((e) => edgeDepth(doc, e.id)));
  const parents = new Map<Id, Id>();
  for (const e of candidates) {
    if (edgeDepth(doc, e.id) === deepest && e.parentEdgeId) {
      parents.set(e.parentEdgeId, e.parentEdgeId);
    }
  }
  const next = new Set(zoomedIds);
  for (const id of parents.keys()) next.delete(id);
  return { next, parents: [...parents.values()] };
}

// zoom open every ancestor of the edge so the edge itself becomes visible
// (used to focus a node hidden in collapsed layers)
export function revealEdge(doc: LifeMapDoc, zoomedIds: ReadonlySet<Id>, edgeId: Id): Set<Id> {
  const next = new Set(zoomedIds);
  let p = doc.edges[edgeId]?.parentEdgeId;
  while (p) {
    next.add(p);
    p = doc.edges[p]?.parentEdgeId ?? null;
  }
  return next;
}

// fold everything back to the top layer
export function resetZoom(): Set<Id> {
  return new Set();
}
