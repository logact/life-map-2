import { useMemo } from "react";

import { edgeDepth, isGoal, isRecord, isTask, LifeMapDoc, NodeData } from "@/domain/doc";
import { edgeStatus, nodeStatus } from "@/domain/status";
import { visibleEdges, visibleIsolatedNodes } from "@/domain/visibility";
import { fmtDate } from "./utils";
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

// info card content for a single-tapped node
export function nodeInfoLines(doc: LifeMapDoc, node: NodeData): string[] {
  const s = nodeStatus(doc, node.id);
  const lines = [s ? `${node.kind} · ${s}` : node.kind];
  if (isGoal(node)) {
    if (node.description) lines.push(node.description);
    if (node.targetDate) lines.push(`Target ${fmtDate(node.targetDate)}`);
    if (node.completedAt) lines.push(`Done ${fmtDate(node.completedAt)}`);
  } else if (isTask(node)) {
    if (node.startedAt) lines.push(`Started ${fmtDate(node.startedAt)}`);
    if (node.completedAt) lines.push(`Done ${fmtDate(node.completedAt)}`);
  } else if (isRecord(node)) {
    if (node.note) lines.push(node.note);
    if (node.occurredAt) lines.push(`Occurred ${fmtDate(node.occurredAt)}`);
  }
  if (node.notes.length > 0) {
    lines.push(`${node.notes.length} note${node.notes.length === 1 ? "" : "s"}`);
  }
  return lines;
}
