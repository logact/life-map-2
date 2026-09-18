import { StyleSheet } from "react-native";

import { ACCENT, BACKDROP, CANVAS_BG, INK, SHADOW } from "@/ui/theme";
import { NODE_SIZE } from "./constants";

export const styles = StyleSheet.create({
  // refined grayscale: kind rides on shape, status on outline style,
  // selection on border weight; tokens come from src/ui/theme.ts
  container: {
    flex: 1,
    backgroundColor: CANVAS_BG,
  },
  node: {
    position: "absolute",
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#d4d4d9",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
    ...SHADOW.card,
  },
  nodeSelected: {
    borderColor: INK.primary,
    borderWidth: 2,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  },
  // long-pressed (armed) node lifts: a following movement drags it
  nodeArmed: {
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  nodePulsingBase: {
    borderColor: "transparent",
  },
  nodeTodo: {
    borderColor: INK.tertiary,
  },
  nodeTitleTodo: {
    color: INK.tertiary,
  },
  nodeTitleDone: {
    textDecorationLine: "line-through",
    opacity: 0.45,
  },
  nodeRecord: {
    borderColor: INK.tertiary,
    borderWidth: 1,
    backgroundColor: INK.subtle,
    padding: 2,
  },
  nodeTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: INK.primary,
    textAlign: "center",
  },
  nodeTitleRecord: {
    fontSize: 9,
    fontWeight: "500",
  },
  queryButton: {
    position: "absolute",
    right: 20,
    top: 56,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: INK.subtle,
    alignItems: "center",
    justifyContent: "center",
    ...SHADOW.floating,
  },
  undoButton: {
    position: "absolute",
    right: 20,
    top: 108, // below the query button
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: INK.subtle,
    alignItems: "center",
    justifyContent: "center",
    ...SHADOW.floating,
  },
  redoButton: {
    position: "absolute",
    right: 20,
    top: 160, // below the undo button
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: INK.subtle,
    alignItems: "center",
    justifyContent: "center",
    ...SHADOW.floating,
  },
  historyButtonDisabled: {
    opacity: 0.4,
  },
  queryButtonText: {
    fontSize: 18,
    color: INK.primary,
  },
  selectionBar: {
    position: "absolute",
    top: 56, // same row as the standalone query button it replaces
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14, // a taller target for the long-press
  },
  selectionBarEnd: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
    color: INK.primary,
  },
  selectionBarEndRight: {
    textAlign: "right",
  },
  // the collapsed in-between: a dashed connector carrying the step count
  selectionBarMiddle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  selectionBarDash: {
    flex: 1,
    borderBottomWidth: 1,
    borderStyle: "dashed",
    borderColor: INK.secondary,
  },
  selectionBarSteps: {
    fontSize: 11,
    fontWeight: "500",
    color: INK.secondary,
  },
  selectionBarLock: {
    padding: 2,
  },
  selectionBarLockText: {
    fontSize: 15,
  },
  noteResults: {
    maxHeight: 240,
  },
  noteSearchEmpty: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: INK.secondary,
  },
  noteRow: {
    borderWidth: 1,
    borderColor: INK.subtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    marginBottom: 8,
  },
  noteRowText: {
    fontSize: 14,
    color: INK.primary,
  },
  noteRowFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noteRowMeta: {
    flex: 1,
    fontSize: 12,
    color: INK.secondary,
  },
  routePanel: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: INK.subtle,
    padding: 8,
    ...SHADOW.floating,
  },
  routeFields: {
    flex: 1,
    gap: 4,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#e0e0e4",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  routeRowActive: {
    borderColor: INK.primary,
    borderWidth: 1.5,
  },
  routeRowLabel: {
    fontSize: 13,
    color: INK.secondary,
    fontWeight: "600",
    width: 36,
  },
  routeInput: {
    flex: 1,
    fontSize: 15,
    color: INK.primary,
    paddingVertical: 0,
  },
  routeSuggestion: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f2",
  },
  routeSuggestionText: {
    fontSize: 13,
    color: INK.primary,
  },
  routeSuggestionKind: {
    fontSize: 12,
    color: INK.tertiary,
  },
  routeIconButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  routeIconButtonText: {
    fontSize: 16,
    color: INK.primary,
    fontWeight: "600",
  },
  routeCard: {
    borderWidth: 1,
    borderColor: INK.subtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  routeCardPicked: {
    borderColor: ACCENT,
    backgroundColor: `${ACCENT}14`,
  },
  routeSheetToolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  routeList: {
    flexGrow: 0,
    maxHeight: 320,
  },
  routeCardTitle: {
    fontSize: 14,
    color: INK.primary,
    fontWeight: "600",
  },
  routeCardPath: {
    fontSize: 13,
    color: INK.secondary,
  },
  formBackdrop: {
    flex: 1,
    backgroundColor: BACKDROP,
    justifyContent: "flex-end",
  },
  formSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 14,
  },
  formTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: INK.primary,
  },
  formInput: {
    borderWidth: 1,
    borderColor: "#e0e0e4",
    borderRadius: 12,
    backgroundColor: "#f7f7f5",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: INK.primary,
  },
  formInputMultiline: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  formButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  formCancel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  formCancelText: {
    color: INK.secondary,
    fontWeight: "600",
  },
  formSave: {
    backgroundColor: INK.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },
  formSaveDisabled: {
    opacity: 0.4,
  },
  formSaveText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  inspectorButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: INK.primary,
  },
  inspectorButtonText: {
    fontSize: 13,
    color: INK.primary,
    fontWeight: "600",
  },
  // info card content; rendered inside the BottomPanel shell, which
  // provides the card chrome. The node's title/detail edit in place here
  infoCard: {
    width: "100%",
    gap: 4,
    padding: 6,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: INK.primary,
  },
  infoHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  infoClose: {
    fontSize: 14,
    fontWeight: "600",
    color: INK.secondary,
    padding: 2,
  },
  infoActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  infoMeta: {
    fontSize: 13,
    color: INK.secondary,
  },
  // inline editing on the node info card: the inputs keep the display
  // text's metrics, marked as editable by a subtle underline/border
  infoTitleInput: {
    fontSize: 15,
    fontWeight: "700",
    color: INK.primary,
    padding: 0,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: INK.secondary,
  },
  infoDetailPlaceholder: {
    fontSize: 13,
    color: INK.secondary,
    fontStyle: "italic",
  },
  infoDetailInput: {
    fontSize: 13,
    color: INK.primary,
    borderWidth: 1,
    borderColor: INK.subtle,
    borderRadius: 8,
    padding: 8,
    minHeight: 44,
    textAlignVertical: "top",
  },
  // inline color editing on the edge info card: palette swatches plus a
  // default (∅) entry; the active color carries a dark ring
  swatchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchSelected: {
    borderColor: INK.primary,
  },
  swatchDefault: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: INK.subtle,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchDefaultText: {
    fontSize: 12,
    color: INK.secondary,
  },
  // status row on the node info card: current status plus one button per
  // legal transition
  infoStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  infoStatusText: {
    fontSize: 13,
    fontWeight: "600",
    color: INK.primary,
  },
  // notes peek on the node info card: just the newest note (truncated)
  // plus a "view all" row — the full list lives in the notes sheet
  infoNotesSep: {
    height: 1,
    backgroundColor: INK.subtle,
    marginVertical: 6,
  },
  notePeekText: {
    fontSize: 14,
    color: INK.primary,
  },
  notePeekMeta: {
    fontSize: 12,
    color: INK.secondary,
    marginTop: 2,
  },
  notePeekLink: {
    fontSize: 13,
    fontWeight: "600",
    color: INK.secondary,
    marginTop: 4,
  },
  // full notes list inside the modal notes sheet
  notesSheetList: {
    maxHeight: 360,
  },
  modeBanner: {
    position: "absolute",
    top: 110, // below the route panel row
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: "#2c2c2e",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    ...SHADOW.floating,
  },
  modeBannerText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  modeBannerAction: {
    color: "#d8d8dc",
    fontSize: 14,
    fontWeight: "600",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d8dade",
  },
  // bottom-docked panel: the single home for object UI (menus, info
  // card). Touches outside the card fall through to the canvas (the wrap
  // is box-none); the camera shifts up so the focused object stays clear
  // of the panel's area
  bottomPanelWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    padding: 16,
  },
  // keyboard-avoidance shell around the panel: padding mode lifts the
  // panel above the keyboard while an info-card field is being edited
  bottomPanelKav: {
    width: "100%",
    alignItems: "center",
  },
  bottomPanel: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: INK.subtle,
    padding: 6,
    ...SHADOW.floating,
  },
  // menu content inside the BottomPanel shell
  menuCard: {
    width: "100%",
  },
  menuTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: INK.tertiary,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  menuRowPressed: {
    backgroundColor: "#f4f4f6",
  },
  menuRowText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "500",
    color: INK.primary,
  },
  menuRowTextDestructive: {
    color: "#b3402f",
  },
  // the armed (second-tap) state of a destructive row
  menuRowTextArmed: {
    fontWeight: "700",
  },
  menuGlyph: {
    width: 34,
    fontSize: 11,
    color: INK.secondary,
    textAlign: "center",
  },
  menuDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  menuSeparator: {
    height: 1,
    backgroundColor: INK.subtle,
    marginVertical: 4,
    marginHorizontal: 10,
  },
  // connect handle on a focused node: drag from it onto another node to
  // create an edge (drag direction = edge direction)
  connectHandle: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: INK.primary,
    borderWidth: 2,
    borderColor: "#ffffff",
    ...SHADOW.card,
  },
});
