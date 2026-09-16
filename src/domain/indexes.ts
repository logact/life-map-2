import { Id, LifeMapDoc } from "./doc";

// ---------- derived adjacency, memoized by doc identity ----------
// The doc stores edges only; "which edges touch node X" is derived. Rebuilt
// once per doc version (docs are immutable, so a WeakMap keyed on the doc
// is an exact cache — a new doc identity always means new contents).

export interface DocIndexes {
  // node id -> edges leaving it (fromId === id)
  outEdgeIds: Map<Id, Id[]>;
  // node id -> edges arriving at it (toId === id)
  inEdgeIds: Map<Id, Id[]>;
}

const cache = new WeakMap<LifeMapDoc, DocIndexes>();

export function getIndexes(doc: LifeMapDoc): DocIndexes {
  let idx = cache.get(doc);
  if (!idx) {
    idx = build(doc);
    cache.set(doc, idx);
  }
  return idx;
}

function build(doc: LifeMapDoc): DocIndexes {
  const outEdgeIds = new Map<Id, Id[]>();
  const inEdgeIds = new Map<Id, Id[]>();
  for (const e of Object.values(doc.edges)) {
    push(outEdgeIds, e.fromId, e.id);
    push(inEdgeIds, e.toId, e.id);
  }
  return { outEdgeIds, inEdgeIds };
}

function push(map: Map<Id, Id[]>, key: Id, id: Id) {
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
}

// every edge touching the node, outgoing first — matches the old
// [...node.startEdges, ...node.endEdges] ordering used by removeNode
export function incidentEdgeIds(doc: LifeMapDoc, nodeId: Id): Id[] {
  const idx = getIndexes(doc);
  return [...(idx.outEdgeIds.get(nodeId) ?? []), ...(idx.inEdgeIds.get(nodeId) ?? [])];
}
