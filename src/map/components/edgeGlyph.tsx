import { memo, useEffect } from "react";
import { Circle, G, Line, Polygon, Polyline } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { ACCENT, INK } from "@/ui/theme";
import { EdgeViewModel, NodeViewModel } from "../types";
import { nodeSize, splitPath } from "../utils";

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

// in-progress edge: dotted line whose dashes march toward the target node
function MarchingPolyline(props: { points: string; color: string; width: number }) {
  const offset = useSharedValue(0);
  useEffect(() => {
    // dash period of "2 8" is 10, so -10 loops seamlessly; negative moves
    // the pattern toward the target end of the path
    offset.value = withRepeat(withTiming(-10, { duration: 800, easing: Easing.linear }), -1, false);
  }, [offset]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  return (
    <AnimatedPolyline
      points={props.points}
      fill="none"
      stroke={props.color}
      strokeWidth={props.width}
      strokeDasharray="2 8"
      strokeLinecap="round"
      strokeLinejoin="round"
      // the edge layer scales with the fit-zoom; keep the stroke and its
      // dash pattern at a constant screen size
      vectorEffect="non-scaling-stroke"
      animatedProps={animatedProps}
    />
  );
}

// one visible edge: the (possibly broken) line with per-segment status
// styling, the arrowhead into the target node, breakpoint markers, the
// wide invisible hit area, and the bend handle while a bend drag is armed
// memoized: the view-model objects keep their identity across unrelated
// renders (deriveViewModel is useMemo'd and posById reuses references),
// and the screen hands over once-created dispatchers, so a shallow
// compare skips every glyph its own props didn't change
export const EdgeGlyph = memo(function EdgeGlyph(props: {
  e: EdgeViewModel;
  a: NodeViewModel;
  b: NodeViewModel;
  selected: boolean;
  onRoute: boolean;
  // the node spotlight wins over the selection lens visually (the
  // selection itself is untouched)
  related: boolean;
  dimmed: boolean;
  // a bend drag in progress overrides the stored bend point
  liveBend: { x: number; y: number } | null;
  camScale: number;
  reduceMotion: boolean;
  onPress: (id: string) => void;
  onLongPress: (id: string) => void;
}) {
  const { e, a, b } = props;
  // selection, spotlight and route preview override everything: the
  // whole edge draws in the single override color, no per-segment colors
  const overridden = props.onRoute || props.selected || props.related;
  const color = props.selected
    ? INK.primary
    : props.onRoute
      ? ACCENT
      : props.related
        ? INK.secondary
        : "#aeaeb4";
  const edgeWidth = overridden ? 4 : Math.max(1.5, 3 - e.layer);
  const bend = props.liveBend ?? e.bend;
  // the line runs rim-to-rim: nodes with a translucent fill would let a
  // center-to-center line show through their interior, so both ends are
  // pulled back to the node boundary
  const ra = nodeSize(a.kind) / 2;
  // start at the source rim, along the first segment (a -> bend when bent)
  const sx = bend ? bend.x : b.x;
  const sy = bend ? bend.y : b.y;
  const sdx = sx - a.x;
  const sdy = sy - a.y;
  const slen = Math.hypot(sdx, sdy);
  const soff = Math.min(ra, slen);
  const startX = slen > 0 ? a.x + (sdx / slen) * soff : a.x;
  const startY = slen > 0 ? a.y + (sdy / slen) * soff : a.y;
  // arrowhead at the target node's edge, pointing into it; the
  // direction comes from the LAST segment (bend -> target when bent)
  const ax = bend ? bend.x : a.x;
  const ay = bend ? bend.y : a.y;
  const dx = b.x - ax;
  const dy = b.y - ay;
  const len = Math.hypot(dx, dy);
  const ux = len > 0 ? dx / len : 0;
  const uy = len > 0 ? dy / len : 0;
  const tipX = b.x - ux * (nodeSize(b.kind) / 2);
  const tipY = b.y - uy * (nodeSize(b.kind) / 2);
  // fills are not covered by non-scaling-stroke: counter-scale the
  // arrowhead so it keeps a constant screen size at any zoom
  const wing = 5 / props.camScale;
  const back = 11 / props.camScale;
  const baseX = tipX - ux * back;
  const baseY = tipY - uy * back;
  const arrowPoints = `${tipX},${tipY} ${baseX - uy * wing},${baseY + ux * wing} ${baseX + uy * wing},${baseY - ux * wing}`;
  const bentPoints = bend ? `${a.x},${a.y} ${bend.x},${bend.y} ${b.x},${b.y}` : "";
  // a collapsed edge breaks into one equal-length segment per
  // hidden child edge; the gaps between segments are the breakpoints
  const start = { x: startX, y: startY };
  const tip = { x: tipX, y: tipY };
  const trimmedPath = bend ? [start, bend, tip] : [start, tip];
  // overlapping nodes can pull the trimmed ends past each other; the
  // arrowhead still marks the target rim, but there is no line to draw
  const lineVisible = bend || (tipX - startX) * ux + (tipY - startY) * uy > 0;
  const { segments, breakpoints } = lineVisible
    ? splitPath(trimmedPath, Math.max(1, e.hiddenCount))
    : { segments: [], breakpoints: [] };
  // each segment of a collapsed edge takes its child edge's own
  // color and status; a leaf edge takes its own color
  const segStyles = segments.map((_, i) => {
    if (overridden) return { color, status: e.status };
    if (e.hiddenCount > 0) {
      const s = e.segments?.[i];
      return { color: s?.color ?? "#aeaeb4", status: s?.status ?? null };
    }
    return { color: e.color ?? "#aeaeb4", status: e.status };
  });
  const lastSeg = segStyles[segStyles.length - 1] ?? { color: e.color ?? "#aeaeb4", status: e.status };
  return (
    <G opacity={props.dimmed ? 0.15 : 1}>
      {/* line style carries the edge's frontier status:
          todo=dashed, in-progress=dotted marching toward the
          target, done/records=solid */}
      {segments.map((pts, i) => {
        const points = pts.map((p) => `${p.x},${p.y}`).join(" ");
        const seg = segStyles[i] ?? lastSeg;
        const segDash =
          seg.status === "todo" ? "6 6" : seg.status === "in-progress" ? "2 8" : undefined;
        return seg.status === "in-progress" && !props.reduceMotion ? (
          <MarchingPolyline key={i} points={points} color={seg.color} width={edgeWidth} />
        ) : (
          <Polyline
            key={i}
            points={points}
            fill="none"
            stroke={seg.color}
            strokeWidth={edgeWidth}
            strokeDasharray={segDash}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      <Polygon points={arrowPoints} fill={lastSeg.color} />
      {/* solid marker at each breakpoint: the bare gap blends into
          the dash pattern of todo/in-progress edges, so the break
          needs its own mark */}
      {breakpoints.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={(edgeWidth + 1) / props.camScale} fill={(segStyles[i + 1] ?? lastSeg).color} />
      ))}
      {/* wide invisible hit area so thin lines stay tappable at
          any zoom (non-scaling-stroke keeps it 24 px on screen) */}
      {bend ? (
        <Polyline
          points={bentPoints}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          vectorEffect="non-scaling-stroke"
          onPress={() => props.onPress(e.id)}
          onLongPress={() => props.onLongPress(e.id)}
        />
      ) : (
        <Line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="transparent"
          strokeWidth={24}
          vectorEffect="non-scaling-stroke"
          onPress={() => props.onPress(e.id)}
          onLongPress={() => props.onLongPress(e.id)}
        />
      )}
      {/* bend handle: visible while a bend drag is armed; the
          radius counter-scales so it stays grabbable when zoomed out */}
      {props.liveBend && (
        <Circle
          cx={props.liveBend.x}
          cy={props.liveBend.y}
          r={10 / props.camScale}
          fill="#ffffff"
          stroke={INK.primary}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </G>
  );
});
