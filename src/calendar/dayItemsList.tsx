/* eslint-disable react-hooks/immutability -- the drag runs on Reanimated
   shared values written imperatively from gesture handlers (never during
   render); that is their designed API, same as src/map/hooks/useMapCamera */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { CalItem, CalTone } from "@/domain/calendar";
import { Recipe, reorderDayItems } from "@/domain/commands";
import { Id } from "@/domain/doc";
import { fmtDuration } from "@/domain/focus";
import { INK, STATUS_COLOR } from "@/ui/theme";

// The selected day's rows, reorderable: drag a row's grip handle (instant)
// or long-press the row itself, move it to a new slot, release to commit.
// Rows are uniform single-line height (ROW_H) in normal flow — full width by
// default — and a row's visual slot is an animated translateY of
// (slot - renderIndex) * ROW_H, so the slot math is a plain division with no
// measuring and no layout callbacks.
//
// The visual order lives in a shared-value slot map (item key -> slot) so the
// drag itself runs on the UI thread; React only learns the outcome at drop
// time, committed as one undoable reorderDayItems command. Between drags the
// map re-syncs from the doc-derived items prop — the doc is the source of
// truth and calendarMonth already applies the stored order, so a committed
// order re-derives to exactly what the drag showed.

const ROW_H = 38;

// shared by the screen (month grid dots, legend) and the rows below
export const TONE_COLOR: Record<CalTone, string> = {
  attention: STATUS_COLOR["in-progress"],
  primary: INK.primary,
  done: STATUS_COLOR.done,
  neutral: INK.tertiary,
  future: INK.hairline,
};

type Slots = Record<string, number>;

interface RowProps {
  item: CalItem;
  // the row's position in the rendered list; the slot map displaces from here
  index: number;
  // false while the day list is filtered: a partial drag would commit a
  // partial order, so the grip/long-press affordance rests
  reorderable: boolean;
  slots: SharedValue<Slots>;
  draggingKey: SharedValue<string | null>;
  dragStartSlot: SharedValue<number>;
  dragOffset: SharedValue<number>;
  count: SharedValue<number>;
  lockScroll: (locked: boolean) => void;
  commitKeys: (keys: string[]) => void;
  onPressItem: (nodeId: Id) => void;
}

