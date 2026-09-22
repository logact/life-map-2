import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { styles } from "../styles";
import { fmtDate } from "../utils";

// ---------- date picking: a small month calendar ----------
// No date-picker library is installed, so this is a plain-RN calendar in
// the app's own sheet chrome. DatePickerBody is the controlled calendar
// (used inline by sheets that swap their content in place — stacked Modals
// don't reliably come to the front on iOS); DatePickerSheet wraps it in a
// Modal with Save/Cancel for callers that are not already a modal (the
// info card). Picking a day keeps the current value's time-of-day.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function DatePickerBody(props: { value: number; onChange: (ms: number) => void }) {
  const selected = new Date(props.value);
  // the month on display: follows the selection home on open, then moves
  // with the nav arrows only (picking a day never jumps the view)
  const [view, setView] = useState(() => ({ y: selected.getFullYear(), m: selected.getMonth() }));

  const shiftMonth = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const pick = (day: number) => {
    const next = new Date(props.value);
    next.setFullYear(view.y, view.m, day); // time-of-day rides along
    props.onChange(next.getTime());
  };

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leadingBlanks = new Date(view.y, view.m, 1).getDay();
  const cells: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const today = new Date();

  return (
    <View>
      <View style={styles.calHeader}>
        <Pressable accessibilityLabel="Previous month" onPress={() => shiftMonth(-1)} hitSlop={12}>
          <Text style={styles.calNav}>‹</Text>
        </Pressable>
        <Text style={styles.calTitle}>
          {MONTHS[view.m]} {view.y}
        </Text>
        <Pressable accessibilityLabel="Next month" onPress={() => shiftMonth(1)} hitSlop={12}>
          <Text style={styles.calNav}>›</Text>
        </Pressable>
      </View>
      <View style={styles.calRow}>
        {DOW.map((d, i) => (
          <Text key={i} style={styles.calDow}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.calGrid}>
        {cells.map((day, i) =>
          day === null ? (
            <View key={`b${i}`} style={styles.calCell} />
          ) : (
            <Pressable
              key={day}
              accessibilityLabel={`${MONTHS[view.m]} ${day}`}
              style={[
                styles.calCell,
                sameDay(new Date(view.y, view.m, day), selected) && styles.calCellSelected,
                sameDay(new Date(view.y, view.m, day), today) && styles.calCellToday,
              ]}
              onPress={() => pick(day)}
            >
              <Text
                style={[
                  styles.calCellText,
                  sameDay(new Date(view.y, view.m, day), selected) && styles.calCellTextSelected,
                ]}
              >
                {day}
              </Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

// modal wrapper with the sheet chrome: title, the calendar, and
// Clear?/Cancel/Save. Clear only appears when the caller passes onClear
// (the goal's target date — the one optional date)
export function DatePickerSheet(props: {
  title: string;
  value: number;
  onDone: (ms: number) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(props.value);
  const { onClear } = props;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <KeyboardAvoidingView
        style={styles.formBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.formTitle}>{props.title}</Text>
          <DatePickerBody value={selected} onChange={setSelected} />
          <Text style={styles.calSummary}>{fmtDate(selected)}</Text>
          <View style={styles.formButtons}>
            {onClear && (
              <Pressable
                style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  onClear();
                  props.onClose();
                }}
              >
                <Text style={styles.formCancelText}>Clear</Text>
              </Pressable>
            )}
            <View style={{ flex: 1 }} />
            <Pressable
              style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
              onPress={props.onClose}
            >
              <Text style={styles.formCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.formSave, pressed && { opacity: 0.6 }]}
              onPress={() => props.onDone(selected)}
            >
              <Text style={styles.formSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
