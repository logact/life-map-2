import { Platform } from "react-native";

import { Theme } from "./types";

// Cartographer — warm paper atlas. A printed map: cream canvas, espresso
// ink, serif display headings, slate-blue route lines (the "blue = route
// highlight only" rule holds), warm-tuned status hues.
export const cartographer: Theme = {
  INK: {
    primary: "#2e2620",
    secondary: "#6d5f52",
    tertiary: "#a2937f",
    hairline: "#d8cfbf",
    subtle: "#eae3d5",
  },
  CANVAS_BG: "#f4efe6",
  CARD_BG: "#fdfaf3",
  ACCENT: "#3a6ea5", // route highlight only
  STATUS_COLOR: {
    todo: "#a2937f",
    "in-progress": "#d98e1b",
    done: "#5f7f4a",
  },
  RADIUS: {
    sm: 10,
    md: 16,
    lg: 20,
    pill: 999,
  },
  SHADOW: {
    card: {
      shadowColor: "#3a2f22",
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    floating: {
      shadowColor: "#3a2f22",
      shadowOpacity: 0.14,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
  },
  TYPE: {
    // display serif for titles; no custom font dependency
    title: {
      fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
      fontSize: 18,
      fontWeight: "600",
    },
    body: { fontSize: 14, fontWeight: "400" },
    meta: { fontSize: 12, fontWeight: "500", letterSpacing: 0.2 },
    nodeTitle: { fontSize: 13, fontWeight: "600" },
    record: { fontSize: 9, fontWeight: "500" },
  },
  BACKDROP: "rgba(46,38,32,0.40)",

  NODE_BORDER: "#ddd3c2",
  INPUT_BORDER: "#ddd3c2",
  INPUT_BG: "#f8f3e9",
  PRESSED_BG: "#f1ead9",
  HANDLE: "#cfc4b0",
  DANGER: "#a63d22",
  BANNER_BG: "#3a3128",
  BANNER_TEXT: "#f8f3e9",
  EDGE_NEUTRAL: "#ada189",
  ON_INK: "#fdfaf3",
  STATUS_BAR: "dark",
  DOT_GRID_OPACITY: 0.05,
  // 10 warm, colorblind-aware tag colors
  PALETTE: [
    { label: "Burnt orange", color: "#C2571F" },
    { label: "Amber", color: "#D9A21B" },
    { label: "Olive", color: "#7A8B3D" },
    { label: "Sage", color: "#5F8F6A" },
    { label: "Slate blue", color: "#3A6EA5" },
    { label: "Mauve", color: "#8E5572" },
    { label: "Rust", color: "#A63D22" },
    { label: "Teal", color: "#3E7C7B" },
    { label: "Rose", color: "#C96F8E" },
    { label: "Bronze", color: "#8A6D3B" },
  ],
};
