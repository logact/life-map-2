import { memo } from "react";
import { Circle, G, Line, Polygon, Polyline } from "react-native-svg";
import Animated, { useAnimatedProps } from "react-native-reanimated";

import { ACCENT, INK, STATUS_COLOR } from "@/ui/theme";
import { CameraSv } from "../hooks/useMapCamera";
import { EdgeViewModel, NodeViewModel } from "../types";
import { rimOffset, splitPath } from "../utils";

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// the neutral road color: edges with no status (they touch a record)
const EDGE_NEUTRAL = "#aeaeb4";

// status rides on the stroke color; record-touching roads stay neutral
function statusStroke(status: EdgeViewModel["status"]): string {
  return status ? STATUS_COLOR[status] : EDGE_NEUTRAL;
}

// a circle whose radius counter-scales with the live camera on the UI
// thread: fills are not covered by non-scaling-stroke, so the world-space
// radius must grow as the camera zooms out to keep a constant screen size
function CounterScaledCircle(props: {
  sv: CameraSv;
  cx: number;
  cy: number;
  // radius in screen px (the world radius is r / camScale)
  r: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  // capture only shareable values in the worklet (see CameraG)
  const { sv, r } = props;
  const animatedProps = useAnimatedProps(() => ({
    r: r / (sv.baseScale.value * sv.userScale.value),
  }));
  return (
    <AnimatedCircle
      cx={props.cx}
      cy={props.cy}
      fill={props.fill}
      stroke={props.stroke}
      strokeWidth={props.strokeWidth}
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
  // the live camera: arrowheads and markers counter-scale on the UI
  // thread, so camera moves never re-render the glyph
  sv: CameraSv;
  // the settled camera scale, for the rim trim: pins cap at natural size
  // on screen past 1x zoom, so the world-space trim must shrink with the
  // camera (rimOffset) — synced on gesture end, like every render-time
  // geometry here
  settledCamScale: number;
  onPress: (id: string) => void;
  onLongPress: (id: string) => void;
}) {
  const { e, a, b, sv, settledCamScale } = props;
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
  // pulled back to the node boundary. The rims are camera-aware: past 1x
  // zoom the pins stay natural size on screen, so the world-space trim
  // shrinks accordingly (see rimOffset)
  const ra = rimOffset(a.kind, settledCamScale);
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
  const tipX = b.x - ux * rimOffset(b.kind, settledCamScale);
  const tipY = b.y - uy * rimOffset(b.kind, settledCamScale);
  // fills are not covered by non-scaling-stroke: the arrowhead
  // counter-scales with the live camera so it keeps a constant screen
  // size at any zoom (evaluated on the UI thread; the tip and direction
  // are render-time constants captured by the worklet)
  const arrowProps = useAnimatedProps(() => {
    const camScale = sv.baseScale.value * sv.userScale.value;
    const wing = 5 / camScale;
    const back = 11 / camScale;
    const baseX = tipX - ux * back;
    const baseY = tipY - uy * back;
    return {
      points: `${tipX},${tipY} ${baseX - uy * wing},${baseY + ux * wing} ${baseX + uy * wing},${baseY - ux * wing}`,
    };
  });
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
  // each segment of a collapsed edge takes its child edge's status color;
  // a leaf edge takes its own
  const segColors = segments.map((_, i) => {
    if (overridden) return color;
    if (e.hiddenCount > 0) return statusStroke(e.segments?.[i]?.status ?? null);
    return statusStroke(e.status);
  });
  const lastColor = segColors[segColors.length - 1] ?? statusStroke(e.status);
  return (
    <G opacity={props.dimmed ? 0.15 : 1}>
      {/* the stroke color carries the edge's frontier status:
          todo gray, in-progress orange, done green; record-touching
          roads stay neutral */}
      {segments.map((pts, i) => {
        const points = pts.map((p) => `${p.x},${p.y}`).join(" ");
        return (
          <Polyline
            key={i}
            points={points}
            fill="none"
            stroke={segColors[i] ?? lastColor}
            strokeWidth={edgeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      <AnimatedPolygon points="" fill={lastColor} animatedProps={arrowProps} />
      {/* solid marker at each breakpoint: without it the bare gap would
          read as an accidental break in the road */}
      {breakpoints.map((p, i) => (
        <CounterScaledCircle
          key={i}
          sv={props.sv}
          cx={p.x}
          cy={p.y}
          r={edgeWidth + 1}
          fill={segColors[i + 1] ?? lastColor}
        />
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
        <CounterScaledCircle
          sv={props.sv}
          cx={props.liveBend.x}
          cy={props.liveBend.y}
          r={10}
          fill="#ffffff"
          stroke={INK.primary}
          strokeWidth={1.5}
        />
      )}
    </G>
  );
});
