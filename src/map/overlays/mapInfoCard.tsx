import { EdgeData, edgeDepth, LifeMapDoc } from "@/domain/doc";
import { edgeStatus } from "@/domain/status";
import { InfoCard } from "../components/sheets";
import { InfoTarget } from "../types";
import { nodeInfoLines } from "../viewModel";

// single-tap info card: read-only peek at a node or edge. The edge card
// also carries non-gesture zoom controls on the selected edge: one level
// per tap, the same operations as the pinch steps
export function MapInfoCard(props: {
  infoTarget: InfoTarget;
  doc: LifeMapDoc;
  visible: EdgeData[];
  zoomedIds: ReadonlySet<string>;
  onZoomStep: (deeper: boolean) => void;
  onCloseEdge: () => void;
}) {
  const { infoTarget, doc } = props;
  if (infoTarget.kind === "node") {
    const node = doc.nodes[infoTarget.id];
    if (!node) return null;
    return <InfoCard title={node.title} lines={nodeInfoLines(doc, node)} />;
  }
  const edge = props.visible.find((e) => e.id === infoTarget.id);
  if (!edge) return null;
  const from = doc.nodes[edge.fromId];
  const to = doc.nodes[edge.toId];
  if (!from || !to) return null;
  const s = edgeStatus(doc, edge.id);
  const layer = edgeDepth(doc, edge.id);
  const lines = [s ? `Layer ${layer} · ${s}` : `Layer ${layer}`];
  if (edge.childEdgeIds.length > 0) {
    lines.push(
      `${edge.childEdgeIds.length} hidden sub-edge${edge.childEdgeIds.length === 1 ? "" : "s"}`,
    );
  }
  const actions: { label: string; onPress: () => void }[] = [];
  if (edge.childEdgeIds.length > 0) {
    actions.push({ label: "Zoom in", onPress: () => props.onZoomStep(true) });
  }
  if (edge.parentEdgeId && props.zoomedIds.has(edge.parentEdgeId)) {
    actions.push({ label: "Collapse", onPress: () => props.onZoomStep(false) });
  }
  return (
    <InfoCard
      title={`${from.title} → ${to.title}`}
      lines={lines}
      actions={actions}
      onClose={props.onCloseEdge}
    />
  );
}
