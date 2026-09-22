import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { addTag, deleteTag, Recipe, renameTag, setNodeTags, setTagColor } from "@/domain/commands";
import { findTagByName, Id, LifeMapDoc, NodeData } from "@/domain/doc";
import { PALETTE } from "@/ui/palette";
import { SheetButton } from "../components/sheets";
import { styles } from "../styles";

// tag picker sheet: every tag in the registry as a row (colored dot,
// name, check when assigned to the current node). Tapping a row toggles
// the assignment immediately (undoable, no confirm). A row's Edit
// affordance swaps it
// for an inline editor (name field + palette strip + delete); the footer
// creates a new tag and assigns it in one save. Rendered by the node
// info card only while open — a single Modal whose content swaps in
// place, since stacked Modals don't reliably come to the front on iOS.
// RN never blurs a TextInput for taps on sibling Pressables, so every
// control ends the active inline edit first — the press commits the
// rename draft and acts in one motion (the info card's discipline).
export function TagPickerSheet(props: {
  node: NodeData;
  doc: LifeMapDoc;
  run: (recipe: Recipe) => void;
  onClose: () => void;
}) {
  const { node, doc } = props;
  // registry order; dangling ids (clipboard carry-over, a tag deleted
  // elsewhere) never render and are dropped on the next setNodeTags
  const tags = Object.values(doc.tags);
  const assigned = new Set((node.tagIds ?? []).filter((id) => doc.tags[id]));

  // inline row editor: which tag is being renamed/recolored, plus its
  // name draft; delete confirms in place (tap once to arm, again to fire
  // — the same pattern as the menus and the notes sheet)
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [editName, setEditName] = useState("");
  const [armed, setArmed] = useState(false);

  // the footer create form: name + palette color, defaulting to the next
  // color by tag count (the same default addTag applies)
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(() => PALETTE[tags.length % PALETTE.length].color);

  const endEdit = () => {
    if (!editingId) return;
    const tag = doc.tags[editingId];
    const name = editName.trim();
    if (tag && name && name !== tag.name) props.run(renameTag(editingId, name));
    setEditingId(null);
    setArmed(false);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setArmed(false);
  };
  const close = () => {
    // dismissing the sheet still saves an in-progress rename — a tap
    // elsewhere commits and acts in one motion
    endEdit();
    props.onClose();
  };

  const currentIds = () => (node.tagIds ?? []).filter((id) => doc.tags[id]);

  const toggle = (tagId: Id) => {
    endEdit();
    const next = assigned.has(tagId)
      ? currentIds().filter((id) => id !== tagId)
      : [...currentIds(), tagId];
    props.run(setNodeTags(node.id, next));
  };

  const startEdit = (tagId: Id, name: string) => {
    endEdit(); // commit whichever row was open
    setEditName(name);
    setEditingId(tagId);
  };

  const removeTag = () => {
    if (!editingId) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    // deleteTag strips the id from every node's tagIds, so the current
    // node unassigns implicitly
    props.run(deleteTag(editingId));
    setEditingId(null);
    setArmed(false);
  };

  const saveNew = () => {
    endEdit();
    const name = newName.trim();
    if (!name) return;
    // a duplicate name (folded) selects the existing tag instead of
    // creating a twin — addTag's recipe would no-op, so assign directly
    const existing = findTagByName(doc, name);
    if (existing) {
      if (!assigned.has(existing.id)) props.run(setNodeTags(node.id, [...currentIds(), existing.id]));
    } else {
      const { tagId, recipe } = addTag(name, newColor);
      props.run(recipe);
      props.run(setNodeTags(node.id, [...currentIds(), tagId]));
    }
    setNewName("");
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.formBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.formTitle}>Tags on {node.title}</Text>
          {tags.length === 0 ? (
            <Text style={styles.infoMeta}>No tags yet — create one below</Text>
          ) : (
            <ScrollView style={styles.tagPickList} keyboardShouldPersistTaps="handled">
              {tags.map((tag) =>
                editingId === tag.id ? (
                  <View key={tag.id} style={styles.tagEditBox}>
                    <TextInput
                      style={styles.formInput}
                      value={editName}
                      onChangeText={setEditName}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={endEdit}
                      onBlur={endEdit}
                    />
                    <View style={styles.swatchRow}>
                      {PALETTE.map((c) => (
                        <Pressable
                          key={c.color}
                          accessibilityLabel={c.label}
                          onPress={() => props.run(setTagColor(tag.id, c.color))}
                          style={[
                            styles.swatch,
                            { backgroundColor: c.color },
                            tag.color === c.color && styles.swatchSelected,
                          ]}
                        />
                      ))}
                    </View>
                    <View style={styles.formButtons}>
                      <SheetButton label={armed ? "Tap again" : "Delete"} onPress={removeTag} />
                      <View style={{ flex: 1 }} />
                      <Pressable
                        style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
                        onPress={cancelEdit}
                      >
                        <Text style={styles.formCancelText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.formSave, pressed && { opacity: 0.6 }]}
                        onPress={endEdit}
                      >
                        <Text style={styles.formSaveText}>Save</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    key={tag.id}
                    style={({ pressed }) => [styles.tagPickRow, pressed && styles.tagPickRowPressed]}
                    onPress={() => toggle(tag.id)}
                  >
                    <View style={[styles.menuDot, { backgroundColor: tag.color }]} />
                    <Text style={styles.tagPickName} numberOfLines={1}>
                      {tag.name}
                    </Text>
                    <Text style={styles.tagPickCheck}>{assigned.has(tag.id) ? "✓" : ""}</Text>
                    {/* nested pressable: edit opens the row's editor without
                        triggering the row's assignment toggle */}
                    <Pressable
                      accessibilityLabel={`Edit tag ${tag.name}`}
                      hitSlop={8}
                      onPress={() => startEdit(tag.id, tag.name)}
                    >
                      <Text style={styles.tagPickEditText}>Edit</Text>
                    </Pressable>
                  </Pressable>
                ),
              )}
            </ScrollView>
          )}
          <Text style={styles.tagNewLabel}>New tag</Text>
          <TextInput
            style={styles.formInput}
            placeholder="Tag name…"
            value={newName}
            onChangeText={setNewName}
            onFocus={endEdit}
            returnKeyType="done"
            onSubmitEditing={saveNew}
          />
          <View style={styles.swatchRow}>
            {PALETTE.map((c) => (
              <Pressable
                key={c.color}
                accessibilityLabel={c.label}
                onPress={() => setNewColor(c.color)}
                style={[
                  styles.swatch,
                  { backgroundColor: c.color },
                  newColor === c.color && styles.swatchSelected,
                ]}
              />
            ))}
          </View>
          <View style={styles.formButtons}>
            <View style={{ flex: 1 }} />
            <Pressable
              style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
              onPress={close}
            >
              <Text style={styles.formCancelText}>Done</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.formSave,
                !newName.trim() && styles.formSaveDisabled,
                pressed && { opacity: 0.6 },
              ]}
              disabled={!newName.trim()}
              onPress={saveNew}
            >
              <Text style={styles.formSaveText}>Add tag</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
