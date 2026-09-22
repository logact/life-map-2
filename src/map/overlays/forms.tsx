import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { styles } from "../styles";
import { fmtDate } from "../utils";
import { DatePickerBody } from "./datePicker";

export interface TextDraft {
  title: string;
  detail: string;
  // a record's occurred-at (backdating); ignored by other kinds
  occurredAt?: number;
  // a goal's target date (optional); ignored by other kinds
  targetDate?: number;
}

// the date a form row is editing: the record's occurred-at or the goal's
// target date
type PickingField = "occurredAt" | "targetDate";

// create form: goal (title + description + optional target date), task
// (title), record (title + note + occurred date). A date row swaps the
// sheet's content to the calendar in place — a stacked Modal would not
// reliably come to the front on iOS
export function CreateNodeForm(props: {
  mode: "goal" | "task" | "record";
  draft: TextDraft;
  onDraftChange: (draft: TextDraft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { mode, draft } = props;
  const [picking, setPicking] = useState<PickingField | null>(null);
  // while the calendar is up, tap-away / back returns to the form instead
  // of discarding the draft
  const dismiss = picking ? () => setPicking(null) : props.onClose;
  const pickingValue = picking ? (draft[picking] ?? null) : null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={styles.formBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.formTitle}>
            {picking === "occurredAt"
              ? "Occurred"
              : picking === "targetDate"
                ? "Target"
                : mode === "goal"
                  ? "New goal"
                  : mode === "task"
                    ? "New task"
                    : "New record"}
          </Text>
          {picking && pickingValue !== null ? (
            <>
              <DatePickerBody
                value={pickingValue}
                onChange={(ms) => props.onDraftChange({ ...draft, [picking]: ms })}
              />
              <View style={styles.formButtons}>
                {picking === "targetDate" && (
                  <Pressable
                    style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                      props.onDraftChange({ ...draft, targetDate: undefined });
                      setPicking(null);
                    }}
                  >
                    <Text style={styles.formCancelText}>Clear</Text>
                  </Pressable>
                )}
                <View style={{ flex: 1 }} />
                <Pressable
                  style={({ pressed }) => [styles.formSave, pressed && { opacity: 0.6 }]}
                  onPress={() => setPicking(null)}
                >
                  <Text style={styles.formSaveText}>Done</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
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
              {/* the caller seeds occurredAt when the form opens for a
                  record; the goal's target date stays unset until picked —
                  each row is the date's edit affordance */}
              {mode === "record" && draft.occurredAt !== undefined && (
                <Pressable style={styles.dateRow} onPress={() => setPicking("occurredAt")}>
                  <Text style={styles.dateRowLabel}>Occurred</Text>
                  <Text style={styles.dateRowValue}>{fmtDate(draft.occurredAt)}</Text>
                </Pressable>
              )}
              {mode === "goal" && (
                <Pressable
                  style={styles.dateRow}
                  onPress={() => {
                    // the calendar needs a starting value; capture it in the
                    // press handler (Date.now() is impure in render)
                    if (draft.targetDate === undefined) {
                      props.onDraftChange({ ...draft, targetDate: Date.now() });
                    }
                    setPicking("targetDate");
                  }}
                >
                  <Text style={styles.dateRowLabel}>Target</Text>
                  <Text style={draft.targetDate !== undefined ? styles.dateRowValue : styles.infoDetailPlaceholder}>
                    {draft.targetDate !== undefined ? fmtDate(draft.targetDate) : "Set target date…"}
                  </Text>
                </Pressable>
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
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
