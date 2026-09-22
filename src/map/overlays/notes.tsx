import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Recipe, removeNote } from "@/domain/commands";
import { NodeData } from "@/domain/doc";
import { SheetButton } from "../components/sheets";
import { styles } from "../styles";
import { fmtDate } from "../utils";

// notes sheet: a node's full notes list (newest first) with add/edit/delete.
// Opened from the node info card's peek row. The editor is NOT a second
// modal stacked on top — a Modal presented while another Modal is visible
// doesn't reliably come to the front on iOS — so this one sheet swaps its
// content between the list and the editor (draft != null means editing).
// Delete confirms in place (tap once to arm, again to fire) — the same
// pattern as the menus.
export function NotesSheet(props: {
  node: NodeData;
  run: (recipe: Recipe) => void;
  // the note being added or edited (noteId present = editing an existing
  // note); null shows the list
  draft: { noteId?: string; text: string } | null;
  onChangeDraftText: (text: string) => void;
  onStartAdd: () => void;
  onStartEdit: (noteId: string, text: string) => void;
  onSaveDraft: () => void;
  onCloseDraft: () => void;
  onClose: () => void;
}) {
  const { node, draft } = props;
  const [armedNoteId, setArmedNoteId] = useState<string | null>(null);
  // while the editor is up, tap-away / back just returns to the list
  const dismiss = draft ? props.onCloseDraft : props.onClose;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={styles.formBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
        {draft ? (
          <View style={styles.formSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.formTitle}>
              {draft.noteId ? "Edit note" : `Note on ${node.title}`}
            </Text>
            <TextInput
              style={[styles.formInput, styles.formInputMultiline]}
              placeholder="Write a note…"
              value={draft.text}
              onChangeText={props.onChangeDraftText}
              multiline
              autoFocus
            />
            <View style={styles.formButtons}>
              <Pressable
                style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
                onPress={props.onCloseDraft}
              >
                <Text style={styles.formCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.formSave,
                  !draft.text.trim() && styles.formSaveDisabled,
                  pressed && { opacity: 0.6 },
                ]}
                disabled={!draft.text.trim()}
                onPress={props.onSaveDraft}
              >
                <Text style={styles.formSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.formSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.formTitle}>Notes on {node.title}</Text>
            {node.notes.length === 0 ? (
              <Text style={styles.infoMeta}>No notes yet</Text>
            ) : (
              <ScrollView style={styles.notesSheetList}>
                {node.notes.map((note) => (
                  <View key={note.id} style={styles.noteRow}>
                    <Text style={styles.noteRowText}>{note.text}</Text>
                    <View style={styles.noteRowFooter}>
                      <Text style={styles.noteRowMeta}>
                        {fmtDate(note.createdAt)}
                        {note.updatedAt > note.createdAt ? " · edited" : ""}
                      </Text>
                      <SheetButton
                        label="Edit"
                        onPress={() => {
                          setArmedNoteId(null);
                          props.onStartEdit(note.id, note.text);
                        }}
                      />
                      <SheetButton
                        label={armedNoteId === note.id ? "Tap again" : "Delete"}
                        onPress={() => {
                          if (armedNoteId === note.id) {
                            setArmedNoteId(null);
                            props.run(removeNote(node.id, note.id));
                          } else {
                            setArmedNoteId(note.id);
                          }
                        }}
                      />
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            <Pressable
              style={({ pressed }) => [styles.formSave, pressed && { opacity: 0.6 }]}
              onPress={props.onStartAdd}
            >
              <Text style={styles.formSaveText}>+ Add note</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
