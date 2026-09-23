import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { NodeKind } from "@/domain/doc";
import { fmtDate } from "@/map/utils";
import { BACKDROP, INK } from "@/ui/theme";

// the calendar's create chooser: which kind to add on the selected day.
// Each kind carries the day onto the node in its own way — a goal takes it
// as the target date, a task as its one-off due date, a record as its
// occurred-at — so what you make here is what the day lists. Picking a
// kind swaps this sheet for the shared create form (sequential modals: a
// stacked Modal would not reliably come to the front on iOS)
export function CreateSheet(props: {
  // the selected calendar day (local midnight)
  dayMs: number;
  onPick: (kind: NodeKind) => void;
  onClose: () => void;
}) {
  const rows: { kind: NodeKind; glyph: string; label: string; hint: string }[] = [
    { kind: "goal", glyph: "◎", label: "Goal", hint: "Target this day" },
    { kind: "task", glyph: "☑", label: "Task", hint: "Due this day" },
    { kind: "record", glyph: "✎", label: "Record", hint: "Log this day" },
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={cs.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View style={cs.sheet}>
          <View style={cs.handle} />
          <Text style={cs.title}>New on {fmtDate(props.dayMs)}</Text>
          {rows.map((r) => (
            <Pressable
              key={r.kind}
              accessibilityLabel={`New ${r.label.toLowerCase()} on this day`}
              style={({ pressed }) => [cs.row, pressed && { opacity: 0.6 }]}
              onPress={() => props.onPick(r.kind)}
            >
              <Text style={cs.glyph}>{r.glyph}</Text>
              <Text style={cs.rowTitle}>{r.label}</Text>
              <Text style={cs.hint}>{r.hint}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const cs = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: BACKDROP,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 6,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d8dade",
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: INK.primary,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: INK.subtle,
  },
  glyph: {
    fontSize: 16,
    color: INK.primary,
    width: 22,
    textAlign: "center",
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: INK.primary,
  },
  hint: {
    fontSize: 12,
    color: INK.tertiary,
  },
});
