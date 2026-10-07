import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { addChildNode, addNote, connectNodes, Recipe, transitionNodeStatus } from "@/domain/commands";
import { isGoal, isRecord, isTask, NodeData } from "@/domain/doc";
import { fmtClock, fmtDuration, focusedMs } from "@/domain/focus";
import { childPosition, fmtDate } from "@/map/utils";
import { useDocStore } from "@/state/docStore";
import { useFocusStore } from "@/state/focusStore";
import { CANVAS_BG, INK, RADIUS, SHADOW, STATUS_COLOR } from "@/ui/theme";

// The focus screen (/focus): "I am working on this task right now." A
// running stopwatch (optionally against a pomodoro target — a visual cue
// only, stopping stays manual), quick-add onto the focused task (record,
// note, done-mark / habit log, link an existing node), and task switching
// that ends the current segment and starts a new one while the session
// clock keeps running. Every ended segment writes one record carrying its
// duration (src/state/focusStore.ts); every quick-add is an existing domain
// command, one undoable step each.
//
// Entry: a goal/task info card's Focus button pushes here with the node's
// id. A goal carries no segment of its own — it is context; the screen
// asks which of its tasks to work on.

const TARGET_OPTIONS = [15, 25, 45, 60];

// which quick-add panel is open below the timer (one at a time)
type Panel = "record" | "note" | "switch" | "link" | null;

