// design tokens for the app UI — a facade over the active theme
// (src/ui/themes): existing "@/ui/theme" imports keep working unchanged;
// switch themes via the ACTIVE selector in src/ui/themes/index.ts. ACCENT
// is reserved for the route highlight on the canvas; everything else rides
// on the INK scale
import { THEME } from "./themes";

export const INK = THEME.INK;
export const CANVAS_BG = THEME.CANVAS_BG;
export const CARD_BG = THEME.CARD_BG;
export const ACCENT = THEME.ACCENT;
export const STATUS_COLOR = THEME.STATUS_COLOR;
export const RADIUS = THEME.RADIUS;
export const SHADOW = THEME.SHADOW;
export const TYPE = THEME.TYPE;
export const BACKDROP = THEME.BACKDROP;

export const NODE_BORDER = THEME.NODE_BORDER;
export const INPUT_BORDER = THEME.INPUT_BORDER;
export const INPUT_BG = THEME.INPUT_BG;
export const PRESSED_BG = THEME.PRESSED_BG;
export const HANDLE = THEME.HANDLE;
export const DANGER = THEME.DANGER;
export const BANNER_BG = THEME.BANNER_BG;
export const BANNER_TEXT = THEME.BANNER_TEXT;
export const EDGE_NEUTRAL = THEME.EDGE_NEUTRAL;
export const ON_INK = THEME.ON_INK;
export const STATUS_BAR = THEME.STATUS_BAR;
export const DOT_GRID_OPACITY = THEME.DOT_GRID_OPACITY;
