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
// the calendar is day-only, exactly as before. timeRequired (a record's
// occurred-at — always an exact moment) forces the row on with no All-day
// chip; seconds adds a seconds stepper and keeps sub-minute precision.

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
  // both present = the time row shows with an All-day toggle; both absent =
  // day-only picking
  hasTime?: boolean;
  onHasTimeChange?: (on: boolean) => void;
  // a moment that is always exact (a record's occurred-at): the time row is
  // always on, with no All-day toggle
  timeRequired?: boolean;
  // show a seconds stepper and keep sub-minute precision in the steppers
  seconds?: boolean;
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

  // the steppers wrap inside their unit (the modulo keeps hour/minute/second
  // in range without ever rolling the date itself into the next day). In
  // seconds mode the sub-minute precision rides along; otherwise the
  // steppers zero it as before
  const shiftHour = (delta: number) => {
    const next = new Date(props.value);
    next.setHours(
      (next.getHours() + delta + 24) % 24,
      next.getMinutes(),
      props.seconds ? next.getSeconds() : 0,
      0,
    );
    props.onChange(next.getTime());
  };
  const shiftMinute = (delta: number) => {
    const next = new Date(props.value);
    next.setHours(
      next.getHours(),
      (next.getMinutes() + delta + 60) % 60,
      props.seconds ? next.getSeconds() : 0,
      0,
    );
    props.onChange(next.getTime());
  };
  const shiftSecond = (delta: number) => {
    const next = new Date(props.value);
    next.setHours(next.getHours(), next.getMinutes(), (next.getSeconds() + delta + 60) % 60, 0);
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
  const hasTime = (props.hasTime ?? false) || (props.timeRequired ?? false);

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
      {(props.onHasTimeChange || props.timeRequired) && (
        <View style={styles.recurStepperRow}>
          <Text style={styles.dateRowLabel}>Time</Text>
          {props.onHasTimeChange && (
            <Pressable
              accessibilityLabel="All day"
              style={[styles.recurChip, !hasTime && styles.recurChipSelected]}
              onPress={() => props.onHasTimeChange!(false)}
            >
              <Text style={[styles.recurChipText, !hasTime && styles.recurChipTextSelected]}>All day</Text>
            </Pressable>
          )}
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
              {props.seconds && (
                <>
                  <Text style={styles.recurStepperValue}>:</Text>
                  <Pressable accessibilityLabel="Decrease seconds" hitSlop={12} onPress={() => shiftSecond(-5)}>
                    <Text style={styles.calNav}>‹</Text>
                  </Pressable>
                  <Text style={styles.recurStepperValue}>{String(selected.getSeconds()).padStart(2, "0")}</Text>
                  <Pressable accessibilityLabel="Increase seconds" hitSlop={12} onPress={() => shiftSecond(5)}>
                    <Text style={styles.calNav}>›</Text>
                  </Pressable>
                </>
              )}
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
// the picker into time-of-day editing; onDone then reports the flag too.
// timeRequired (records) keeps time editing always on, seconds adds the
// seconds stepper
export function DatePickerSheet(props: {
  title: string;
  value: number;
  hasTime?: boolean;
  timeRequired?: boolean;
  seconds?: boolean;
  onDone: (ms: number, hasTime?: boolean) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(props.value);
  const [hasTime, setHasTime] = useState(props.hasTime ?? false);
  const { onClear } = props;
  const timed = props.hasTime !== undefined || props.timeRequired === true;
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
            seconds={props.seconds}
            {...(props.timeRequired ? { timeRequired: true } : timed ? { hasTime, onHasTimeChange: setHasTime } : {})}
          />
          <Text style={styles.calSummary}>
            {timed ? fmtDateTime(selected, props.timeRequired ? true : hasTime, props.seconds) : fmtDate(selected)}
          </Text>
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
              onPress={() => props.onDone(selected, timed ? (props.timeRequired ? true : hasTime) : undefined)}
            >
              <Text style={styles.formSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- range picking: start and end on ONE calendar ----------
// Used inline by the settings export card — deliberately not a Modal:
// iOS can't present the share sheet while a Modal is mid-dismissal,
// which silently swallowed the export. Two edge chips choose which bound
// the calendar edits; each edge has its own time row (全天 = start at
// 00:00 / end at 23:59, or 指定时间 with hour/minute steppers). Every
// change keeps start <= end by pulling the other edge along.

// one edge's time row: an All-day chip plus hour/minute steppers, the
// same idiom as DatePickerBody's time row
function RangeTimeRow(props: {
  label: string;
  value: number;
  hasTime: boolean;
  // what 全天 means for this edge: start snaps to 00:00, end to 23:59 so
  // the whole day is inside the range
  endOfDay?: boolean;
  onChange: (ms: number, hasTime: boolean) => void;
}) {
  const setTimeOfDay = (h: number, m: number) => {
    const next = new Date(props.value);
    next.setHours(h, m, 0, 0);
    return next;
  };
  // the steppers wrap inside their unit, never rolling the date itself
  const shiftHour = (delta: number) => {
    const d = new Date(props.value);
    props.onChange(setTimeOfDay((d.getHours() + delta + 24) % 24, d.getMinutes()).getTime(), true);
  };
  const shiftMinute = (delta: number) => {
    const d = new Date(props.value);
    props.onChange(setTimeOfDay(d.getHours(), (d.getMinutes() + delta + 60) % 60).getTime(), true);
  };
  const selected = new Date(props.value);
  return (
    <View style={styles.recurStepperRow}>
      <Text style={styles.dateRowLabel}>{props.label}</Text>
      <Pressable
        accessibilityLabel={`${props.label} 全天`}
        style={[styles.recurChip, !props.hasTime && styles.recurChipSelected]}
        onPress={() => {
          const t = props.endOfDay ? setTimeOfDay(23, 59) : setTimeOfDay(0, 0);
          props.onChange(t.getTime(), false);
        }}
      >
        <Text style={[styles.recurChipText, !props.hasTime && styles.recurChipTextSelected]}>全天</Text>
      </Pressable>
      {props.hasTime ? (
        <>
          <Pressable accessibilityLabel={`${props.label}减一小时`} hitSlop={12} onPress={() => shiftHour(-1)}>
            <Text style={styles.calNav}>‹</Text>
          </Pressable>
          <Text style={styles.recurStepperValue}>{String(selected.getHours()).padStart(2, "0")}</Text>
          <Pressable accessibilityLabel={`${props.label}加一小时`} hitSlop={12} onPress={() => shiftHour(1)}>
            <Text style={styles.calNav}>›</Text>
          </Pressable>
          <Text style={styles.recurStepperValue}>:</Text>
          <Pressable accessibilityLabel={`${props.label}减五分钟`} hitSlop={12} onPress={() => shiftMinute(-5)}>
            <Text style={styles.calNav}>‹</Text>
          </Pressable>
          <Text style={styles.recurStepperValue}>{String(selected.getMinutes()).padStart(2, "0")}</Text>
          <Pressable accessibilityLabel={`${props.label}加五分钟`} hitSlop={12} onPress={() => shiftMinute(5)}>
            <Text style={styles.calNav}>›</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityLabel={`${props.label} 指定时间`}
          style={styles.recurChip}
          onPress={() => props.onChange(setTimeOfDay(9, 0).getTime(), true)}
        >
          <Text style={styles.recurChipText}>指定时间</Text>
        </Pressable>
      )}
    </View>
  );
}

export function DateRangePickerBody(props: {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  const [editing, setEditing] = useState<"start" | "end">("start");
  const [startHasTime, setStartHasTime] = useState(false);
  const [endHasTime, setEndHasTime] = useState(false);
  // the month on display: follows the start home on open, then moves with
  // the nav arrows only
  const [view, setView] = useState(() => {
    const d = new Date(props.start);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const shiftMonth = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  // picking a day moves the editing edge, keeping its time-of-day; the
  // other edge moves along so start <= end always holds
  const pick = (day: number) => {
    const next = new Date(editing === "start" ? props.start : props.end);
    next.setFullYear(view.y, view.m, day);
    const ms = next.getTime();
    if (editing === "start") {
      props.onChange(ms, Math.max(ms, props.end));
    } else {
      props.onChange(Math.min(ms, props.start), ms);
    }
  };

  const setStart = (ms: number, hasTime: boolean) => {
    setStartHasTime(hasTime);
    props.onChange(ms, Math.max(ms, props.end));
  };
  const setEnd = (ms: number, hasTime: boolean) => {
    setEndHasTime(hasTime);
    props.onChange(Math.min(ms, props.start), ms);
  };

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leadingBlanks = new Date(view.y, view.m, 1).getDay();
  const cells: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const today = new Date();
  const startDate = new Date(props.start);
  const endDate = new Date(props.end);

  return (
    <View>
      <View style={styles.recurChipRow}>
        <Pressable
          accessibilityLabel="编辑开始日期"
          style={[styles.recurChip, editing === "start" && styles.recurChipSelected]}
          onPress={() => setEditing("start")}
        >
          <Text style={[styles.recurChipText, editing === "start" && styles.recurChipTextSelected]}>
            开始 {fmtDate(props.start)}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="编辑结束日期"
          style={[styles.recurChip, editing === "end" && styles.recurChipSelected]}
          onPress={() => setEditing("end")}
        >
          <Text style={[styles.recurChipText, editing === "end" && styles.recurChipTextSelected]}>
            结束 {fmtDate(props.end)}
          </Text>
        </Pressable>
      </View>
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
        {cells.map((day, i) => {
          if (day === null) return <View key={`b${i}`} style={styles.calCell} />;
          const cell = new Date(view.y, view.m, day);
          const isEdge = sameDay(cell, startDate) || sameDay(cell, endDate);
          const inRange = cell.getTime() > dayStartOf(startDate) && cell.getTime() < dayStartOf(endDate);
          return (
            <Pressable
              key={day}
              accessibilityLabel={`${MONTHS[view.m]} ${day}`}
              style={[
                styles.calCell,
                inRange && styles.calCellInRange,
                isEdge && styles.calCellSelected,
                sameDay(cell, today) && styles.calCellToday,
              ]}
              onPress={() => pick(day)}
            >
              <Text style={[styles.calCellText, isEdge && styles.calCellTextSelected]}>{day}</Text>
            </Pressable>
          );
        })}
      </View>
      <RangeTimeRow label="开始时间" value={props.start} hasTime={startHasTime} onChange={setStart} />
      <RangeTimeRow label="结束时间" value={props.end} hasTime={endHasTime} endOfDay onChange={setEnd} />
      <Text style={styles.calSummary}>
        {fmtDateTime(props.start, startHasTime)} – {fmtDateTime(props.end, endHasTime)}
      </Text>
    </View>
  );
}

// local midnight of the day a Date falls in (the range highlight compares
// whole days)
function dayStartOf(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
