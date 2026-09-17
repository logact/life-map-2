import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Recipe, removeNote } from "@/domain/commands";
import { NodeData } from "@/domain/doc";
import { SheetButton } from "../components/sheets";
import { styles } from "../styles";
import { fmtDate } from "../utils";

// notes sheet: a node's full notes list (newest first) with add/edit/delete.
// Opened from the node info card's peek row; text entry itself happens in
// the NoteEditorSheet stacked on top. Delete confirms in place (tap once
// to arm, again to fire) — the same pattern as the menus.
export function NotesSheet(props: {
  node: NodeData;
  run: (recipe: Recipe) => void;
  onAddNote: () => void;
  onEditNote: (noteId: string, text: string) => void;
  onClose: () => void;
}) {
  const { node } = props;
  const [armedNoteId, setArmedNoteId] = useState<string | null>(null);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.formBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
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
                        props.onEditNote(note.id, note.text);
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
            onPress={props.onAddNote}
          >
            <Text style={styles.formSaveText}>+ Add note</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// note editor: add a new note or edit an existing one, opened from the
// notes sheet. Text entry stays a modal sheet — the only surface modals
// are for (see DESIGN_MUTATIONS.md §9)
export function NoteEditorSheet(props: {
  nodeTitle: string;
  // present = editing that existing note
  noteId?: string;
  text: string;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
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
            {props.noteId ? "Edit note" : `Note on ${props.nodeTitle}`}
          </Text>
          <TextInput
            style={[styles.formInput, styles.formInputMultiline]}
            placeholder="Write a note…"
            value={props.text}
            onChangeText={props.onChangeText}
            multiline
            autoFocus
          />
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
                !props.text.trim() && styles.formSaveDisabled,
                pressed && { opacity: 0.6 },
              ]}
              disabled={!props.text.trim()}
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
