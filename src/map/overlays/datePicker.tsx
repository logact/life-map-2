import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { styles } from "../styles";
import { fmtDate, fmtDateTime } from "../utils";

// ---------- date picking: a small month calendar ----------
// No date-picker library is installed, so this is a plain-RN calendar in
// the app's own sheet chrome. DatePickerBody is the controlled calendar
// (used inline by sheets that swap their content in place — stacked Modals
// don't reliably come to the front on iOS); DatePickerSheet wraps it in a
// Modal with Save/Cancel for callers that are not already a modal (the
// info card). Picking a day keeps the current value's time-of-day.
//
// Callers that pass hasTime/onHasTimeChange get a time row under the
// calendar: an "All day" chip and hour/minute steppers. Without the pair
// the calendar is day-only, exactly as before.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function DatePickerBody(props: {
  value: number;
  onChange: (ms: number) => void;
  // both present = the time row shows; both absent = day-only picking
  hasTime?: boolean;
  onHasTimeChange?: (on: boolean) => void;
}) {
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

  // the steppers wrap inside their unit (the modulo keeps hour/minute in
  // range without ever rolling the date itself into the next day)
  const shiftHour = (delta: number) => {
    const next = new Date(props.value);
    next.setHours((next.getHours() + delta + 24) % 24, next.getMinutes(), 0, 0);
    props.onChange(next.getTime());
  };
  const shiftMinute = (delta: number) => {
    const next = new Date(props.value);
    next.setHours(next.getHours(), (next.getMinutes() + delta + 60) % 60, 0, 0);
    props.onChange(next.getTime());
  };
  // enabling time on a day-only value (local midnight) defaults to 9:00 —
  // a midnight deadline reads as a mistake more often than intent
  const enableTime = () => {
    const cur = new Date(props.value);
    if (cur.getHours() === 0 && cur.getMinutes() === 0) {
      const next = new Date(props.value);
      next.setHours(9, 0, 0, 0);
      props.onChange(next.getTime());
    }
    props.onHasTimeChange?.(true);
  };

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leadingBlanks = new Date(view.y, view.m, 1).getDay();
  const cells: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const today = new Date();
  const hasTime = props.hasTime ?? false;

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
      {props.onHasTimeChange && (
        <View style={styles.recurStepperRow}>
          <Text style={styles.dateRowLabel}>Time</Text>
          <Pressable
            accessibilityLabel="All day"
            style={[styles.recurChip, !hasTime && styles.recurChipSelected]}
            onPress={() => props.onHasTimeChange!(false)}
          >
            <Text style={[styles.recurChipText, !hasTime && styles.recurChipTextSelected]}>All day</Text>
          </Pressable>
          {hasTime ? (
            <>
              <Pressable accessibilityLabel="Decrease hour" hitSlop={12} onPress={() => shiftHour(-1)}>
                <Text style={styles.calNav}>‹</Text>
              </Pressable>
              <Text style={styles.recurStepperValue}>{String(selected.getHours()).padStart(2, "0")}</Text>
              <Pressable accessibilityLabel="Increase hour" hitSlop={12} onPress={() => shiftHour(1)}>
                <Text style={styles.calNav}>›</Text>
              </Pressable>
              <Text style={styles.recurStepperValue}>:</Text>
              <Pressable accessibilityLabel="Decrease minutes" hitSlop={12} onPress={() => shiftMinute(-5)}>
                <Text style={styles.calNav}>‹</Text>
              </Pressable>
              <Text style={styles.recurStepperValue}>{String(selected.getMinutes()).padStart(2, "0")}</Text>
              <Pressable accessibilityLabel="Increase minutes" hitSlop={12} onPress={() => shiftMinute(5)}>
                <Text style={styles.calNav}>›</Text>
              </Pressable>
            </>
          ) : (
            <Pressable accessibilityLabel="Set a time" style={styles.recurChip} onPress={enableTime}>
              <Text style={styles.recurChipText}>At a time</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// modal wrapper with the sheet chrome: title, the calendar, and
// Clear?/Cancel/Save. Clear only appears when the caller passes onClear
// (the goal's target date — the one optional date). Passing hasTime opts
// the picker into time-of-day editing; onDone then reports the flag too
export function DatePickerSheet(props: {
  title: string;
  value: number;
  hasTime?: boolean;
  onDone: (ms: number, hasTime?: boolean) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(props.value);
  const [hasTime, setHasTime] = useState(props.hasTime ?? false);
  const { onClear } = props;
  const timed = props.hasTime !== undefined;
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
          <DatePickerBody
            value={selected}
            onChange={setSelected}
            {...(timed ? { hasTime, onHasTimeChange: setHasTime } : {})}
          />
          <Text style={styles.calSummary}>{timed ? fmtDateTime(selected, hasTime) : fmtDate(selected)}</Text>
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
              onPress={() => props.onDone(selected, timed ? hasTime : undefined)}
            >
              <Text style={styles.formSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
