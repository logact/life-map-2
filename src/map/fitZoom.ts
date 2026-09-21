// Fit view: the camera scale/offset that lets a set of nodes fit the
// screen. It is a MANUAL command now — the fit button's one-tap overview —
// not the standing camera rule: the base camera is identity (natural
// size) by default and only takes a computed fit when the button is
// pressed. World coordinates never change; screen = world * scale +
// offset. The scale only zooms OUT (never past 1), so a small map fits
// at natural size; pinch zoom is clamped to [1, 4] on top of the fit,
// so from the overview you can only spread back toward natural size.

// smallest zoom the camera will use; content larger than this can still be
// reached by panning
export const MIN_ZOOM = 0.25;

// breathing room between the fitted content and the screen edge, in px
const SCREEN_MARGIN = 32;

// world units beyond the outermost node centers, so the fit accounts for
// the nodes' own extent (the largest node has radius 36) plus a little air
const WORLD_PAD = 44;

export interface FitView {
  scale: number;
  // offset that centers the fitted bounding box on the screen; the user's
  // pan is added on top of this
  x: number;
  y: number;
}

export function computeFitView(
  nodes: { x: number; y: number }[],
  screen: { width: number; height: number },
): FitView {
  if (nodes.length === 0) return { scale: 1, x: 0, y: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  minX -= WORLD_PAD;
  minY -= WORLD_PAD;
  maxX += WORLD_PAD;
  maxY += WORLD_PAD;

  const availW = Math.max(1, screen.width - SCREEN_MARGIN * 2);
  const availH = Math.max(1, screen.height - SCREEN_MARGIN * 2);
  const scale = Math.max(
    MIN_ZOOM,
    Math.min(1, availW / (maxX - minX), availH / (maxY - minY)),
  );

  return {
    scale,
    x: screen.width / 2 - ((minX + maxX) / 2) * scale,
    y: screen.height / 2 - ((minY + maxY) / 2) * scale,
  };
}

// bbox center of the node positions (no padding), null when empty; the
// initial camera placement and the seed reset center this point on the
// screen at natural size
export function contentCenter(
  nodes: { x: number; y: number }[],
): { x: number; y: number } | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
