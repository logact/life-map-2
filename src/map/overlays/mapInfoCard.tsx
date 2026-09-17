import { Pressable, Text, View } from "react-native";

import { EdgeData, edgeDepth, LifeMapDoc, NodeData } from "@/domain/doc";
import { edgeStatus } from "@/domain/status";
import { InfoCard } from "../components/sheets";
import { styles } from "../styles";
import { InfoTarget } from "../types";
import { fmtDate } from "../utils";
import { nodeInfoLines } from "../viewModel";

// single-tap node card: title, fact lines, and a compact notes peek —
// the newest note (truncated) plus a "Notes (N) · View all" row. The
// full list with add/edit/delete lives in the modal notes sheet; the
// card itself never shows more than this peek.
function NodeInfoCard(props: {
  node: NodeData;
  doc: LifeMapDoc;
  onOpenNotes: () => void;
}) {
  const { node } = props;
  const newest = node.notes[0];
  return (
    <View style={styles.infoCard}>
      <View style={styles.infoHeader}>
        <Text style={[styles.infoTitle, { flex: 1 }]}>{node.title}</Text>
      </View>
      {nodeInfoLines(props.doc, node).map((l, i) => (
        <Text key={i} style={styles.infoMeta}>
          {l}
        </Text>
      ))}
      <View style={styles.infoNotesSep} />
      <Pressable onPress={props.onOpenNotes} style={({ pressed }) => pressed && { opacity: 0.6 }}>
        {newest ? (
          <>
            <Text style={styles.notePeekText} numberOfLines={2}>
              {newest.text}
            </Text>
            <Text style={styles.notePeekMeta}>
              {fmtDate(newest.createdAt)}
              {newest.updatedAt > newest.createdAt ? " · edited" : ""}
            </Text>
            <Text style={styles.notePeekLink}>Notes ({node.notes.length}) · View all ›</Text>
          </>
        ) : (
          <Text style={styles.notePeekLink}>Notes — tap to add</Text>
        )}
      </Pressable>
    </View>
  );
}

// single-tap info card: node card with the notes peek, or the edge peek
// card with its non-gesture zoom controls (one level per tap, the same
// operations as the pinch steps)
export function MapInfoCard(props: {
  infoTarget: InfoTarget;
  doc: LifeMapDoc;
  visible: EdgeData[];
  zoomedIds: ReadonlySet<string>;
  onOpenNotes: (nodeId: string) => void;
  onZoomStep: (deeper: boolean) => void;
  onCloseEdge: () => void;
}) {
  const { infoTarget, doc } = props;
  if (infoTarget.kind === "node") {
    const node = doc.nodes[infoTarget.id];
    if (!node) return null;
    return (
      <NodeInfoCard
        node={node}
        doc={doc}
        onOpenNotes={() => props.onOpenNotes(node.id)}
      />
    );
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
