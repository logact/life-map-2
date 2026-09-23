import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";

import { ScheduleSheet } from "@/calendar/scheduleSheet";
import { CreateSheet } from "@/calendar/createSheet";
import { CalItem, calendarMonth, CalTone } from "@/domain/calendar";
import { addFreeNode, Recipe } from "@/domain/commands";
import { LifeMapDoc, NodeKind } from "@/domain/doc";
import { contentCenter } from "@/map/fitZoom";
import { CreateNodeForm, TextDraft } from "@/map/overlays/forms";
import { fmtDate } from "@/map/utils";
import { useDocStore } from "@/state/docStore";
import { CANVAS_BG, INK, RADIUS, SHADOW, STATUS_COLOR } from "@/ui/theme";

// The calendar page: the document's dated side as a month calendar. Days
// carry tone dots (what the month holds); the selected day's items list
// below. Tapping an item hands the node back to the map through the store
// (pendingNodeFocusId) and returns — the map reveals and centers it.
// Weeks start on Sunday, like the date picker and the recurrence rules.
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

const TONE_COLOR: Record<CalTone, string> = {
  attention: STATUS_COLOR["in-progress"],
  primary: INK.primary,
  done: STATUS_COLOR.done,
  neutral: INK.tertiary,
  future: INK.hairline,
};

const LEGEND: { tone: CalTone; label: string }[] = [
  { tone: "attention", label: "Due/Missed" },
  { tone: "primary", label: "Target" },
  { tone: "done", label: "Done" },
  { tone: "neutral", label: "Record" },
  { tone: "future", label: "Scheduled" },
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
          <Pressable accessibilityLabel="Next month" onPress={() => shiftMonth(1)} hitSlop={12}>
            <Text style={cs.calNav}>›</Text>
          </Pressable>
        </View>
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
      </View>

      <View style={[cs.card, cs.dayCard]}>
        <View style={cs.dayHeader}>
          <Text style={cs.dayTitle}>{fmtDate(selectedDayMs)}</Text>
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
        <ScrollView contentContainerStyle={{ gap: 2 }}>
          {dayItems.length === 0 ? (
            <Text style={cs.empty}>Nothing on this day</Text>
          ) : (
            dayItems.map((it, i) => (
              <Pressable
                key={`${it.nodeId}-${it.label}-${i}`}
                style={({ pressed }) => [cs.item, pressed && { opacity: 0.6 }]}
                onPress={() => focusOnMap(it.nodeId)}
              >
                <View style={[cs.dot, { backgroundColor: TONE_COLOR[it.tone] }]} />
                <Text style={cs.itemTitle} numberOfLines={1}>
                  {it.title}
                </Text>
                <Text style={cs.itemLabel}>{it.label}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
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
    fontSize: 17,
    fontWeight: "600",
    color: INK.primary,
  },
  headerAction: {
    fontSize: 15,
    fontWeight: "500",
    color: INK.secondary,
    minWidth: 56,
  },
  card: {
    backgroundColor: "#ffffff",
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
    fontSize: 15,
    fontWeight: "600",
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
    color: "#ffffff",
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
  empty: {
    fontSize: 13,
    color: INK.tertiary,
    paddingVertical: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: INK.subtle,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: INK.primary,
  },
  itemLabel: {
    fontSize: 12,
    color: INK.tertiary,
  },
});
