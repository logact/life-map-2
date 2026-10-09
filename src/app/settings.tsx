import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { useFocusEffect, useRouter } from "expo-router";

import { diagnoseSync, nativeModulePresent, setSyncEnabled, SyncDiagnosis } from "@/data/cloudSync";
import { fmtDate } from "@/map/utils";
import { useDocStore } from "@/state/docStore";
import { useSyncStore } from "@/state/syncStore";
import { CANVAS_BG, CARD_BG, INK, RADIUS, SHADOW, TYPE } from "@/ui/theme";

// The settings screen (/settings): the user's control over iCloud sync —
// the on/off choice (persisted; off makes every sync operation a no-op),
// the live status read-out, and a manual "Sync now". Entry: the map's
// create menu.
export default function SettingsScreen() {
  const router = useRouter();
  const enabled = useSyncStore((s) => s.enabled);
  const state = useSyncStore((s) => s.state);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const lastError = useSyncStore((s) => s.lastError);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  // iCloud sign-in lives in the iOS Settings app, not in-app: deep-link to
  // the Apple Account section, falling back to this app's settings page
  const openIosSettings = () => {
    Linking.openURL("App-Prefs:root=APPLE_ACCOUNT").catch(() => Linking.openSettings());
  };

  // the module check comes first: without the new native binary nothing
  // else (sign-in included) can make sync work
  const moduleMissing = !nativeModulePresent();

  // probe the container on every focus: the plain availability boolean can't
  // tell "signed out of iCloud" apart from "the build's ubiquity container is
  // broken" (issue #31), and each case needs different advice
  const [diagnosis, setDiagnosis] = useState<SyncDiagnosis | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (enabled && !moduleMissing) {
        diagnoseSync().then((d) => {
          if (alive) setDiagnosis(d);
        });
      } else {
        setDiagnosis(null);
      }
      return () => {
        alive = false;
      };
    }, [enabled, moduleMissing]),
  );

  const containerMissing = diagnosis?.kind === "container-missing";
  const signedOut = diagnosis?.kind === "signed-out";
  const status = !enabled
    ? "Sync is off — the map stays on this device only."
    : moduleMissing
      ? "This build doesn't include iCloud sync yet — build a new version with EAS (eas build --profile development) and install it."
      : containerMissing
        ? "iCloud is signed in, but this build can't reach the app's iCloud container — the app needs a fixed build (the App ID must have the iCloud.com.logact.lifemap container assigned; see ICLOUD_SETUP.md)."
        : signedOut || state === "unavailable"
          ? "iCloud unavailable — sign into your Apple Account in the iOS Settings app (and make sure iCloud Drive is on)."
          : state === "syncing"
            ? "Syncing…"
            : state === "error"
              ? "Last sync failed — it will retry on the next edit."
              : lastSyncedAt
                ? `Last synced ${fmtDate(lastSyncedAt)}`
                : "Not synced yet — the first upload happens on your next edit.";

  const showIosSettingsButton =
    enabled && !moduleMissing && !containerMissing && (signedOut || state === "unavailable");

  const toggle = (on: boolean) => {
    setSyncEnabled(on);
    // turning sync on syncs right away, so the switch's effect is visible
    if (on) useDocStore.getState().syncNow();
  };

  return (
    <View style={cs.container}>
      <View style={cs.header}>
        <Pressable accessibilityLabel="Back to map" onPress={back} hitSlop={12}>
          <Text style={cs.headerAction}>‹ Map</Text>
        </Pressable>
        <Text style={cs.headerTitle}>Settings</Text>
        <View style={cs.headerSpacer} />
      </View>

      <View style={cs.card}>
        <View style={cs.row}>
          <Text style={cs.rowLabel}>iCloud sync</Text>
          <Switch
            accessibilityLabel="Toggle iCloud sync"
            value={enabled}
            onValueChange={toggle}
          />
        </View>
        <Text style={cs.status}>{status}</Text>
        {enabled && !moduleMissing && lastError && (
          // the native error code/message — this line is what makes a
          // TestFlight screenshot diagnosable
          <Text style={cs.errorDetail}>{lastError}</Text>
        )}
        {showIosSettingsButton && (
          <Pressable
            accessibilityLabel="Open iOS Settings"
            style={({ pressed }) => [cs.syncButton, pressed && { opacity: 0.7 }]}
            onPress={openIosSettings}
          >
            <Text style={cs.syncButtonText}>Open iOS Settings</Text>
          </Pressable>
        )}
        {enabled && (
          <Pressable
            accessibilityLabel="Sync now"
            style={({ pressed }) => [cs.syncButton, pressed && { opacity: 0.7 }]}
            onPress={() => useDocStore.getState().syncNow()}
          >
            <Text style={cs.syncButtonText}>↻ Sync now</Text>
          </Pressable>
        )}
      </View>
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
  headerSpacer: {
    minWidth: 56,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: INK.subtle,
    padding: 14,
    gap: 10,
    ...SHADOW.card,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: {
    ...TYPE.body,
    fontWeight: "600",
    color: INK.primary,
  },
  status: {
    ...TYPE.meta,
    color: INK.secondary,
  },
  errorDetail: {
    ...TYPE.meta,
    fontSize: 11,
    color: INK.subtle,
  },
  syncButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: INK.subtle,
  },
  syncButtonText: {
    ...TYPE.body,
    color: INK.primary,
  },
});
