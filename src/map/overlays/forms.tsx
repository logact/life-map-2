import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { styles } from "../styles";

export interface TextDraft {
  title: string;
  detail: string;
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
