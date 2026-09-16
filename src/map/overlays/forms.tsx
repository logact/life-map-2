import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Recipe, transitionNodeStatus } from "@/domain/commands";
import { isGoal, isRecord, isTask, LifeMapDoc, NodeData } from "@/domain/doc";
import { goalStatus, nodeStatus } from "@/domain/status";
import { SheetButton } from "../components/sheets";
import { styles } from "../styles";
import { fmtDate } from "../utils";

export interface TextDraft {
  title: string;
  detail: string;
}

// inspector: edit the node's info. Status buttons act at once through
// run(); text edits stay local until Save
export function InspectorSheet(props: {
  node: NodeData;
  doc: LifeMapDoc;
  draft: TextDraft;
  onDraftChange: (draft: TextDraft) => void;
  run: (recipe: Recipe) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { node, doc, draft, run } = props;
  return (
    <>
      <Pressable style={styles.menuBackdrop} onPress={props.onClose} />
      <KeyboardAvoidingView
        style={styles.inspectorWrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
      >
        <View style={styles.inspectorSheet}>
          <Text style={styles.formTitle}>
            {node.kind === "goal"
              ? "Goal"
              : node.kind === "task"
                ? "Task"
                : "Record"}
          </Text>
          <TextInput
            style={styles.formInput}
            placeholder="Title"
            value={draft.title}
            onChangeText={(t) => props.onDraftChange({ ...draft, title: t })}
          />
          {!isTask(node) && (
            <TextInput
              style={[styles.formInput, styles.formInputMultiline]}
              placeholder={
                isGoal(node)
                  ? "Description (optional)"
                  : "Note (optional)"
              }
              value={draft.detail}
              onChangeText={(t) => props.onDraftChange({ ...draft, detail: t })}
              multiline
            />
          )}

          {/* status: tasks step through the state machine, goals only
              toggle the manual override (their status is derived from
              tasks, never stored) */}
          {isTask(node) && (
            <View style={styles.inspectorStatusRow}>
              <Text style={styles.inspectorStatusText}>
                Status: {nodeStatus(doc, node.id)}
              </Text>
              {(node.status ?? "todo") === "todo" && (
                <>
                  <SheetButton
                    label="Start"
                    onPress={() => run(transitionNodeStatus(node.id, "start"))}
                  />
                  <SheetButton
                    label="Mark done"
                    onPress={() => run(transitionNodeStatus(node.id, "complete"))}
                  />
                </>
              )}
              {node.status === "in-progress" && (
                <>
                  <SheetButton
                    label="Pause"
                    onPress={() => run(transitionNodeStatus(node.id, "pause"))}
                  />
                  <SheetButton
                    label="Complete"
                    onPress={() => run(transitionNodeStatus(node.id, "complete"))}
                  />
                </>
              )}
              {node.status === "done" && (
                <SheetButton
                  label="Reopen"
                  onPress={() => run(transitionNodeStatus(node.id, "reopen"))}
                />
              )}
            </View>
          )}
          {isGoal(node) && (
            <View style={styles.inspectorStatusRow}>
              <Text style={styles.inspectorStatusText}>
                Status: {goalStatus(doc, node.id)}
                {node.completedAt ? " (manual)" : ""}
              </Text>
              {node.completedAt ? (
                <SheetButton
                  label="Reopen"
                  onPress={() => run(transitionNodeStatus(node.id, "reopen"))}
                />
              ) : (
                <SheetButton
                  label="Mark done"
                  onPress={() => run(transitionNodeStatus(node.id, "complete"))}
                />
              )}
            </View>
          )}

          {/* read-only timestamps */}
          {isTask(node) && (node.startedAt || node.completedAt) && (
            <Text style={styles.inspectorMeta}>
              {node.startedAt ? `Started ${fmtDate(node.startedAt)}` : ""}
              {node.startedAt && node.completedAt ? "  ·  " : ""}
              {node.completedAt ? `Done ${fmtDate(node.completedAt)}` : ""}
            </Text>
          )}
          {isRecord(node) && node.occurredAt && (
            <Text style={styles.inspectorMeta}>
              Occurred {fmtDate(node.occurredAt)}
            </Text>
          )}

          <View style={styles.formButtons}>
            <Pressable
              style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
              onPress={props.onClose}
            >
              <Text style={styles.formCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.formSave,
                !draft.title.trim() && styles.formSaveDisabled,
                pressed && { opacity: 0.6 },
              ]}
              disabled={!draft.title.trim()}
              onPress={props.onSave}
            >
              <Text style={styles.formSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

// create form: goal (title + description), task (title),
// record (title + note)
export function CreateNodeForm(props: {
  mode: "goal" | "task" | "record";
  draft: TextDraft;
  onDraftChange: (draft: TextDraft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { mode, draft } = props;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <KeyboardAvoidingView
        style={styles.formBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.formTitle}>
            {mode === "goal"
              ? "New goal"
              : mode === "task"
                ? "New task"
                : "New record"}
          </Text>
          <TextInput
            style={styles.formInput}
            placeholder="Title"
            value={draft.title}
            onChangeText={(t) => props.onDraftChange({ ...draft, title: t })}
            autoFocus
          />
          {mode !== "task" && (
            <TextInput
              style={[styles.formInput, styles.formInputMultiline]}
              placeholder={
                mode === "goal"
                  ? "Description (optional)"
                  : "Note (optional)"
              }
              value={draft.detail}
              onChangeText={(t) => props.onDraftChange({ ...draft, detail: t })}
              multiline
            />
          )}
          <View style={styles.formButtons}>
            <Pressable
              style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
              onPress={props.onClose}
            >
              <Text style={styles.formCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.formSave,
                !draft.title.trim() && styles.formSaveDisabled,
                pressed && { opacity: 0.6 },
              ]}
              disabled={!draft.title.trim()}
              onPress={props.onSave}
            >
              <Text style={styles.formSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
