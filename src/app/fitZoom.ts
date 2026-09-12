// Fit-zoom: the camera scale that lets the current set of nodes fit the
// screen. World coordinates never change; screen = world * scale + offset.
// The scale only zooms OUT (never past 1), so a sparse map renders at the
// natural size; as items accumulate and their bounding box outgrows the
// screen, the scale shrinks so everything stays visible and nothing
// overlaps more than it did before (relative geometry is preserved).

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
