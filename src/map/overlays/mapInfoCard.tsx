import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Recipe, renameNode, setNodeDetail, setNodeRecurrence, setNodeTimes, StatusAction, transitionNodeStatus } from "@/domain/commands";
import { EdgeData, edgeDepth, isGoal, isRecord, isTask, LifeMapDoc, NodeData } from "@/domain/doc";
import { describeRecur, dueState, nextDue, prevDue, recurStats } from "@/domain/recur";
import { edgeStatus, nodeStatus } from "@/domain/status";
import { SheetButton } from "../components/sheets";
import { styles } from "../styles";
import { InfoTarget } from "../types";
import { fmtDate, fmtRelative } from "../utils";
import { DatePickerSheet } from "./datePicker";
import { RecurSheet } from "./recurSheet";
import { TagPickerSheet } from "./tagPicker";

type EditField = "title" | "detail";

// the node's editable timestamps (backdating): the record's occurred-at is
// always offered; startedAt/completedAt only where the status machine has
// already created them (transition first, then rewrite the date); the
// goal's target date and a plain task's due date are always offered and
// are the clearable fields
type DateField = "occurredAt" | "startedAt" | "completedAt" | "targetDate" | "dueDate";

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
  // the screen's clock, captured outside render: feeds the recurring
  // task's due-state text and the goal target's countdown
  now: number;
}) {
  const { node } = props;
  const [editing, setEditing] = useState<EditField | null>(null);
  const [draft, setDraft] = useState("");
  // the date field open in the picker sheet, with the value it opened on
  // (captured in the tap handler — Date.now() is impure in render)
  const [dateField, setDateField] = useState<{ field: DateField; label: string; value: number } | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [recurOpen, setRecurOpen] = useState(false);
  // tasks carry no detail; the goal's detail is its description, the
  // record's is its note (same mapping the old inspector used)
  const detailValue = isGoal(node)
    ? (node.description ?? "")
    : isRecord(node)
      ? (node.note ?? "")
      : null;
  // one button per legal transition, labeled by its target state (records
  // carry no status, so they get no row); a goal's status stays derived —
  // its button toggles only the manual completion flag. A recurring task
  // logs occurrences instead of completing: Log done / Undo last log
  const status = nodeStatus(props.doc, node.id, props.now);
  const transitions: { label: string; action: StatusAction }[] = [];
  if (isTask(node)) {
    if (node.recur) {
      transitions.push({ label: "Log done", action: "complete" });
      if ((node.log ?? []).length > 0) transitions.push({ label: "Undo last log", action: "reopen" });
    } else {
      const s = node.status ?? "todo";
      if (s === "todo") {
        transitions.push({ label: "Start", action: "start" }, { label: "Mark done", action: "complete" });
      } else if (s === "in-progress") {
        transitions.push({ label: "Pause", action: "pause" }, { label: "Mark done", action: "complete" });
      } else {
        transitions.push({ label: "Reopen", action: "reopen" });
      }
    }
  } else if (isGoal(node)) {
    transitions.push(
      node.completedAt
        ? { label: "Reopen", action: "reopen" }
        : { label: "Mark done", action: "complete" },
    );
  }

  // a recurring habit replaces the bare status word with its due state,
  // and adds a running count underneath
  const due = isTask(node) && node.recur ? dueState(node, props.now) : null;
  const recurText = (() => {
    if (!node.recur || !due) return "";
    switch (due) {
      case "done-today":
        return "Done today ✓";
      case "due":
        return "Due today";
      case "overdue": {
        const missed = prevDue(node.recur, props.now);
        return missed ? `Overdue since ${fmtDate(missed)}` : "Overdue";
      }
      default:
        return `Next ${fmtDate(nextDue(node.recur, props.now))}`;
    }
  })();
  const stats = node.recur ? recurStats(node.recur, node.log ?? [], props.now) : null;

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

  // the node's tags in registry order, resolved from the registry;
  // dangling ids (clipboard carry-over from another doc) never render
  const nodeTagIds = node.tagIds ?? [];
  const assignedTags = Object.values(props.doc.tags).filter((t) => nodeTagIds.includes(t.id));

  // the node's date rows, in display order; tapping one opens the picker
  const dateRows: { field: DateField; label: string; value?: number; placeholder?: string }[] = [];
  if (isRecord(node)) {
    dateRows.push({ field: "occurredAt", label: "Occurred", value: node.occurredAt, placeholder: "Set date…" });
  } else if (isTask(node)) {
    // a habit's schedule is its rule (the Repeat row below); a plain task
    // carries a one-off due date instead
    if (!node.recur) {
      dateRows.push({ field: "dueDate", label: "Due", value: node.dueDate, placeholder: "Set due date…" });
    }
    if (node.startedAt !== undefined) dateRows.push({ field: "startedAt", label: "Started", value: node.startedAt });
    if (node.completedAt !== undefined) dateRows.push({ field: "completedAt", label: "Done", value: node.completedAt });
  } else {
    dateRows.push({ field: "targetDate", label: "Target", value: node.targetDate, placeholder: "Set target date…" });
    if (node.completedAt !== undefined) dateRows.push({ field: "completedAt", label: "Done", value: node.completedAt });
  }

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
      <Text style={styles.infoMeta}>{node.kind}</Text>
      {/* tag row: one chip per assigned tag plus a "+" opener, all
          opening the picker sheet; synthetic midpoint nodes carry no
          tags, so they get no row */}
      {!node.synthetic && (
        <View style={styles.tagRow}>
          {assignedTags.map((t) => (
            <Pressable
              key={t.id}
              style={({ pressed }) => [styles.tagChip, pressed && { opacity: 0.6 }]}
              onPress={() => {
                endEdit();
                setTagPickerOpen(true);
              }}
            >
              <View style={[styles.tagChipDot, { backgroundColor: t.color }]} />
              <Text style={styles.tagChipText}>{t.name}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityLabel="Edit tags"
            style={({ pressed }) => [styles.tagChip, pressed && { opacity: 0.6 }]}
            onPress={() => {
              endEdit();
              setTagPickerOpen(true);
            }}
          >
            <Text style={styles.tagChipAddText}>+ Tag</Text>
          </Pressable>
        </View>
      )}
      {dateRows.map((r) => (
        <Pressable
          key={r.field}
          style={styles.dateRow}
          onPress={() => {
            // a tap elsewhere on the card commits any active text edit; the
            // picker's opening value is captured here, in the press handler —
            // Date.now() is impure and must not run during render
            endEdit();
            setDateField({ field: r.field, label: r.label, value: r.value ?? Date.now() });
          }}
        >
          <Text style={styles.dateRowLabel}>{r.label}</Text>
          <Text style={r.value !== undefined ? styles.dateRowValue : styles.infoDetailPlaceholder}>
            {r.value !== undefined
              ? r.field === "targetDate" || r.field === "dueDate"
                ? `${fmtDate(r.value)} · ${fmtRelative(r.value, props.now)}`
                : fmtDate(r.value)
              : r.placeholder}
          </Text>
        </Pressable>
      ))}
      {/* recurrence: every task carries a Repeat row (synthetic midpoints
          excepted — they are structure, not real tasks) */}
      {isTask(node) && !node.synthetic && (
        <Pressable
          style={styles.dateRow}
          onPress={() => {
            endEdit();
            setRecurOpen(true);
          }}
        >
          <Text style={styles.dateRowLabel}>Repeat</Text>
          <Text style={node.recur ? styles.dateRowValue : styles.infoDetailPlaceholder}>
            {node.recur ? describeRecur(node.recur) : "Not repeating"}
          </Text>
        </Pressable>
      )}
      {status !== null && (
        <View style={styles.infoStatusRow}>
          <Text style={styles.infoStatusText}>
            {due ? recurText : `Status: ${status}${isGoal(node) && node.completedAt ? " (manual)" : ""}`}
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
      {stats && stats.total > 0 && (
        <Text style={styles.infoMeta}>
          {stats.total} logged{stats.streak > 0 ? ` · streak ${stats.streak}` : ""}
        </Text>
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
      {/* backdating: the tapped date row's picker; Save rewrites the
          timestamp through one undoable command */}
      {dateField && (
        <DatePickerSheet
          title={dateField.label}
          value={dateField.value}
          onDone={(ms) => {
            props.run(setNodeTimes(node.id, { [dateField.field]: ms }));
            setDateField(null);
          }}
          onClear={
            dateField.field === "targetDate" || dateField.field === "dueDate"
              ? () =>
                  props.run(
                    setNodeTimes(
                      node.id,
                      dateField.field === "targetDate" ? { targetDate: null } : { dueDate: null },
                    ),
                  )
              : undefined
          }
          onClose={() => setDateField(null)}
        />
      )}
      {tagPickerOpen && (
        <TagPickerSheet
          node={node}
          doc={props.doc}
          run={props.run}
          onClose={() => setTagPickerOpen(false)}
        />
      )}
      {/* recurrence rule editor; Save/Clear go through one undoable
          command each */}
      {recurOpen && (
        <RecurSheet
          rule={node.recur ?? null}
          now={props.now}
          onSave={(rule) => {
            props.run(setNodeRecurrence(node.id, rule));
            setRecurOpen(false);
          }}
          onClear={() => props.run(setNodeRecurrence(node.id, null))}
          onClose={() => setRecurOpen(false)}
        />
      )}
    </View>
  );
}

// single-tap edge card: layer/status facts plus non-gesture zoom controls
// (one level per tap, the same operations as the pinch steps)
function EdgeInfoCard(props: {
  edge: EdgeData;
  doc: LifeMapDoc;
  zoomedIds: ReadonlySet<string>;
  onZoomStep: (deeper: boolean) => void;
  onClose: () => void;
  now: number;
}) {
  const { edge, doc } = props;
  const from = doc.nodes[edge.fromId];
  const to = doc.nodes[edge.toId];
  if (!from || !to) return null;
  const s = edgeStatus(doc, edge.id, props.now);
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
    </View>
  );
}

// single-tap info card: the node card (inline title/detail editing plus
// the notes peek) or the edge card (facts + zoom controls)
export function MapInfoCard(props: {
  infoTarget: InfoTarget;
  doc: LifeMapDoc;
  visible: EdgeData[];
  zoomedIds: ReadonlySet<string>;
  run: (recipe: Recipe) => void;
  onOpenNotes: (nodeId: string) => void;
  onZoomStep: (deeper: boolean) => void;
  onCloseEdge: () => void;
  now: number;
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
        now={props.now}
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
      onZoomStep={props.onZoomStep}
      onClose={props.onCloseEdge}
      now={props.now}
    />
  );
}