export default function FocusScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ taskId?: string; goalId?: string }>();
  const { width, height } = useWindowDimensions();
  const doc = useDocStore((s) => s.doc);
  const docLoaded = useDocStore((s) => s.loaded);
  const session = useFocusStore((s) => s.session);
  const focusLoaded = useFocusStore((s) => s.loaded);

  // the screen's clock, ticking once a second while a session runs (the
  // timer is the only time-based render here)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  // a cold start deep-linked here never mounted the map: make sure both
  // stores are loaded (each loads once per session)
  useEffect(() => {
    if (!docLoaded) useDocStore.getState().load({ width, height });
    if (!focusLoaded) useFocusStore.getState().load();
  }, [docLoaded, focusLoaded, width, height]);

  const [panel, setPanel] = useState<Panel>(null);
  const [quickText, setQuickText] = useState("");

  const run = (recipe: Recipe) => useDocStore.getState().run(recipe);

  // the node the entry params point at (the info card's Focus button)
  const entryTask = params.taskId ? doc.nodes[params.taskId] : undefined;
  const entryGoal = params.goalId ? doc.nodes[params.goalId] : undefined;

  const task = session ? doc.nodes[session.taskId] : undefined;
  const goal = session?.goalId ? doc.nodes[session.goalId] : undefined;

  // pickable tasks: the goal's direct child tasks in goal context, else
  // every real task on the map (synthetic midpoints are structure)
  const pickableTasks = useMemo(() => {
    const goalId = session?.goalId ?? (entryGoal && isGoal(entryGoal) ? entryGoal.id : null);
    if (goalId) {
      return Object.values(doc.edges)
        .filter((e) => e.fromId === goalId)
        .map((e) => doc.nodes[e.toId])
        .filter((n): n is NodeData => !!n && isTask(n) && !n.synthetic);
    }
    return Object.values(doc.nodes)
      .filter((n) => isTask(n) && !n.synthetic)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [doc, session?.goalId, entryGoal]);

  // link candidates: every goal and real task except the focused one
  const linkCandidates = useMemo(
    () =>
      Object.values(doc.nodes)
        .filter((n) => (isGoal(n) || (isTask(n) && !n.synthetic)) && n.id !== session?.taskId)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [doc, session?.taskId],
  );

  // the trail of the focused task (plus the context goal): its records and
  // notes merged newest-first, so the session shows what has already been
  // logged while the quick-add grows it
  const trail = useMemo(() => {
    if (!task) return [];
    type TrailItem = {
      id: string;
      kind: "record" | "note";
      text: string;
      at: number;
      durationMs?: number;
      // which node the entry belongs to — only shown in goal context,
      // where the two sources share the list
      source: "task" | "goal" | null;
    };
    const items: TrailItem[] = [];
    const sources: { node: NodeData; source: TrailItem["source"] }[] = [
      { node: task, source: goal ? "task" : null },
    ];
    if (goal) sources.push({ node: goal, source: "goal" });
    for (const { node, source } of sources) {
      for (const note of node.notes) {
        items.push({ id: note.id, kind: "note", text: note.text, at: note.createdAt, source });
      }
      for (const edge of Object.values(doc.edges)) {
        if (edge.fromId !== node.id) continue;
        const child = doc.nodes[edge.toId];
        if (child && isRecord(child)) {
          items.push({
            id: child.id,
            kind: "record",
            text: child.title,
            at: child.occurredAt ?? child.createdAt ?? 0,
            durationMs: child.durationMs,
            source,
          });
        }
      }
    }
    return items.sort((a, b) => b.at - a.at);
  }, [doc, task, goal]);

  if (!docLoaded || !focusLoaded) return <View style={fs.container} />;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  // quick-add saves: each is one undoable command on the focused task
  const saveQuickAdd = () => {
    if (!task) return;
    const text = quickText.trim();
    if (!text) return;
    if (panel === "record") {
      const outDegree = Object.values(doc.edges).filter((e) => e.fromId === task.id).length;
      run(addChildNode(task.id, "record", text, "", childPosition(task, outDegree, "successor"), Date.now()).recipe);
    } else if (panel === "note") {
      run(addNote(task.id, text).recipe);
    }
    setQuickText("");
    setPanel(null);
  };

  const stop = () => {
    useFocusStore.getState().stop();
    back();
  };

  // ---------- no active session: pick what to work on ----------
  if (!session || !task) {
    // direct entry on a task: one tap starts the session
    if (!session && entryTask && isTask(entryTask)) {
      return (
        <View style={fs.container}>
          <Header title="Focus" onBack={back} />
          <View style={fs.card}>
            <Text style={fs.contextLabel}>Ready to work on</Text>
            <Text style={fs.taskTitle}>{entryTask.title}</Text>
            <Pressable
              accessibilityLabel="Start focus session"
              style={({ pressed }) => [fs.primaryButton, pressed && { opacity: 0.7 }]}
              onPress={() => useFocusStore.getState().start(entryTask.id)}
            >
              <Text style={fs.primaryButtonText}>Start</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    // goal context (or a bare entry): choose the task to work on
    return (
      <View style={fs.container}>
        <Header title="Focus" onBack={back} />
        <View style={[fs.card, fs.listCard]}>
          <Text style={fs.contextLabel}>
            {entryGoal && isGoal(entryGoal) ? entryGoal.title : "Focus"}
          </Text>
          <Text style={fs.taskTitle}>Which task are you working on?</Text>
          <ScrollView>
            {pickableTasks.map((t) => (
              <Pressable
                key={t.id}
                style={({ pressed }) => [fs.pickRow, pressed && { opacity: 0.6 }]}
                onPress={() =>
                  useFocusStore.getState().start(t.id, entryGoal && isGoal(entryGoal) ? entryGoal.id : null)
                }
              >
                <Text style={fs.pickRowText}>{t.title}</Text>
              </Pressable>
            ))}
            {pickableTasks.length === 0 && (
              <Text style={fs.meta}>No tasks here yet — add one on the map first.</Text>
            )}
          </ScrollView>
        </View>
      </View>
    );
  }

  // ---------- active session ----------
  const elapsed = now - session.segmentStartedAt;
  const sessionMs = now - session.sessionStartedAt;
  const targetMs = session.targetMin !== null ? session.targetMin * 60000 : null;
  const targetReached = targetMs !== null && elapsed >= targetMs;
  // the focused task's own done affordance: a habit logs an occurrence, a
  // plain task completes (once)
  const canComplete = isTask(task) && (task.recur || task.status !== "done");

  return (
    <View style={fs.container}>
      <Header title="Focus" onBack={back} />
      <KeyboardAvoidingView
        style={fs.body}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={fs.bodyContent} keyboardShouldPersistTaps="handled">
        <View style={fs.card}>
          {goal && <Text style={fs.contextLabel}>{goal.title}</Text>}
          <Text style={fs.taskTitle}>{task.title}</Text>
          <Text style={[fs.timer, targetReached && { color: STATUS_COLOR.done }]}>
            {fmtClock(elapsed)}
            {targetMs !== null ? ` / ${fmtClock(targetMs)}` : ""}
          </Text>
          <Text style={fs.meta}>
            {targetReached ? "Target reached ✓ · " : ""}Session {fmtDuration(sessionMs)}
            {focusedMs(doc, task.id) > 0 ? ` · focused before: ${fmtDuration(focusedMs(doc, task.id))}` : ""}
          </Text>
          {/* pomodoro target: a visual cue only — the stop stays manual */}
          <View style={fs.chipRow}>
            <Pressable
              accessibilityLabel="Free-running stopwatch"
              accessibilityState={{ selected: session.targetMin === null }}
              style={[fs.chip, session.targetMin === null && fs.chipOn]}
              onPress={() => useFocusStore.getState().setTargetMin(null)}
            >
              <Text style={[fs.chipText, session.targetMin === null && fs.chipTextOn]}>∞</Text>
            </Pressable>
            {TARGET_OPTIONS.map((min) => (
              <Pressable
                key={min}
                accessibilityLabel={`Target ${min} minutes`}
                accessibilityState={{ selected: session.targetMin === min }}
                style={[fs.chip, session.targetMin === min && fs.chipOn]}
                onPress={() => useFocusStore.getState().setTargetMin(min)}
              >
                <Text style={[fs.chipText, session.targetMin === min && fs.chipTextOn]}>{min}m</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* quick-add: existing domain commands, one undoable step each */}
        <View style={fs.card}>
          <View style={fs.quickRow}>
            <QuickButton label="+ Record" onPress={() => { setPanel(panel === "record" ? null : "record"); setQuickText(""); }} />
            <QuickButton label="+ Note" onPress={() => { setPanel(panel === "note" ? null : "note"); setQuickText(""); }} />
            {canComplete && (
              <QuickButton
                label={task.recur ? "Log done" : "Mark done"}
                onPress={() => run(transitionNodeStatus(task.id, "complete"))}
              />
            )}
            <QuickButton label="Link" onPress={() => setPanel(panel === "link" ? null : "link")} />
            <QuickButton label="Switch" onPress={() => setPanel(panel === "switch" ? null : "switch")} />
          </View>

          {(panel === "record" || panel === "note") && (
            <View style={fs.panelBody}>
              <TextInput
                style={fs.input}
                placeholder={panel === "record" ? "What happened?" : "Write a note…"}
                value={quickText}
                onChangeText={setQuickText}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveQuickAdd}
              />
              <Pressable
                accessibilityLabel="Save"
                style={({ pressed }) => [
                  fs.primaryButton,
                  !quickText.trim() && fs.primaryButtonDisabled,
                  pressed && { opacity: 0.7 },
                ]}
                disabled={!quickText.trim()}
                onPress={saveQuickAdd}
              >
                <Text style={fs.primaryButtonText}>Save</Text>
              </Pressable>
            </View>
          )}

          {(panel === "switch" || panel === "link") && (
            <ScrollView style={fs.panelList}>
              {(panel === "switch" ? pickableTasks.filter((t) => t.id !== task.id) : linkCandidates).map(
                (n) => (
                  <Pressable
                    key={n.id}
                    style={({ pressed }) => [fs.pickRow, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                      if (panel === "switch") useFocusStore.getState().switchTask(n.id);
                      else run(connectNodes(task.id, n.id).recipe);
                      setPanel(null);
                    }}
                  >
                    <Text style={fs.pickRowText} numberOfLines={1}>
                      {n.title}
                    </Text>
                    <Text style={fs.meta}>{panel === "switch" ? "" : n.kind}</Text>
                  </Pressable>
                ),
              )}
              {(panel === "switch" ? pickableTasks.length <= 1 : linkCandidates.length === 0) && (
                <Text style={fs.meta}>
                  {panel === "switch" ? "No other tasks to switch to." : "Nothing to link."}
                </Text>
              )}
            </ScrollView>
          )}
        </View>

        {/* the trail: records and notes already on the focused task (and
            the context goal), newest first — quick-adds land here */}
        {trail.length > 0 && (
          <View style={fs.card}>
            <Text style={fs.contextLabel}>Records & notes</Text>
            {trail.map((item) => (
              <View key={`${item.kind}:${item.id}`} style={fs.trailRow}>
                <Text style={item.kind === "note" ? fs.trailNoteText : fs.trailRecordText} numberOfLines={2}>
                  {item.text}
                </Text>
                <Text style={fs.meta}>
                  {item.kind === "note" ? "Note" : "Record"} · {fmtDate(item.at)}
                  {item.durationMs !== undefined ? ` · ${fmtDuration(item.durationMs)}` : ""}
                  {item.source === "goal" ? " · goal" : ""}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          accessibilityLabel="Stop focus session"
          style={({ pressed }) => [fs.stopButton, pressed && { opacity: 0.7 }]}
          onPress={stop}
        >
          <Text style={fs.stopButtonText}>Stop · {fmtDuration(elapsed)}</Text>
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={fs.header}>
      <Pressable accessibilityLabel="Back" onPress={onBack} hitSlop={12}>
        <Text style={fs.headerAction}>‹ Back</Text>
      </Pressable>
      <Text style={fs.headerTitle}>{title}</Text>
      <View style={{ minWidth: 56 }} />
    </View>
  );
}

function QuickButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [fs.quickButton, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Text style={fs.quickButtonText}>{label}</Text>
    </Pressable>
  );
}

const fs = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CANVAS_BG,
    paddingTop: 56, // aligns with the map's top row
    paddingHorizontal: 16,
    gap: 12,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
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
    gap: 8,
    ...SHADOW.card,
  },
  listCard: {
    flex: 1,
    marginBottom: 16,
  },
  contextLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: INK.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  taskTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: INK.primary,
  },
  timer: {
    fontSize: 44,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    color: INK.primary,
  },
  meta: {
    fontSize: 12,
    fontWeight: "500",
    color: INK.tertiary,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    color: "#ffffff",
  },
  quickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: INK.hairline,
  },
  quickButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: INK.primary,
  },
  panelBody: {
    gap: 8,
    marginTop: 4,
  },
  panelList: {
    maxHeight: 220,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: INK.hairline,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: INK.primary,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: INK.subtle,
  },
  pickRowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: INK.primary,
  },
  // the trail list: a record reads as a plain row, a note in the
  // secondary ink (records are evidence, notes are commentary)
  trailRow: {
    gap: 2,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: INK.subtle,
  },
  trailRecordText: {
    fontSize: 14,
    fontWeight: "500",
    color: INK.primary,
  },
  trailNoteText: {
    fontSize: 14,
    fontWeight: "400",
    color: INK.secondary,
  },
  primaryButton: {
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: RADIUS.sm,
    backgroundColor: INK.primary,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  stopButton: {
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    backgroundColor: INK.primary,
    marginBottom: 16,
    ...SHADOW.floating,
  },
  stopButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
});
