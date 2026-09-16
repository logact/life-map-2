// ---------- Shared constants for the map screen ----------

export const NODE_SIZE = 72;
export const TASK_SIZE = 56;
export const RECORD_SIZE = 30;

// double tap on empty canvas = pick a node kind and create it there;
// long-press on a node or edge arms it for dragging (move the node /
// place the edge's bend point)
export const LONG_PRESS_MS = 500;

// two taps on the same target within this window = double tap
export const DOUBLE_TAP_MS = 300;

// two fingers on the canvas zoom the camera continuously; with an active
// selection, each time the finger distance accumulates this ratio the
// selection also steps one detail level (spread = reveal children,
// squeeze = collapse to parents). Steps stay anchored at the pinch
// midpoint: the world point under it keeps its screen position
export const PINCH_RATIO = 1.3;

// the pinch camera zoom multiplies the fit-zoom; clamped so the content
// can't be lost at either extreme
export const MIN_USER_SCALE = 0.5;
export const MAX_USER_SCALE = 4;

// route query: cap on candidate roads listed between two nodes (the
// domain search also stops at its own hop limit)
export const MAX_ROUTE_CANDIDATES = 8;

// golden angle: successive children fan out around the parent without
// landing on top of each other
export const CHILD_RADIUS = 120;

// a collapsed edge is broken into one segment per hidden child edge;
// the gaps between the equal-length segments are the breakpoints
export const BREAKPOINT_GAP = 6;

// world-anchored dot grid on the canvas: spacing between dots
export const GRID_SPACING = 28;
