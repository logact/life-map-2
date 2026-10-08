import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";

import { fmtDuration } from "@/domain/focus";
import { useDocStore } from "@/state/docStore";
import { useFocusStore } from "@/state/focusStore";
import { BANNER_BG, BANNER_TEXT, RADIUS, SHADOW } from "@/ui/theme";

// the active focus session's ever-present pill on the map:
// "● task · 12m". Tapping it returns to the focus screen. It ticks its
// own clock so the map canvas doesn't re-render with the timer
export function FocusBanner() {
  const router = useRouter();
  const session = useFocusStore((s) => s.session);
  const task = useDocStore((s) => (session ? s.doc.nodes[session.taskId] : undefined));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);
  if (!session || !task) return null;
  const elapsed = fmtDuration(now - session.segmentStartedAt);
  return (
    <Pressable
      accessibilityLabel={`Focus session on ${task.title}, ${elapsed}. Return to focus`}
      style={({ pressed }) => [bs.banner, pressed && { opacity: 0.7 }]}
      onPress={() => router.push("/focus")}
    >
      <Text style={bs.text} numberOfLines={1}>
        ● {task.title} · {elapsed}
      </Text>
    </Pressable>
  );
}

const bs = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 110, // below the top row, same lane as the mode banners
    left: 20,
    maxWidth: "70%",
    backgroundColor: BANNER_BG,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...SHADOW.floating,
  },
  text: {
    color: BANNER_TEXT,
    fontSize: 13,
    fontWeight: "600",
  },
});
