import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Recipe, removeNote } from "@/domain/commands";
import { NodeData } from "@/domain/doc";
import { SheetButton } from "../components/sheets";
import { styles } from "../styles";
import { fmtDate } from "../utils";

// notes sheet: the node's notes newest-first, with add/edit/delete
export function NotesSheet(props: {
  node: NodeData;
  run: (recipe: Recipe) => void;
  onEditNote: (noteId: string, text: string) => void;
  onAddNote: () => void;
  onClose: () => void;
}) {
  const { node } = props;
  const confirmRemoveNote = (noteId: string) => {
    Alert.alert("Remove note", "Remove this note?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          props.run(removeNote(node.id, noteId));
        },
      },
    ]);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.formBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.formTitle}>{node.title}</Text>
          <Text style={styles.noteSheetCount}>
            {node.notes.length === 0
              ? "No notes yet"
              : `${node.notes.length} note${node.notes.length === 1 ? "" : "s"}`}
          </Text>
          <ScrollView style={styles.notesList}>
            {node.notes.map((note) => (
              <View key={note.id} style={styles.noteRow}>
                <Text style={styles.noteRowText}>{note.text}</Text>
                <View style={styles.noteRowFooter}>
                  <Text style={styles.noteRowMeta}>
                    {fmtDate(note.createdAt)}
                    {note.updatedAt > note.createdAt ? " · edited" : ""}
                  </Text>
                  {/* iOS shows only one Modal at a time: swapping the list
                      for the editor (which reopens it on close) is wired by
                      the parent through onEditNote/onAddNote */}
                  <SheetButton
                    label="Edit"
                    onPress={() => props.onEditNote(note.id, note.text)}
                  />
                  <SheetButton label="Delete" onPress={() => confirmRemoveNote(note.id)} />
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.formButtons}>
            <Pressable
              style={({ pressed }) => [styles.formSave, pressed && { opacity: 0.6 }]}
              onPress={props.onAddNote}
            >
              <Text style={styles.formSaveText}>+ Add note</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// note editor: add a new note or edit an existing one
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
