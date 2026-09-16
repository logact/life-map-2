import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { RouteResult } from "@/domain/route";
import { SheetButton } from "../components/sheets";
import { styles } from "../styles";

// candidate routes: every road between the two nodes is marked on the
// canvas; tick one, some, or all, then focus the selection
export function RoutesModal(props: {
  visible: boolean;
  routes: RouteResult[];
  pickedRoutes: number[];
  onTogglePick: (index: number) => void;
  onToggleAll: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { routes, pickedRoutes } = props;
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      <View style={styles.formBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.formTitle}>Routes</Text>
          <View style={styles.routeSheetToolbar}>
            <SheetButton
              label={pickedRoutes.length === routes.length ? "Clear all" : "Select all"}
              onPress={props.onToggleAll}
            />
          </View>
          <ScrollView style={styles.routeList} contentContainerStyle={{ gap: 8 }}>
            {routes.map((r, i) => {
              const picked = pickedRoutes.includes(i);
              return (
                <Pressable
                  key={r.nodes.map((n) => n.id).join(">")}
                  style={[styles.routeCard, picked && styles.routeCardPicked]}
                  onPress={() => props.onTogglePick(i)}
                >
                  <Text style={styles.routeCardTitle}>
                    {picked ? "☑" : "☐"} Route {i + 1} · {r.edges.length}{" "}
                    {r.edges.length === 1 ? "step" : "steps"} · ~
                    {Math.round(r.length)} px
                  </Text>
                  <Text style={styles.routeCardPath} numberOfLines={2}>
                    {r.nodes.map((n) => n.title).join(" → ")}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.formButtons}>
            <Pressable
              style={({ pressed }) => [
                styles.formSave,
                pickedRoutes.length === 0 && styles.formSaveDisabled,
                pressed && { opacity: 0.6 },
              ]}
              disabled={pickedRoutes.length === 0}
              onPress={props.onConfirm}
            >
              <Text style={styles.formSaveText}>
                Show{" "}
                {pickedRoutes.length === routes.length
                  ? "all"
                  : pickedRoutes.length}{" "}
                {pickedRoutes.length === 1 ? "road" : "roads"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
