import { Edge } from "./edge";
import { Node } from "./node";

// one candidate route: the directed edges to travel, the nodes visited in
// order, and the total on-screen length used for ranking
export interface RouteResult {
    edges: Edge[];
    nodes: Node[];
    length: number;
}

// safety net for dense graphs: stop enumerating paths longer than this
const MAX_HOPS = 15;

/**
 * Find up to maxRoutes distinct directed routes from fromId to toId over
 * the given edge set (pass the currently visible edges so every route
 * edge can be rendered). Direction is respected: an edge can only be
 * traveled node1 -> node2. Returns [] when there is no path.
 */
export function findRoutes(
    visibleEdges: Edge[],
    fromId: string,
    toId: string,
    maxRoutes: number = 3,
): RouteResult[] {
    if (fromId === toId) return [];

    // adjacency: directed out-edges per node id
    const nodesById = new Map<string, Node>();
    const outById = new Map<string, Edge[]>();
    for (const e of visibleEdges) {
        nodesById.set(e.node1.id, e.node1);
        nodesById.set(e.node2.id, e.node2);
        const out = outById.get(e.node1.id);
        if (out) out.push(e);
        else outById.set(e.node1.id, [e]);
    }
    if (!nodesById.has(fromId) || !nodesById.has(toId)) return [];

    // DFS over simple paths (no repeated nodes), collecting candidates
    const found: { edges: Edge[]; nodes: Node[] }[] = [];
    const visited = new Set<string>([fromId]);
    const pathEdges: Edge[] = [];
    const pathNodes: Node[] = [nodesById.get(fromId)!];

    const walk = (currentId: string) => {
        if (pathEdges.length >= MAX_HOPS) return;
        for (const e of outById.get(currentId) ?? []) {
            const next = e.node2;
            if (visited.has(next.id)) continue;
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
        length: r.edges.reduce(
            (sum, e) => sum + Math.hypot(e.node2.x - e.node1.x, e.node2.y - e.node1.y),
            0,
        ),
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
