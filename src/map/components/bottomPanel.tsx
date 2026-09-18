import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";

import { styles } from "../styles";

// Bottom-docked panel: the single home for object UI (action menus, info
// card). It never floats over the graph's objects; instead the map eases
// the camera up so the focused object stays clear of the panel's area
// (the accommodation effect in the map screen). Non-modal: touches outside
// the card fall through to the canvas, which dismisses the panel and
// retargets in the same motion. Reports its height so the camera knows
// how much room to make. The info card edits text in place, so the panel
// rides above the keyboard (padding avoidance, same policy as the sheets).
export function BottomPanel(props: {
  onHeight: (height: number) => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.bottomPanelWrap} pointerEvents="box-none">
      <KeyboardAvoidingView
        style={styles.bottomPanelKav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
      >
        <View
          style={styles.bottomPanel}
          onLayout={(e) => props.onHeight(e.nativeEvent.layout.height)}
        >
          {props.children}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export interface MenuItem {
  key: string;
  label: string;
  // small leading glyph (the create pair's direction icons) or a color dot
  glyph?: string;
  dot?: string;
  // destructive items confirm in place: the first tap arms the row ("tap
  // again"), the second fires onPress; any other press disarms it
  destructive?: boolean;
  onPress: () => void;
}
export type MenuEntry = MenuItem | "sep";

// the object action menu: a compact vertical list of grouped rows that
// replaced the old bottom-sheet tile grid (see DESIGN_MUTATIONS.md)
export function MenuCard(props: { title?: string; entries: MenuEntry[] }) {
  const [armedKey, setArmedKey] = useState<string | null>(null);
  return (
    <View style={styles.menuCard}>
      {props.title && (
        <Text style={styles.menuTitle} numberOfLines={1}>
          {props.title}
        </Text>
      )}
      {props.entries.map((entry, i) => {
        if (entry === "sep") return <View key={`sep-${i}`} style={styles.menuSeparator} />;
        const armed = entry.destructive === true && armedKey === entry.key;
        return (
          <Pressable
            key={entry.key}
            style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            onPress={() => {
              if (entry.destructive && !armed) {
                setArmedKey(entry.key);
                return;
              }
              setArmedKey(null);
              entry.onPress();
            }}
          >
            {entry.dot ? (
              <View style={[styles.menuDot, { backgroundColor: entry.dot }]} />
            ) : entry.glyph ? (
              <Text style={styles.menuGlyph}>{entry.glyph}</Text>
            ) : null}
            <Text
              style={[
                styles.menuRowText,
                entry.destructive && styles.menuRowTextDestructive,
                armed && styles.menuRowTextArmed,
              ]}
            >
              {armed ? `Tap again to ${entry.label.toLowerCase()}` : entry.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
