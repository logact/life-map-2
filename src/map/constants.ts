// ---------- Shared constants for the map screen ----------

export const NODE_SIZE = 52;
export const TASK_SIZE = 40;
export const RECORD_SIZE = 20;

// double tap on empty canvas = pick a node kind and create it there;
// long-press on a node or edge arms it for dragging (move the node /
// place the edge's bend point)
export const LONG_PRESS_MS = 500;

// two taps on the same target within this window = double tap
export const DOUBLE_TAP_MS = 300;

// two fingers on the canvas zoom the camera continuously (anchored at
// the pinch midpoint); with an active selection, each time the finger
// distance accumulates this ratio the selection also steps one detail
// level (spread = reveal children, squeeze = collapse to parents)
export const PINCH_RATIO = 1.3;

// the pinch camera zoom multiplies the base camera; below 1 the pins and
// titles shrink with it, so geometry stays proportional at every zoom
export const MIN_USER_SCALE = 0.25;
export const MAX_USER_SCALE = 4;

// lens zoom-in framing: when a spread reveals a cramped group, the camera
// zooms in until the group's span fills this share of the smaller screen
// dimension (a camera that already gives the group room is left alone)
export const LENS_FRAME_FILL = 0.6;

// route query: cap on candidate roads listed between two nodes (the
// domain search also stops at its own hop limit)
export const MAX_ROUTE_CANDIDATES = 8;

// new successors / predecessors land this far from their anchor — directly
// above / below, fanning out when the spot is taken (roads climb bottom to top)
export const CHILD_RADIUS = 120;

// a collapsed edge is broken into one segment per hidden child edge;
// the gaps between the equal-length segments are the breakpoints
export const BREAKPOINT_GAP = 6;

// world-anchored dot grid on the canvas: spacing between dots
export const GRID_SPACING = 28;
