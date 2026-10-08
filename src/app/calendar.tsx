import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";

import { DayItemsList, TONE_COLOR } from "@/calendar/dayItemsList";
import { ScheduleSheet } from "@/calendar/scheduleSheet";
import { CreateSheet } from "@/calendar/createSheet";
import { CalItem, calendarMonth, CalKind, CalState, CalTone, groupDayItems, itemState } from "@/domain/calendar";
import { addFreeNode, Recipe } from "@/domain/commands";
import { LifeMapDoc, NodeKind } from "@/domain/doc";
import { fmtDuration, focusedMsOnDay } from "@/domain/focus";
import { contentCenter } from "@/map/fitZoom";
import { CreateNodeForm, TextDraft } from "@/map/overlays/forms";
import { fmtDate } from "@/map/utils";
import { useDocStore } from "@/state/docStore";
import { CANVAS_BG, CARD_BG, INK, ON_INK, RADIUS, SHADOW, TYPE } from "@/ui/theme";

// The calendar page: the document's dated side as a month calendar. Days
// carry tone dots (what the month holds); the selected day's items list
// below, grouped one row per node and narrowable with two filter rows
// (state × kind). Tapping an item hands the node back to the map through
// the store (pendingNodeFocusId) and returns — the map reveals and centers
// it. Long-pressing a row — or dragging its grip handle — moves it to a new
// position: the day's order persists (src/calendar/dayItemsList.tsx);
// reordering rests while a filter is on, so a filtered drag can't shred
// the day's stored order. A chevron in the month card's header collapses
// the grid to the selected day's week strip. Weeks start on Sunday, like
// the date picker and the recurrence rules.
//
// The day card also creates: "+ New" adds a goal (target = the day), a
// task (due = the day) or a record (occurred = the day) as a free node —
// the map places it near the content center, spread by a golden-angle
// step so repeated adds don't stack

