import "react-native-get-random-values";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useFocusStore } from "@/state/focusStore";

export default function RootLayout() {
  // resume a focus session persisted before the app was killed (the store
  // loads once per session; it waits for the doc to validate the task)
  useEffect(() => {
    useFocusStore.getState().load();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
