import { EdgeData, Id, LifeMapDoc, NodeData } from "./doc";

// one candidate route: the directed edges to travel, the nodes visited in
// order, and the total on-screen length used for ranking
export interface RouteResult {
  edges: EdgeData[];
  nodes: NodeData[];
  length: number;
}

// safety nets for dense graphs: stop enumerating paths longer than this,
// and stop the search once the candidate pool is comfortably larger than
// the number of results anyone will read (B24)
const MAX_HOPS = 15;
const MAX_CANDIDATE_POOL = 32;

// the length of one edge as drawn: through its bend when it has one, so the
// ranking matches what is on screen (B24)
function edgeLength(doc: LifeMapDoc, e: EdgeData): number {
  const a = doc.nodes[e.fromId];
  const b = doc.nodes[e.toId];
  if (!a || !b) return 0;
  if (e.bend) {
    return Math.hypot(e.bend.x - a.x, e.bend.y - a.y) + Math.hypot(b.x - e.bend.x, b.y - e.bend.y);
  }
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Find up to maxRoutes distinct directed routes from fromId to toId over
 * the given edge set (pass the currently visible edges so every route
 * edge can be rendered). Direction is respected: an edge can only be
 * traveled from -> to. Returns [] when there is no path.
 */
export function findRoutes(
  doc: LifeMapDoc,
  visible: EdgeData[],
  fromId: Id,
  toId: Id,
  maxRoutes: number = 3,
): RouteResult[] {
  if (fromId === toId) return [];
  if (!doc.nodes[fromId] || !doc.nodes[toId]) return [];

  // adjacency: directed out-edges per node id
  const outById = new Map<Id, EdgeData[]>();
  for (const e of visible) {
    const out = outById.get(e.fromId);
    if (out) out.push(e);
    else outById.set(e.fromId, [e]);
  }

  // DFS over simple paths (no repeated nodes), collecting candidates.
  // Early exit: once the pool is full, longer searches rarely change the
  // top maxRoutes after length sorting.
  const found: { edges: EdgeData[]; nodes: NodeData[] }[] = [];
  const visited = new Set<Id>([fromId]);
  const pathEdges: EdgeData[] = [];
  const pathNodes: NodeData[] = [doc.nodes[fromId]];

  const walk = (currentId: Id) => {
    if (found.length >= MAX_CANDIDATE_POOL) return;
    if (pathEdges.length >= MAX_HOPS) return;
    for (const e of outById.get(currentId) ?? []) {
      if (found.length >= MAX_CANDIDATE_POOL) return;
      const next = doc.nodes[e.toId];
      if (!next || visited.has(next.id)) continue;
      pathEdges.push(e);
      pathNodes.push(next);
      if (next.id === toId) {
        found.push({ edges: [...pathEdges], nodes: [...pathNodes] });
      } else {
        visited.add(next.id);
        walk(next.id);
        visited.delete(next.id);
      }
      pathEdges.pop();
      pathNodes.pop();
    }
  };
  walk(fromId);

  const withLength = found.map((r) => ({
    ...r,
    length: r.edges.reduce((sum, e) => sum + edgeLength(doc, e), 0),
  }));
  withLength.sort((a, b) => a.length - b.length);

  // dedupe identical node sequences, keep the shortest first
  const seen = new Set<string>();
  const result: RouteResult[] = [];
  for (const r of withLength) {
    const key = r.nodes.map((n) => n.id).join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
    if (result.length >= maxRoutes) break;
  }
  return result;
}
