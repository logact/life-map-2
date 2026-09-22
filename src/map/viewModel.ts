import { useMemo } from "react";

import { edgeDepth, LifeMapDoc, NodeData } from "@/domain/doc";
import { edgeStatus, nodeStatus } from "@/domain/status";
import { visibleEdges, visibleIsolatedNodes } from "@/domain/visibility";
import { EdgeViewModel, MapViewModel, NodeViewModel } from "./types";

// domain -> view model: walk the edges visible at the current zoom state,
// then the isolated nodes. visibleEdges is exactly the set of visible
// edges (zoomed edges are replaced by their children), so do NOT
// recurse into child edges here — they are not visible until revealed.
export function deriveViewModel(doc: LifeMapDoc, zoomedIds: ReadonlySet<string>): MapViewModel {
  const nodes = new Map<string, NodeViewModel>();
  const edges: EdgeViewModel[] = [];

  const addNode = (n: NodeData) => {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, { id: n.id, x: n.x, y: n.y, title: n.title, kind: n.kind, status: nodeStatus(doc, n.id) ?? undefined, color: n.color });
    }
  };

  for (const e of visibleEdges(doc, zoomedIds)) {
    edges.push({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      layer: edgeDepth(doc, e.id),
      status: edgeStatus(doc, e.id),
      bend: e.bend,
      color: e.color,
      hiddenCount: e.childEdgeIds.length,
      segments: e.childEdgeIds.length > 0
        ? e.childEdgeIds.map((cid) => ({ color: doc.edges[cid]?.color, status: edgeStatus(doc, cid) }))
        : undefined,
    });
    const a = doc.nodes[e.fromId];
    const b = doc.nodes[e.toId];
    if (a) addNode(a);
    if (b) addNode(b);
  }

  for (const n of visibleIsolatedNodes(doc)) {
    addNode(n);
  }
  return { nodes: [...nodes.values()], edges };
}

// memoized domain -> UI derivation, kept in its own hook: MapScreen itself
// is skipped by the React Compiler (it writes camera refs during render),
// so a useMemo inside it could not be preserved
export function useMapViewModel(doc: LifeMapDoc, zoomedIds: ReadonlySet<string>) {
  const visible = useMemo(() => visibleEdges(doc, zoomedIds), [doc, zoomedIds]);
  const vm = useMemo(() => deriveViewModel(doc, zoomedIds), [doc, zoomedIds]);
  return { visible, vm };
}
