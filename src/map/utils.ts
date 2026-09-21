import { FitView } from "@/map/fitZoom";
import { Id, LifeMapDoc, NodeData, NodeKind } from "@/domain/doc";
import {
  BREAKPOINT_GAP,
  CHILD_RADIUS,
  GRID_SPACING,
  NODE_SIZE,
  RECORD_SIZE,
  TASK_SIZE,
} from "./constants";

// the camera the user sees: the fit view scaled by their pinch zoom about
// the screen center. screen = world * cam.scale + cam offset + viewport pan
export function composedCam(
  base: FitView,
  userScale: number,
  screen: { width: number; height: number },
): FitView {
  return {
    scale: base.scale * userScale,
    x: (screen.width / 2) * (1 - userScale) + userScale * base.x,
    y: (screen.height / 2) * (1 - userScale) + userScale * base.y,
  };
}

export function nodeSize(kind: NodeKind): number {
  if (kind === "task") return TASK_SIZE;
  if (kind === "record") return RECORD_SIZE;
  return NODE_SIZE;
}

// roads read as climbing straight from bottom to top: a successor lands
// directly above its anchor, a predecessor directly below (screen y points
// down, so "above" is a negative angle). Repeated adds fan out within
// 45 degrees of that line; the golden-step fraction keeps them from
// stacking, and the first add hits the line dead-center
export function childPosition(
  parent: NodeData,
  index: number,
  side: "successor" | "predecessor",
): { x: number; y: number } {
  const frac = (0.5 + index * 0.618) % 1;
  const axis = side === "successor" ? -Math.PI / 2 : Math.PI / 2;
  const angle = axis + (frac - 0.5) * (Math.PI / 2);
  return {
    x: parent.x + Math.cos(angle) * CHILD_RADIUS,
    y: parent.y + Math.sin(angle) * CHILD_RADIUS,
  };
}

// the distinct endpoint nodes of the given edges — the group the camera
// frames after a lens spread reveals children
export function edgeEndpointNodes(doc: LifeMapDoc, edgeIds: Id[]): NodeData[] {
  const nodes = new Map<Id, NodeData>();
  for (const id of edgeIds) {
    const e = doc.edges[id];
    if (!e) continue;
    const a = doc.nodes[e.fromId];
    const b = doc.nodes[e.toId];
    if (a) nodes.set(a.id, a);
    if (b) nodes.set(b.id, b);
  }
  return [...nodes.values()];
}

// short readable date for the inspector's timestamps (epoch millis)
export function fmtDate(ms: number): string {
  return new Date(ms).toDateString().slice(4); // drop the weekday prefix
}

// interpolate a point along a polyline, t = fraction of its total length
export function pointAlongPath(path: { x: number; y: number }[], t: number): { x: number; y: number } {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    lengths.push(seg);
    total += seg;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] > 0 ? d / lengths[i] : 0;
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * f,
        y: path[i].y + (path[i + 1].y - path[i].y) * f,
      };
    }
    d -= lengths[i];
  }
  return path[path.length - 1];
}

// split a path into n equal-length segments, leaving a gap at each
// breakpoint; bend corners falling inside a segment are kept as
// intermediate points so bent edges keep their shape. Also returns the
// breakpoint positions so the renderer can mark them (needed on dashed
// or dotted edges, where a bare gap blends into the dash pattern)
export function splitPath(
  path: { x: number; y: number }[],
  n: number,
): { segments: { x: number; y: number }[][]; breakpoints: { x: number; y: number }[] } {
  if (n <= 1 || path.length < 2) return { segments: [path], breakpoints: [] };
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    lengths.push(seg);
    total += seg;
  }
  if (total === 0) return { segments: [path], breakpoints: [] };
  const segLen = total / n;
  // the gap shrinks when segments are short so every break stays visible
  const gap = Math.min(BREAKPOINT_GAP, segLen * 0.3);
  // arc position of each original vertex (to preserve bend corners)
  const vertexAt: number[] = [0];
  for (const l of lengths) vertexAt.push(vertexAt[vertexAt.length - 1] + l);
  const segments: { x: number; y: number }[][] = [];
  const breakpoints: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) breakpoints.push(pointAlongPath(path, (i * segLen) / total));
    const d0 = i * segLen + (i === 0 ? 0 : gap / 2);
    const d1 = (i + 1) * segLen - (i === n - 1 ? 0 : gap / 2);
    if (d1 <= d0) continue;
    const points = [pointAlongPath(path, d0 / total)];
    for (let v = 1; v < path.length - 1; v++) {
      if (vertexAt[v] > d0 && vertexAt[v] < d1) points.push(path[v]);
    }
    points.push(pointAlongPath(path, d1 / total));
    segments.push(points);
  }
  return { segments, breakpoints };
}

// dot grid covering the visible window, in world coordinates: the dots
// render inside the viewport-transformed edge layer, so they stay
// anchored to the world and shift with panning. The spacing doubles
// whenever the zoom would pack dots tighter than 24 px on screen, and
// the radius counter-scales, so the grid looks identical at any zoom.
export function computeGridDots(
  cameraX: number,
  cameraY: number,
  scale: number,
  width: number,
  height: number,
): { x: number; y: number }[] {
  let gridSpacing = GRID_SPACING;
  while (gridSpacing * scale < 24) gridSpacing *= 2;
  const worldLeft = -cameraX / scale;
  const worldTop = -cameraY / scale;
  const worldRight = (width - cameraX) / scale;
  const worldBottom = (height - cameraY) / scale;
  const gridDots: { x: number; y: number }[] = [];
  const gridStartX = Math.floor(worldLeft / gridSpacing) * gridSpacing;
  const gridStartY = Math.floor(worldTop / gridSpacing) * gridSpacing;
  for (let x = gridStartX; x <= worldRight + gridSpacing; x += gridSpacing) {
    for (let y = gridStartY; y <= worldBottom + gridSpacing; y += gridSpacing) {
      gridDots.push({ x, y });
    }
  }
  return gridDots;
}
