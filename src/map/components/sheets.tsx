import { Pressable, Text, View } from "react-native";

import { LONG_PRESS_MS } from "../constants";
import { styles } from "../styles";

// small outlined pill used for the inspector's status actions
export function SheetButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.inspectorButton} onPress={props.onPress}>
      <Text style={styles.inspectorButtonText}>{props.label}</Text>
    </Pressable>
  );
}

// peek card content for a single tap: title plus a few fact lines,
// rendered inside the bottom panel. Read-only by default
// (pointerEvents="none", canvas touches pass through and dismiss it);
// with actions/onClose it becomes interactive — the edge card's zoom
// controls and close button
export function InfoCard(props: {
  title: string;
  lines: string[];
  actions?: { label: string; onPress: () => void }[];
  onClose?: () => void;
}) {
  const interactive = props.actions !== undefined || props.onClose !== undefined;
  return (
    <View style={styles.infoCard} pointerEvents={interactive ? "auto" : "none"}>
      <View style={styles.infoHeader}>
        <Text style={[styles.infoTitle, { flex: 1 }]}>{props.title}</Text>
        {props.onClose && (
          <Pressable onPress={props.onClose} hitSlop={8}>
            <Text style={styles.infoClose}>✕</Text>
          </Pressable>
        )}
      </View>
      {props.lines.map((l, i) => (
        <Text key={i} style={styles.infoMeta}>
          {l}
        </Text>
      ))}
      {props.actions && props.actions.length > 0 && (
        <View style={styles.infoActions}>
          {props.actions.map((a) => (
            <SheetButton key={a.label} label={a.label} onPress={a.onPress} />
          ))}
        </View>
      )}
    </View>
  );
}

// selection bar: the identity of the selected edge/road at the top of the
// canvas — start title on the left, end title on the right, and the
// collapsed in-between rendered as a dashed connector with the step count.
// Transparent: it sits directly on the canvas, replacing the query button.
// Tap re-opens the route query prefilled with this selection (the last
// road fills the search by default); the lock icon pins the selection
// against automatic clearing; long-press opens the mutation UI: the edge
// action sheet for a single edge, the route query panel for a road
export function SelectionBar(props: {
  from: string;
  to: string;
  steps: number;
  locked: boolean;
  onPress: () => void;
  onToggleLock: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      style={styles.selectionBar}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      delayLongPress={LONG_PRESS_MS}
    >
      <Text style={styles.selectionBarEnd} numberOfLines={1}>
        {props.from}
      </Text>
      <View style={styles.selectionBarMiddle}>
        <View style={styles.selectionBarDash} />
        <Text style={styles.selectionBarSteps}>
          {props.steps} {props.steps === 1 ? "step" : "steps"}
        </Text>
        <View style={styles.selectionBarDash} />
      </View>
      <Text style={[styles.selectionBarEnd, styles.selectionBarEndRight]} numberOfLines={1}>
        {props.to}
      </Text>
      {/* nested pressable: the lock toggles without triggering the bar's tap */}
      <Pressable onPress={props.onToggleLock} hitSlop={10} style={styles.selectionBarLock}>
        <Text style={styles.selectionBarLockText}>{props.locked ? "🔒" : "🔓"}</Text>
      </Pressable>
    </Pressable>
  );
}

// top banner for modes that retarget canvas taps/drags: connect mode,
// summarize mode, bend-drag mode
export function ModeBanner(props: { text: string; confirmLabel?: string; onConfirm?: () => void; onCancel: () => void }) {
  return (
    <View style={styles.modeBanner}>
      <Text style={styles.modeBannerText}>{props.text}</Text>
      {props.onConfirm && props.confirmLabel && (
        <Pressable onPress={props.onConfirm}>
          <Text style={styles.modeBannerAction}>{props.confirmLabel}</Text>
        </Pressable>
      )}
      <Pressable onPress={props.onCancel}>
        <Text style={styles.modeBannerAction}>Cancel</Text>
      </Pressable>
    </View>
  );
}
