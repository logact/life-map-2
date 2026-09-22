import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Recipe, setNodeTimes } from "@/domain/commands";
import { isGoal, isTask, LifeMapDoc, NodeData } from "@/domain/doc";
import { dayStart } from "@/domain/recur";
import { fmtDate } from "@/map/utils";
import { BACKDROP, INK, STATUS_COLOR } from "@/ui/theme";

// The calendar's scheduling sheet: every schedulable node — goals (their
// target date) and plain tasks (their one-off due date; habits schedule
// themselves by rule, synthetic midpoints are structure) — listed for the
// selected day. A row shows where the node is pinned today; tapping pins
// it to the selected day, or unpins it when it is already there, so one
// sheet both schedules and unschedules. Every toggle is one undoable
// command through the store.

function pinnedDay(node: NodeData): number | undefined {
  if (isGoal(node)) return node.targetDate;
  return node.dueDate;
}

export function ScheduleSheet(props: {
  doc: LifeMapDoc;
  // the selected calendar day (local midnight)
  dayMs: number;
  run: (recipe: Recipe) => void;
  onClose: () => void;
}) {
  const { doc, dayMs } = props;
  const candidates = Object.values(doc.nodes)
    .filter((n) => isGoal(n) || (isTask(n) && !n.recur && !n.synthetic))
    .map((n) => {
      const pinned = pinnedDay(n);
      return { node: n, onThisDay: pinned !== undefined && dayStart(pinned) === dayMs };
    })
    .sort((a, b) =>
      a.onThisDay === b.onThisDay
        ? a.node.title.localeCompare(b.node.title)
        : a.onThisDay
          ? -1
          : 1,
    );

  const toggle = (node: NodeData, onThisDay: boolean) => {
    if (isGoal(node)) {
      props.run(setNodeTimes(node.id, { targetDate: onThisDay ? null : dayMs }));
    } else {
      props.run(setNodeTimes(node.id, { dueDate: onThisDay ? null : dayMs }));
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={cs.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View style={cs.sheet}>
          <View style={cs.handle} />
          <Text style={cs.title}>Schedule on {fmtDate(dayMs)}</Text>
          <ScrollView style={cs.list} contentContainerStyle={{ gap: 2 }}>
            {candidates.length === 0 ? (
              <Text style={cs.empty}>No goals or tasks yet — create them on the map</Text>
            ) : (
              candidates.map(({ node, onThisDay }) => {
                const pinned = pinnedDay(node);
                return (
                  <Pressable
                    key={node.id}
                    style={({ pressed }) => [cs.row, pressed && { opacity: 0.6 }]}
                    onPress={() => toggle(node, onThisDay)}
                  >
                    <Text style={cs.kind}>{isGoal(node) ? "Goal" : "Task"}</Text>
                    <Text style={cs.rowTitle} numberOfLines={1}>
                      {node.title}
                    </Text>
                    {onThisDay ? (
                      <Text style={cs.rowCheck}>✓</Text>
                    ) : (
                      <Text style={cs.rowDate}>{pinned !== undefined ? fmtDate(pinned) : "—"}</Text>
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <Pressable
            style={({ pressed }) => [cs.done, pressed && { opacity: 0.6 }]}
            onPress={props.onClose}
          >
            <Text style={cs.doneText}>Done</Text>
          </Pressable>
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
    gap: 14,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d8dade",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: INK.primary,
  },
  list: {
    maxHeight: 320,
  },
  empty: {
    fontSize: 13,
    color: INK.tertiary,
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: INK.subtle,
  },
  kind: {
    fontSize: 11,
    fontWeight: "600",
    color: INK.tertiary,
    width: 36,
  },
  rowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: INK.primary,
  },
  rowDate: {
    fontSize: 12,
    color: INK.tertiary,
  },
  rowCheck: {
    fontSize: 14,
    fontWeight: "700",
    color: STATUS_COLOR.done,
  },
  done: {
    alignSelf: "center",
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: INK.primary,
  },
  doneText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
});
