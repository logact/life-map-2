import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { RecurFreq, RecurRule } from "@/domain/doc";
import { describeRecur } from "@/domain/recur";
import { styles } from "../styles";
import { fmtDate } from "../utils";
import { DatePickerBody } from "./datePicker";

// recurrence rule editor, in the app's sheet chrome: freq chips, an
// interval stepper, weekday chips (weekly only), and the anchor ("Starts")
// day. The anchor row swaps the sheet's content to the calendar in place —
// a stacked Modal would not reliably come to the front on iOS (the create
// form's date row does the same). Save hands back the normalized rule;
// Clear appears only when the task already repeats
const FREQS: { freq: RecurFreq; label: string }[] = [
  { freq: "daily", label: "Daily" },
  { freq: "weekly", label: "Weekly" },
  { freq: "monthly", label: "Monthly" },
];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const UNITS: Record<RecurFreq, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
};

export function RecurSheet(props: {
  // the task's current rule; null = not repeating yet
  rule: RecurRule | null;
  // anchors a brand-new rule (Date.now() is captured by the caller, not here)
  now: number;
  onSave: (rule: RecurRule) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [freq, setFreq] = useState<RecurFreq>(props.rule?.freq ?? "daily");
  const [interval, setInterval] = useState(props.rule?.interval ?? 1);
  const [anchor, setAnchor] = useState(props.rule?.anchor ?? props.now);
  const [weekdays, setWeekdays] = useState<number[]>(
    () => props.rule?.weekdays ?? [new Date(props.rule?.anchor ?? props.now).getDay()],
  );
  const [pickingAnchor, setPickingAnchor] = useState(false);

  const toggleWeekday = (d: number) =>
    setWeekdays((days) => (days.includes(d) ? days.filter((x) => x !== d) : [...days, d]));

  // the rule as currently edited; weekday order follows the calendar
  const draft: RecurRule = {
    freq,
    interval,
    ...(freq === "weekly" ? { weekdays: [...weekdays].sort((a, b) => a - b) } : {}),
    anchor,
  };
  const unit = UNITS[freq][interval === 1 ? 0 : 1];
  const valid = freq !== "weekly" || weekdays.length > 0;

  // while the calendar is up, tap-away / back returns to the editor
  const dismiss = pickingAnchor ? () => setPickingAnchor(false) : props.onClose;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={styles.formBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.formTitle}>{pickingAnchor ? "Starts" : "Repeat"}</Text>
          {pickingAnchor ? (
            <>
              <DatePickerBody value={anchor} onChange={setAnchor} />
              <Pressable
                style={({ pressed }) => [styles.formSave, pressed && { opacity: 0.6 }]}
                onPress={() => setPickingAnchor(false)}
              >
                <Text style={styles.formSaveText}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.recurChipRow}>
                {FREQS.map((f) => (
                  <Pressable
                    key={f.freq}
                    accessibilityLabel={f.label}
                    style={[styles.recurChip, freq === f.freq && styles.recurChipSelected]}
                    onPress={() => setFreq(f.freq)}
                  >
                    <Text style={[styles.recurChipText, freq === f.freq && styles.recurChipTextSelected]}>
                      {f.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.recurStepperRow}>
                <Text style={styles.dateRowLabel}>Every</Text>
                <Pressable
                  accessibilityLabel="Decrease interval"
                  hitSlop={12}
                  onPress={() => setInterval(Math.max(1, interval - 1))}
                >
                  <Text style={styles.calNav}>‹</Text>
                </Pressable>
                <Text style={styles.recurStepperValue}>{interval}</Text>
                <Pressable
                  accessibilityLabel="Increase interval"
                  hitSlop={12}
                  onPress={() => setInterval(Math.min(30, interval + 1))}
                >
                  <Text style={styles.calNav}>›</Text>
                </Pressable>
                <Text style={styles.dateRowValue}>{unit}</Text>
              </View>
              {freq === "weekly" && (
                <View style={styles.recurChipRow}>
                  {DOW.map((label, d) => (
                    <Pressable
                      key={d}
                      accessibilityLabel={`Weekday ${label}`}
                      style={[styles.recurChip, weekdays.includes(d) && styles.recurChipSelected]}
                      onPress={() => toggleWeekday(d)}
                    >
                      <Text
                        style={[styles.recurChipText, weekdays.includes(d) && styles.recurChipTextSelected]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Pressable style={styles.dateRow} onPress={() => setPickingAnchor(true)}>
                <Text style={styles.dateRowLabel}>Starts</Text>
                <Text style={styles.dateRowValue}>{fmtDate(anchor)}</Text>
              </Pressable>
              <Text style={styles.calSummary}>{valid ? describeRecur(draft) : "Pick at least one weekday"}</Text>
              <View style={styles.formButtons}>
                {props.rule && (
                  <Pressable
                    style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                      props.onClear();
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
                  style={({ pressed }) => [
                    styles.formSave,
                    !valid && styles.formSaveDisabled,
                    pressed && { opacity: 0.6 },
                  ]}
                  disabled={!valid}
                  onPress={() => props.onSave(draft)}
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
