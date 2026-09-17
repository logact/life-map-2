// design tokens for the map UI: refined grayscale theme. ACCENT is
// reserved for the route highlight on the canvas; everything else rides
// on the INK scale
export const INK = {
  primary: "#1a1a1c",
  secondary: "#55555b",
  tertiary: "#8e8e94",
  hairline: "#c9c9cf",
  subtle: "#ececef",
} as const;

export const CANVAS_BG = "#f7f7f5"; // warm off-white
export const CARD_BG = "#ffffff";
export const ACCENT = "#1a73e8"; // route highlight only

export const RADIUS = {
  sm: 10,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

// spreadable shadow presets: card for resting nodes, floating for
// panels/cards above the canvas
export const SHADOW = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  floating: {
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

export const TYPE = {
  title: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 14, fontWeight: "400" },
  meta: { fontSize: 12, fontWeight: "500" },
  nodeTitle: { fontSize: 13, fontWeight: "600" },
  record: { fontSize: 9, fontWeight: "500" },
} as const;

export const BACKDROP = "rgba(28,28,30,0.35)";
