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
}

// create form: goal (title + description), task (title),
// record (title + note + occurred date). The record's date row swaps the
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
  const [pickingDate, setPickingDate] = useState(false);
  // while the calendar is up, tap-away / back returns to the form instead
  // of discarding the draft
  const dismiss = pickingDate ? () => setPickingDate(false) : props.onClose;
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
            {pickingDate && draft.occurredAt !== undefined
              ? "Occurred"
              : mode === "goal"
                ? "New goal"
                : mode === "task"
                  ? "New task"
                  : "New record"}
          </Text>
          {pickingDate && draft.occurredAt !== undefined ? (
            <>
              <DatePickerBody
                value={draft.occurredAt}
                onChange={(ms) => props.onDraftChange({ ...draft, occurredAt: ms })}
              />
              <Pressable
                style={({ pressed }) => [styles.formSave, pressed && { opacity: 0.6 }]}
                onPress={() => setPickingDate(false)}
              >
                <Text style={styles.formSaveText}>Done</Text>
              </Pressable>
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
                  record; the row is the date's edit affordance */}
              {mode === "record" && draft.occurredAt !== undefined && (
                <Pressable style={styles.dateRow} onPress={() => setPickingDate(true)}>
                  <Text style={styles.dateRowLabel}>Occurred</Text>
                  <Text style={styles.dateRowValue}>{fmtDate(draft.occurredAt)}</Text>
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
