import { TextStyle } from "react-native";
import { StatusBarStyle } from "expo-status-bar";

// a spreadable shadow preset (card for resting nodes, floating for
// panels/cards above the canvas)
export interface ShadowPreset {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

// the full token set a theme must define. The first block mirrors the
// historical src/ui/theme.ts exports; the rest are the Cartographer
// additions (warm paper atlas)
export interface Theme {
  INK: {
    primary: string;
    secondary: string;
    tertiary: string;
    hairline: string;
    subtle: string;
  };
  CANVAS_BG: string;
  CARD_BG: string;
  // route highlight only — never a general-purpose accent
  ACCENT: string;
  STATUS_COLOR: {
    todo: string;
    "in-progress": string;
    done: string;
  };
  RADIUS: {
    sm: number;
    md: number;
    lg: number;
    pill: number;
  };
  SHADOW: {
    card: ShadowPreset;
    floating: ShadowPreset;
  };
  TYPE: {
    title: TextStyle;
    body: TextStyle;
    meta: TextStyle;
    nodeTitle: TextStyle;
    record: TextStyle;
  };
  BACKDROP: string;

  NODE_BORDER: string;
  INPUT_BORDER: string;
  INPUT_BG: string;
  // a row's pressed state
  PRESSED_BG: string;
  // the sheet grabber / grip affordance
  HANDLE: string;
  DANGER: string;
  // the mode banner (and the focus pill)
  BANNER_BG: string;
  BANNER_TEXT: string;
  // status-less roads (edges touching records)
  EDGE_NEUTRAL: string;
  // text on INK.primary-filled buttons/pills
  ON_INK: string;
  STATUS_BAR: StatusBarStyle;
  DOT_GRID_OPACITY: number;
  // the tag color palette (colorblind-aware)
  PALETTE: { label: string; color: string }[];
}