const DayRow = memo(function DayRow({
  item,
  index,
  reorderable,
  slots,
  draggingKey,
  dragStartSlot,
  dragOffset,
  count,
  lockScroll,
  commitKeys,
  onPressItem,
}: RowProps) {
  // one drag engine, two triggers: the grip handle activates on the first
  // movement (no waiting), the row itself activates after a short hold.
  // Gestures read current data through shared values, so this memoized pair
  // never needs recreating (recreating mid-drag would cancel it)
  const { rowPan, handlePan } = useMemo(() => {
    const start = () => {
      "worklet";
      if (draggingKey.value !== null) return; // the twin trigger already owns it
      draggingKey.value = item.key;
      dragStartSlot.value = slots.value[item.key] ?? 0;
      dragOffset.value = 0;
      runOnJS(lockScroll)(true);
    };
    const update = (e: { translationY: number }) => {
      "worklet";
      if (draggingKey.value !== item.key) return;
      dragOffset.value = e.translationY;
      const n = count.value;
      if (n < 2) return;
      const s = slots.value;
      const cur = s[item.key] ?? 0;
      const next = Math.max(
        0,
        Math.min(n - 1, dragStartSlot.value + Math.round(e.translationY / ROW_H)),
      );
      if (next === cur) return;
      // the dragged row takes `next`; every row it crosses shifts one slot
      // toward the vacated spot
      const step = next > cur ? 1 : -1;
      const updated: Slots = {};
      for (const k of Object.keys(s)) {
        if (k === item.key) continue;
        const p = s[k];
        updated[k] = step === 1 ? (p > cur && p <= next ? p - 1 : p) : p < cur && p >= next ? p + 1 : p;
      }
      updated[item.key] = next;
      slots.value = updated;
    };
    const finalize = () => {
      "worklet";
      if (draggingKey.value !== item.key) return; // never activated (tap/scroll)
      const s = slots.value;
      const ordered = Object.keys(s).sort((a, b) => s[a] - s[b]);
      draggingKey.value = null;
      dragOffset.value = 0;
      runOnJS(lockScroll)(false);
      runOnJS(commitKeys)(ordered);
    };
    return {
      handlePan: Gesture.Pan()
        .enabled(reorderable)
        .minDistance(2)
        .onStart(start)
        .onUpdate(update)
        .onFinalize(finalize),
      rowPan: Gesture.Pan()
        .enabled(reorderable)
        .activateAfterLongPress(200)
        .onStart(start)
        .onUpdate(update)
        .onFinalize(finalize),
    };
  }, [item.key, reorderable, slots, draggingKey, dragStartSlot, dragOffset, count, lockScroll, commitKeys]);

  const animatedStyle = useAnimatedStyle(() => {
    const slot = slots.value[item.key] ?? index;
    const isDrag = draggingKey.value === item.key;
    const y = (slot - index) * ROW_H + (isDrag ? dragOffset.value : 0);
    return {
      zIndex: isDrag ? 1 : 0,
      opacity: isDrag ? 0.94 : 1,
      transform: [
        { translateY: isDrag ? y : withTiming(y, { duration: 120 }) },
        { scale: withTiming(isDrag ? 1.02 : 1, { duration: 120 }) },
      ],
    };
  });

  return (
    <GestureDetector gesture={rowPan}>
      <Animated.View style={[ls.row, animatedStyle]}>
        <Pressable
          accessibilityHint="Drag the grip to reorder"
          style={({ pressed }) => [ls.rowInner, pressed && { opacity: 0.6 }]}
          onPress={() => onPressItem(item.nodeId)}
        >
          <View style={[ls.dot, { backgroundColor: TONE_COLOR[item.tone] }]} />
          <Text style={ls.itemTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={ls.itemLabel}>
            {item.durationMs !== undefined ? `${item.label} · ${fmtDuration(item.durationMs)}` : item.label}
          </Text>
          {reorderable && (
            <GestureDetector gesture={handlePan}>
              <View accessibilityLabel="Drag to reorder" style={ls.grip}>
                <View style={ls.gripBar} />
                <View style={ls.gripBar} />
                <View style={ls.gripBar} />
              </View>
            </GestureDetector>
          )}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
});

export function DayItemsList({
  items,
  dayMs,
  onPressItem,
  run,
  reorderable = true,
  emptyHint,
}: {
  items: CalItem[];
  dayMs: number;
  onPressItem: (nodeId: Id) => void;
  run: (recipe: Recipe) => void;
  // false while the list is filtered: a drag commits only the rendered rows,
  // which would shred the day's full stored order
  reorderable?: boolean;
  // empty-state caption; defaults to the plain "Nothing on this day"
  emptyHint?: string;
}) {
  const slots = useSharedValue<Slots>(Object.fromEntries(items.map((it, i) => [it.key, i])));
  const draggingKey = useSharedValue<string | null>(null);
  const dragStartSlot = useSharedValue(0);
  const dragOffset = useSharedValue(0);
  const count = useSharedValue(items.length);
  const [scrollLocked, setScrollLocked] = useState(false);

  // the doc is the source of truth between drags: re-sync the slot map
  // whenever the derived items change and no drag owns the map
  useEffect(() => {
    if (draggingKey.value !== null) return;
    const next: Slots = {};
    items.forEach((it, i) => {
      next[it.key] = i;
    });
    slots.value = next;
    count.value = items.length;
  }, [items, slots, count, draggingKey]);

  // commit/dayMs change every render; the stable callback goes through a ref
  // (assigned post-render) so the memoized gestures never capture a stale day
  const commitRef = useRef<(keys: string[]) => void>(() => {});
  useEffect(() => {
    commitRef.current = (keys) => run(reorderDayItems(dayMs, keys));
  });
  const commitKeys = useCallback((keys: string[]) => commitRef.current(keys), []);
  const lockScroll = useCallback((locked: boolean) => setScrollLocked(locked), []);

  if (items.length === 0) {
    return <Text style={ls.empty}>{emptyHint ?? "Nothing on this day"}</Text>;
  }

  return (
    <ScrollView scrollEnabled={!scrollLocked}>
      <View>
        {items.map((it, index) => (
          <DayRow
            key={it.key}
            item={it}
            index={index}
            reorderable={reorderable}
            slots={slots}
            draggingKey={draggingKey}
            dragStartSlot={dragStartSlot}
            dragOffset={dragOffset}
            count={count}
            lockScroll={lockScroll}
            commitKeys={commitKeys}
            onPressItem={onPressItem}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const ls = StyleSheet.create({
  empty: {
    fontSize: 13,
    color: INK.tertiary,
    paddingVertical: 8,
  },
  row: {
    height: ROW_H,
    backgroundColor: "#ffffff",
  },
  rowInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: INK.subtle,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
  // the reorder affordance: three grip bars at the row's right edge; the
  // padding widens the touch target inside the fixed row height
  grip: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 3,
    justifyContent: "center",
  },
  gripBar: {
    width: 12,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: INK.tertiary,
  },
});
