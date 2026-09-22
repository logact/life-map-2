import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Recipe, renameNode, setEdgeColor, setNodeDetail, StatusAction, transitionNodeStatus } from "@/domain/commands";
import { EdgeData, edgeDepth, isGoal, isRecord, isTask, LifeMapDoc, NodeData } from "@/domain/doc";
import { edgeStatus, nodeStatus } from "@/domain/status";
import { PALETTE } from "@/ui/palette";
import { SheetButton } from "../components/sheets";
import { styles } from "../styles";
import { InfoTarget } from "../types";
import { fmtDate } from "../utils";
import { nodeInfoLines } from "../viewModel";

type EditField = "title" | "detail";

// single-tap node card: title, fact lines, the status row with its legal
// transition buttons, an inline-editable detail row (the goal's
// description / record's note; tasks have none), and a compact notes
// peek. The title and detail edit in place — tap the text, type, and the
// edit commits on submit, on the ✓ button, on blur, or when the card
// unmounts mid-edit (a tap elsewhere dismisses and retargets in one
// motion, and that still saves); the ✕ button discards the draft. RN
// never blurs a TextInput for taps on sibling Pressables, so every other
// control on the card ends the active edit first — the press commits the
// draft and acts in one motion. Status buttons act immediately; the card
// stays open so the new status is visible in place. The full notes list
// lives in the modal notes sheet; the card itself never shows more than
// this peek.
function NodeInfoCard(props: {
  node: NodeData;
  doc: LifeMapDoc;
  run: (recipe: Recipe) => void;
  onOpenNotes: () => void;
}) {
  const { node } = props;
  const [editing, setEditing] = useState<EditField | null>(null);
  const [draft, setDraft] = useState("");
  // tasks carry no detail; the goal's detail is its description, the
  // record's is its note (same mapping the old inspector used)
  const detailValue = isGoal(node)
    ? (node.description ?? "")
    : isRecord(node)
      ? (node.note ?? "")
      : null;
  // one button per legal transition, labeled by its target state (records
  // carry no status, so they get no row); a goal's status stays derived —
  // its button toggles only the manual completion flag
  const status = nodeStatus(props.doc, node.id);
  const transitions: { label: string; action: StatusAction }[] = [];
  if (isTask(node)) {
    const s = node.status ?? "todo";
    if (s === "todo") {
      transitions.push({ label: "Start", action: "start" }, { label: "Mark done", action: "complete" });
    } else if (s === "in-progress") {
      transitions.push({ label: "Pause", action: "pause" }, { label: "Mark done", action: "complete" });
    } else {
      transitions.push({ label: "Reopen", action: "reopen" });
    }
  } else if (isGoal(node)) {
    transitions.push(
      node.completedAt
        ? { label: "Reopen", action: "reopen" }
        : { label: "Mark done", action: "complete" },
    );
  }

  const commit = (field: EditField, text: string) => {
    if (field === "title") {
      const title = text.trim();
      if (title && title !== node.title) props.run(renameNode(node.id, title));
    } else if (detailValue !== null && text.trim() !== detailValue) {
      props.run(setNodeDetail(node.id, text));
    }
  };

  // refs mirror the latest edit state so the unmount cleanup can commit
  // it (the refs rule forbids writing them during render)
  const latestRef = useRef<{ editing: EditField | null; draft: string }>({ editing: null, draft: "" });
  const commitRef = useRef(commit);
  useEffect(() => {
    latestRef.current = { editing, draft };
    commitRef.current = commit;
  });
  useEffect(
    () => () => {
      const { editing: field, draft: text } = latestRef.current;
      if (field) commitRef.current(field, text);
    },
    [],
  );

  const startEdit = (field: EditField, initial: string) => {
    // moving between fields commits the previous one first
    if (editing && editing !== field) commit(editing, draft);
    setDraft(initial);
    setEditing(field);
  };
  // every edit-end path funnels through these (submit, blur, ✓/✕, a press
  // on another control). They clear the ref first, so a late native onBlur
  // or the unmount cleanup can't re-commit an already-ended (or discarded)
  // draft.
  const endEdit = () => {
    const { editing: field, draft: text } = latestRef.current;
    if (!field) return;
    commit(field, text);
    latestRef.current = { editing: null, draft: "" };
    setEditing(null);
  };
  const cancelEdit = () => {
    latestRef.current = { editing: null, draft: "" };
    setEditing(null);
  };
  // a blur only ends the edit if it belongs to the field that is still
  // active — a late blur from an input that was just swapped out (field
  // switch, ✓/✕, card close) must not kill the new session
  const onTitleBlur = () => {
    if (latestRef.current.editing === "title") endEdit();
  };
  const onDetailBlur = () => {
    if (latestRef.current.editing === "detail") endEdit();
  };

  const newest = node.notes[0];
  return (
    <View style={styles.infoCard}>
      <View style={styles.infoHeader}>
        {editing === "title" ? (
          <>
            <TextInput
              style={[styles.infoTitleInput, { flex: 1 }]}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={endEdit}
              onBlur={onTitleBlur}
            />
            <Pressable accessibilityLabel="Save title" onPress={endEdit} hitSlop={8}>
              <Text style={styles.infoClose}>✓</Text>
            </Pressable>
            <Pressable accessibilityLabel="Cancel title edit" onPress={cancelEdit} hitSlop={8}>
              <Text style={styles.infoClose}>✕</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={{ flex: 1 }} onPress={() => startEdit("title", node.title)}>
            <Text style={styles.infoTitle}>{node.title}</Text>
          </Pressable>
        )}
      </View>
      {nodeInfoLines(node).map((l, i) => (
        <Text key={i} style={styles.infoMeta}>
          {l}
        </Text>
      ))}
      {status !== null && (
        <View style={styles.infoStatusRow}>
          <Text style={styles.infoStatusText}>
            Status: {status}
            {isGoal(node) && node.completedAt ? " (manual)" : ""}
          </Text>
          {transitions.map((t) => (
            <SheetButton
              key={t.action}
              label={t.label}
              onPress={() => {
                endEdit();
                props.run(transitionNodeStatus(node.id, t.action));
              }}
            />
          ))}
        </View>
      )}
      {detailValue !== null &&
        (editing === "detail" ? (
          <View>
            <TextInput
              style={styles.infoDetailInput}
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              onBlur={onDetailBlur}
            />
            <View style={styles.infoEditActions}>
              <Pressable accessibilityLabel="Save" onPress={endEdit} hitSlop={8}>
                <Text style={styles.infoClose}>✓</Text>
              </Pressable>
              <Pressable accessibilityLabel="Cancel edit" onPress={cancelEdit} hitSlop={8}>
                <Text style={styles.infoClose}>✕</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => startEdit("detail", detailValue)}>
            <Text style={detailValue ? styles.infoMeta : styles.infoDetailPlaceholder}>
              {detailValue || (isGoal(node) ? "Add description…" : "Add note…")}
            </Text>
          </Pressable>
        ))}
      <View style={styles.infoNotesSep} />
      <Pressable
        onPress={() => {
          endEdit();
          props.onOpenNotes();
        }}
        style={({ pressed }) => pressed && { opacity: 0.6 }}
      >
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

// single-tap edge card: layer/status facts, non-gesture zoom controls
// (one level per tap, the same operations as the pinch steps), and an
// inline color row — a swatch tap recolors the edge immediately
// (undoable, no confirm — the same semantics as the edge menu)
function EdgeInfoCard(props: {
  edge: EdgeData;
  doc: LifeMapDoc;
  zoomedIds: ReadonlySet<string>;
  run: (recipe: Recipe) => void;
  onZoomStep: (deeper: boolean) => void;
  onClose: () => void;
}) {
  const { edge, doc } = props;
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
    <View style={styles.infoCard}>
      <View style={styles.infoHeader}>
        <Text style={[styles.infoTitle, { flex: 1 }]} numberOfLines={1}>
          {from.title} → {to.title}
        </Text>
        <Pressable onPress={props.onClose} hitSlop={8}>
          <Text style={styles.infoClose}>✕</Text>
        </Pressable>
      </View>
      {lines.map((l, i) => (
        <Text key={i} style={styles.infoMeta}>
          {l}
        </Text>
      ))}
      {actions.length > 0 && (
        <View style={styles.infoActions}>
          {actions.map((a) => (
            <SheetButton key={a.label} label={a.label} onPress={a.onPress} />
          ))}
        </View>
      )}
      <View style={styles.swatchRow}>
        <Pressable
          accessibilityLabel="Default color"
          onPress={() => props.run(setEdgeColor(edge.id, undefined))}
          style={[styles.swatchDefault, !edge.color && styles.swatchSelected]}
        >
          <Text style={styles.swatchDefaultText}>∅</Text>
        </Pressable>
        {PALETTE.map((c) => (
          <Pressable
            key={c.color}
            accessibilityLabel={c.label}
            onPress={() => props.run(setEdgeColor(edge.id, c.color))}
            style={[
              styles.swatch,
              { backgroundColor: c.color },
              edge.color === c.color && styles.swatchSelected,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

// single-tap info card: the node card (inline title/detail editing plus
// the notes peek) or the edge card (zoom controls + inline color)
export function MapInfoCard(props: {
  infoTarget: InfoTarget;
  doc: LifeMapDoc;
  visible: EdgeData[];
  zoomedIds: ReadonlySet<string>;
  run: (recipe: Recipe) => void;
  onOpenNotes: (nodeId: string) => void;
  onZoomStep: (deeper: boolean) => void;
  onCloseEdge: () => void;
}) {
  const { infoTarget, doc } = props;
  if (infoTarget.kind === "node") {
    const node = doc.nodes[infoTarget.id];
    if (!node) return null;
    return (
      // keyed by node id: switching focus mid-edit unmounts the old card,
      // which commits its draft instead of leaking it onto the new node
      <NodeInfoCard
        key={node.id}
        node={node}
        doc={doc}
        run={props.run}
        onOpenNotes={() => props.onOpenNotes(node.id)}
      />
    );
  }
  const edge = props.visible.find((e) => e.id === infoTarget.id);
  if (!edge) return null;
  return (
    <EdgeInfoCard
      edge={edge}
      doc={doc}
      zoomedIds={props.zoomedIds}
      run={props.run}
      onZoomStep={props.onZoomStep}
      onClose={props.onCloseEdge}
    />
  );
}