// a calendar-created node's spot on the map: near the content center, on a
// golden-angle ring indexed by the node count so repeated adds fan out
// instead of stacking
function freeSpot(doc: LifeMapDoc): { x: number; y: number } {
  const nodes = Object.values(doc.nodes);
  const c = contentCenter(nodes) ?? { x: 0, y: 0 };
  const angle = nodes.length * 2.4;
  return { x: c.x + 180 * Math.cos(angle), y: c.y + 180 * Math.sin(angle) };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

const LEGEND: { tone: CalTone; label: string }[] = [
  { tone: "attention", label: "Due/Missed" },
  { tone: "primary", label: "Target" },
  { tone: "done", label: "Done" },
  { tone: "neutral", label: "Record" },
  { tone: "future", label: "Scheduled" },
];

// the day list's two filter rows, each single-select; the rows combine as
// intersection ("To do + Tasks" = what's left to do today). Both ride on
// the item fields from calendarMonth: state on the tone partition, kind
// on the node's kind
const STATE_CHIPS: { id: "all" | CalState; label: string }[] = [
  { id: "all", label: "All" },
  { id: "todo", label: "To do" },
  { id: "done", label: "Done" },
  { id: "log", label: "Log" },
];
const KIND_CHIPS: { id: "all" | CalKind; label: string }[] = [
  { id: "all", label: "All kinds" },
  { id: "task", label: "Tasks" },
  { id: "habit", label: "Habits" },
  { id: "goal", label: "Goals" },
  { id: "record", label: "Records" },
];

export default function CalendarScreen() {
  const router = useRouter();
  const doc = useDocStore((s) => s.doc);
  const loaded = useDocStore((s) => s.loaded);
  const { width, height } = useWindowDimensions();

  // the map normally triggers the doc load, but a cold start deep-linked
  // straight here never mounts it — every screen makes sure the doc loads
  // (the store loads once per session; later calls ride the same promise)
  useEffect(() => {
    if (!loaded) useDocStore.getState().load({ width, height });
  }, [loaded, width, height]);

  // the screen's clock: Date.now() is impure in render, so it is captured
  // after mount (deferred — a synchronous setState in an effect body is a
  // lint error); the viewed month and the selected day follow it home
  const [now, setNow] = useState(0);
  const [view, setView] = useState<{ y: number; m: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  // the month card's shape: full grid + legend, or the selected day's week
  // strip. Session state only — resets on restart
  const [monthExpanded, setMonthExpanded] = useState(true);
  // the day list's filters: single-select per row, kept while swiping days
  const [stateFilter, setStateFilter] = useState<"all" | CalState>("all");
  const [kindFilter, setKindFilter] = useState<"all" | CalKind>("all");
  // the scheduling sheet for the selected day (goals' target dates and
  // plain tasks' due dates are pinned from here)
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // creating on the selected day: the kind chooser, then the shared create
  // form seeded with the day (record's occurred-at, goal's target; a task's
  // due date is pinned at save)
  const [createChooserOpen, setCreateChooserOpen] = useState(false);
  const [create, setCreate] = useState<{ mode: NodeKind; draft: TextDraft } | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const ms = Date.now();
      const d = new Date(ms);
      setNow(ms);
      setView({ y: d.getFullYear(), m: d.getMonth() });
      setSelectedDay(d.getDate());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const monthItems = useMemo(
    () => (view && now > 0 ? calendarMonth(doc, view.y, view.m, now) : new Map<number, CalItem[]>()),
    [doc, view, now],
  );

  // the collapsed card: the selected day's week (Sunday-first), each cell
  // with its dots. A week spans at most one adjacent month, derived on
  // demand for the dots of its days
  const weekStrip = useMemo(() => {
    if (monthExpanded || !view || selectedDay === null || now === 0) return null;
    const start = new Date(view.y, view.m, selectedDay);
    start.setDate(start.getDate() - start.getDay());
    let adjacent: Map<number, CalItem[]> | null = null;
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      let items: CalItem[];
      if (date.getFullYear() === view.y && date.getMonth() === view.m) {
        items = monthItems.get(date.getDate()) ?? [];
      } else {
        adjacent ??= calendarMonth(doc, date.getFullYear(), date.getMonth(), now);
        items = adjacent.get(date.getDate()) ?? [];
      }
      return { date, items };
    });
  }, [monthExpanded, view, selectedDay, now, doc, monthItems]);

  if (!loaded || !view || selectedDay === null) {
    return <View style={cs.container} />;
  }

  const today = new Date(now);
  const isToday = (day: number) =>
    today.getFullYear() === view.y && today.getMonth() === view.m && today.getDate() === day;

  const shiftMonth = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
    setSelectedDay(1);
  };
  const goToday = () => {
    setView({ y: today.getFullYear(), m: today.getMonth() });
    setSelectedDay(today.getDate());
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const focusOnMap = (nodeId: string) => {
    useDocStore.getState().requestNodeFocus(nodeId);
    back();
  };

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leadingBlanks = new Date(view.y, view.m, 1).getDay();
  const cells: (number | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const dayItems = monthItems.get(selectedDay) ?? [];
  const selectedDayMs = new Date(view.y, view.m, selectedDay).getTime();
  // the day header's focused-time total: the day's focus segment records
  const dayFocusMs = focusedMsOnDay(doc, selectedDayMs);
  // one row per node, then the two chips as an intersection; the grid dots
  // above keep reading the ungrouped, unfiltered month items
  const filtering = stateFilter !== "all" || kindFilter !== "all";
  const listItems = groupDayItems(dayItems).filter(
    (it) =>
      (stateFilter === "all" || itemState(it) === stateFilter) &&
      (kindFilter === "all" || it.kind === kindFilter),
  );
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const pickStripDay = (date: Date) => {
    if (date.getFullYear() !== view.y || date.getMonth() !== view.m) {
      setView({ y: date.getFullYear(), m: date.getMonth() }); // adjacent month shifts the view
    }
    setSelectedDay(date.getDate());
  };
  // scheduling goes through the store directly: the map's post-run pruning
  // is canvas state, nothing the calendar holds
  const run = (recipe: Recipe) => useDocStore.getState().run(recipe);

  // kind picked in the chooser: open the create form with the day seeded —
  // a record logs the day, a goal targets it; a task's due date is pinned
  // at save (the form has no task date row)
  const pickCreateKind = (mode: NodeKind) => {
    setCreateChooserOpen(false);
    const draft: TextDraft = { title: "", detail: "" };
    if (mode === "record") draft.occurredAt = selectedDayMs;
    if (mode === "goal") draft.targetDate = selectedDayMs;
    setCreate({ mode, draft });
  };

  // one undoable command: the free node, with the day carried on it
  const saveCreate = () => {
    if (!create) return;
    const title = create.draft.title.trim();
    if (!title) return;
    const add = addFreeNode(
      create.mode,
      title,
      create.draft.detail.trim(),
      freeSpot(doc),
      create.draft.occurredAt,
      create.draft.targetDate,
      create.mode === "task" ? selectedDayMs : undefined,
    );
    run(add.recipe);
    setCreate(null);
  };

  return (
    <View style={cs.container}>
      <View style={cs.header}>
        <Pressable accessibilityLabel="Back to map" onPress={back} hitSlop={12}>
          <Text style={cs.headerAction}>‹ Map</Text>
        </Pressable>
        <Text style={cs.headerTitle}>Calendar</Text>
        <Pressable accessibilityLabel="Go to today" onPress={goToday} hitSlop={12}>
          <Text style={cs.headerAction}>Today</Text>
        </Pressable>
      </View>

      <View style={cs.card}>
        <View style={cs.calHeader}>
          <Pressable accessibilityLabel="Previous month" onPress={() => shiftMonth(-1)} hitSlop={12}>
            <Text style={cs.calNav}>‹</Text>
          </Pressable>
          <Text style={cs.calTitle}>
            {MONTHS[view.m]} {view.y}
          </Text>
          <View style={cs.calNavRight}>
            <Pressable accessibilityLabel="Next month" onPress={() => shiftMonth(1)} hitSlop={12}>
              <Text style={cs.calNav}>›</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={monthExpanded ? "Collapse month view" : "Expand month view"}
              onPress={() => setMonthExpanded((e) => !e)}
              hitSlop={12}
            >
              <Text style={cs.chev}>{monthExpanded ? "▾" : "▸"}</Text>
            </Pressable>
          </View>
        </View>
        {monthExpanded ? (
          <>
            <View style={cs.dowRow}>
              {DOW.map((d, i) => (
                <Text key={i} style={cs.dow}>
                  {d}
                </Text>
              ))}
            </View>
            <View style={cs.grid}>
              {cells.map((day, i) =>
                day === null ? (
                  <View key={`b${i}`} style={cs.cell} />
                ) : (
                  (() => {
                    const items = monthItems.get(day) ?? [];
                    const tones = [...new Set(items.map((it) => it.tone))];
                    const selected = day === selectedDay;
                    return (
                      <Pressable
                        key={day}
                        accessibilityLabel={`${MONTHS[view.m]} ${day}`}
                        style={[cs.cell, selected && cs.cellSelected, !selected && isToday(day) && cs.cellToday]}
                        onPress={() => setSelectedDay(day)}
                      >
                        <Text style={[cs.cellText, selected && cs.cellTextSelected]}>{day}</Text>
                        <View style={cs.dotRow}>
                          {tones.slice(0, 3).map((tone) => (
                            <View key={tone} style={[cs.dot, { backgroundColor: TONE_COLOR[tone] }]} />
                          ))}
                        </View>
                      </Pressable>
                    );
                  })()
                ),
              )}
            </View>
            <View style={cs.legend}>
              {LEGEND.map((l) => (
                <View key={l.tone} style={cs.legendItem}>
                  <View style={[cs.dot, { backgroundColor: TONE_COLOR[l.tone] }]} />
                  <Text style={cs.legendText}>{l.label}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          weekStrip && (
            <View style={cs.strip}>
              {weekStrip.map(({ date, items }) => {
                const inView = date.getFullYear() === view.y && date.getMonth() === view.m;
                const selected = inView && date.getDate() === selectedDay;
                const tones = [...new Set(items.map((it) => it.tone))];
                return (
                  <Pressable
                    key={date.getTime()}
                    accessibilityLabel={fmtDate(date.getTime())}
                    style={[cs.stripCell, selected && cs.cellSelected, !selected && sameDay(date, today) && cs.cellToday]}
                    onPress={() => pickStripDay(date)}
                  >
                    <Text style={[cs.stripText, selected && cs.cellTextSelected]}>{date.getDate()}</Text>
                    <View style={cs.dotRow}>
                      {tones.slice(0, 3).map((tone) => (
                        <View key={tone} style={[cs.dot, { backgroundColor: TONE_COLOR[tone] }]} />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )
        )}
      </View>

      <View style={[cs.card, cs.dayCard]}>
        <View style={cs.dayHeader}>
          <Text style={cs.dayTitle}>
            {fmtDate(selectedDayMs)}
            {dayFocusMs > 0 ? ` · ${fmtDuration(dayFocusMs)} focused` : ""}
          </Text>
          <View style={cs.dayActions}>
            <Pressable
              accessibilityLabel="Add a goal, task or record on this day"
              onPress={() => setCreateChooserOpen(true)}
              hitSlop={8}
            >
              <Text style={cs.scheduleAction}>+ New</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Schedule a goal or task on this day"
              onPress={() => setScheduleOpen(true)}
              hitSlop={8}
            >
              <Text style={cs.scheduleAction}>+ Schedule</Text>
            </Pressable>
          </View>
        </View>
        <View style={cs.filters}>
          <View style={cs.chipRow}>
            {STATE_CHIPS.map((c) => (
              <Pressable
                key={c.id}
                accessibilityLabel={`Filter state: ${c.label}`}
                accessibilityState={{ selected: stateFilter === c.id }}
                onPress={() => setStateFilter(c.id)}
                style={[cs.chip, stateFilter === c.id && cs.chipOn]}
              >
                <Text style={[cs.chipText, stateFilter === c.id && cs.chipTextOn]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={cs.chipRow}>
            {KIND_CHIPS.map((c) => (
              <Pressable
                key={c.id}
                accessibilityLabel={`Filter kind: ${c.label}`}
                accessibilityState={{ selected: kindFilter === c.id }}
                onPress={() => setKindFilter(c.id)}
                style={[cs.chip, kindFilter === c.id && cs.chipOn]}
              >
                <Text style={[cs.chipText, kindFilter === c.id && cs.chipTextOn]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <DayItemsList
          items={listItems}
          dayMs={selectedDayMs}
          onPressItem={focusOnMap}
          run={run}
          reorderable={!filtering}
          emptyHint={filtering ? "Nothing matches these filters" : undefined}
        />
      </View>

      {/* schedule picker: pin a goal's target date or a plain task's due
          date to the selected day; toggling an already-pinned row unpins
          it. Each toggle is one undoable command */}
      {scheduleOpen && (
        <ScheduleSheet
          doc={doc}
          dayMs={selectedDayMs}
          run={run}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {/* create on the selected day: the chooser swaps to the shared create
          form (never stacked modals); saving pins the day onto the node */}
      {createChooserOpen && (
        <CreateSheet
          dayMs={selectedDayMs}
          onPick={pickCreateKind}
          onClose={() => setCreateChooserOpen(false)}
        />
      )}
      {create && (
        <CreateNodeForm
          mode={create.mode}
          draft={create.draft}
          onDraftChange={(draft) => setCreate((c) => (c ? { ...c, draft } : c))}
          onSave={saveCreate}
          onClose={() => setCreate(null)}
        />
      )}
    </View>
  );
}

const cs = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CANVAS_BG,
    paddingTop: 56, // aligns with the map's top row
    paddingHorizontal: 16,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    ...TYPE.title,
    color: INK.primary,
  },
  headerAction: {
    fontSize: 15,
    fontWeight: "500",
    color: INK.secondary,
    minWidth: 56,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: INK.subtle,
    padding: 14,
    ...SHADOW.card,
  },
  calHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  calNav: {
    fontSize: 22,
    fontWeight: "600",
    color: INK.primary,
    paddingHorizontal: 12,
  },
  calTitle: {
    ...TYPE.title,
    color: INK.primary,
  },
  dowRow: {
    flexDirection: "row",
  },
  dow: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
    color: INK.tertiary,
    paddingVertical: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 0.85,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.sm,
  },
  cellText: {
    fontSize: 14,
    color: INK.primary,
  },
  cellSelected: {
    backgroundColor: INK.primary,
  },
  cellTextSelected: {
    color: ON_INK,
    fontWeight: "700",
  },
  cellToday: {
    borderWidth: 1,
    borderColor: INK.hairline,
  },
  dotRow: {
    flexDirection: "row",
    gap: 3,
    height: 6,
    marginTop: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: INK.subtle,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendText: {
    fontSize: 11,
    color: INK.tertiary,
  },
  dayCard: {
    flex: 1,
    marginBottom: 16,
  },
  dayTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: INK.secondary,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  dayActions: {
    flexDirection: "row",
    gap: 16,
  },
  scheduleAction: {
    fontSize: 13,
    fontWeight: "600",
    color: INK.primary,
  },
  calNavRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  chev: {
    fontSize: 15,
    fontWeight: "600",
    color: INK.secondary,
    paddingHorizontal: 10,
  },
  // the collapsed month card: the selected day's week, cells tappable like
  // the grid's (selected filled, today ringed)
  strip: {
    flexDirection: "row",
  },
  stripCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
  },
  stripText: {
    fontSize: 14,
    color: INK.primary,
  },
  // the day list's two filter rows
  filters: {
    gap: 6,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: INK.subtle,
  },
  chipOn: {
    backgroundColor: INK.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: INK.secondary,
  },
  chipTextOn: {
    color: ON_INK,
  },
});
