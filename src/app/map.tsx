import { Fragment, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Circle, G, Line, Polygon, Polyline } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Edge } from "@/domain/edge";
import Goal from "@/domain/goal";
import { Task } from "@/domain/task";
import { Record as RecordNode } from "@/domain/record";
import { LayerView, LifeMap } from "@/domain/lifeMap";
import { isGoalNode, isRecordNode, isTaskNode, Node, NodeKind } from "@/domain/node";
import { findRoutes, RouteResult } from "@/domain/route";
import { edgeStatus, goalStatus, nodeStatus, Status, startTask, pauseTask, completeTask, completeGoal, reopenTask, reopenGoal } from "@/domain/status";
import { PALETTE } from "@/app/palette";
import { ACCENT, BACKDROP, CANVAS_BG, INK, SHADOW } from "@/app/theme";
import { computeFitView, FitView } from "@/app/fitZoom";
import { loadLifeMap, scheduleSave } from "@/data/lifeMapStore";

// ---------- View models: plain data describing what to draw ----------
// The UI renders ONLY from these. It never renders domain objects directly.

interface NodeViewModel {
  id: string;
  x: number;
  y: number;
  title: string;
  kind: NodeKind;
  status?: Status;
  color?: string;
}

interface EdgeViewModel {
  id: string;
  fromId: string;
  toId: string;
  layer: number;
  status: Status | null;
  bend?: { x: number; y: number };
  color?: string;
  // hidden sub-edges of a collapsed edge; the line is broken into this
  // many equal-length segments
  hiddenCount: number;
  // one entry per direct child edge, in order: its own color and status
  segments?: { color?: string; status: Status | null }[];
}

interface MapViewModel {
  nodes: NodeViewModel[];
  edges: EdgeViewModel[];
}

// the camera the user sees: the fit view scaled by their pinch zoom about
// the screen center. screen = world * cam.scale + cam offset + viewport pan
function composedCam(
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

// domain -> view model: walk the edges visible at the current zoom state,
// then the isolated nodes. LayerView.edges is exactly the set of visible
// edges (zoomed edges are replaced by their children), so do NOT
// recurse into childrenEdges here — they are not visible until revealed.
function mapDomainToViewModel(layerView: LayerView): MapViewModel {
  console.log("[FLOW]   render step 2: converting domain -> view models");
  const nodes = new Map<string, NodeViewModel>();
  const edges: EdgeViewModel[] = [];

  for (const e of layerView.edges) {
    edges.push({
      id: e.id,
      fromId: e.node1.id,
      toId: e.node2.id,
      layer: e.layer,
      status: edgeStatus(e),
      bend: e.bend,
      color: e.color,
      hiddenCount: e.childrenEdges.length,
      segments: e.childrenEdges.length > 0
        ? e.childrenEdges.map((c) => ({ color: c.color, status: edgeStatus(c) }))
        : undefined,
    });
    for (const n of [e.node1, e.node2]) {
      if (!nodes.has(n.id)) {
        nodes.set(n.id, { id: n.id, x: n.x, y: n.y, title: n.title, kind: n.kind, status: nodeStatus(n) ?? undefined, color: n.color });
      }
    }
  }

  for (const n of layerView.map.rootNodes) {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, { id: n.id, x: n.x, y: n.y, title: n.title, kind: n.kind, status: nodeStatus(n) ?? undefined, color: n.color });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// view models carry domain ids so a tap can find the real domain object again
function findDomainNode(map: LifeMap, id: string): Node | undefined {
  const stack: Edge[] = [...map.rootEdges];
  while (stack.length > 0) {
    const e = stack.pop()!;
    if (e.node1.id === id) return e.node1;
    if (e.node2.id === id) return e.node2;
    stack.push(...e.childrenEdges);
  }
  return map.rootNodes.find((n) => n.id === id);
}

// ---------- Demo data ----------

// place the sub node created by expand() between its two endpoints
function placeSubNode(edge: Edge, dx = 0, dy = 0): Node {
  const sub = edge.childrenEdges[0].node2;
  sub.x = (edge.node1.x + edge.node2.x) / 2 + dx;
  sub.y = (edge.node1.y + edge.node2.y) / 2 + dy;
  return sub;
}

function createDemoMap(cx: number, cy: number): LifeMap {
  const map = new LifeMap();

  // ---- root goals ----
  const health = new Goal(cx, cy - 160, "Health", [], []);
  const career = new Goal(cx - 140, cy + 80, "Career", [], []);
  const family = new Goal(cx + 140, cy + 80, "Family", [], []);
  const friends = new Goal(cx + 20, cy + 220, "Friends", [], []);
  // isolated node: no edges, only visible via rootNodes
  map.addNode(new Goal(cx - 180, cy + 200, "Learning", [], []));

  // ---- branch A: Health -> Career, the deep multi-branch one ----
  // layer 0 root edge, expanded into a chain (layer 1)
  const healthCareer = map.addEdge(health, career);
  map.expand(healthCareer); // health -> hc1 -> career
  const hc1 = placeSubNode(healthCareer, -40);

  // deeper: expand the first chain link again (layer 2)
  const link1 = healthCareer.childrenEdges[0]; // health -> hc1
  map.expand(link1); // health -> hc2 -> hc1
  const hc2 = placeSubNode(link1, -60);

  // deepest: expand once more (layer 3)
  const link2 = link1.childrenEdges[1]; // hc2 -> hc1
  map.expand(link2); // hc2 -> hc3 -> hc1
  const hc3 = placeSubNode(link2, 40);

  // a road partially traveled: hc2 done, hc3 in progress (the frontier),
  // hc1 not started -> the collapsed health->career edge shows in-progress
  if (isTaskNode(hc2)) completeTask(hc2);
  if (isTaskNode(hc3)) startTask(hc3);

  // multiple branches: extra child edges hanging off the same parents
  const sideA = new Goal(cx - 10, cy + 10, "Side A", [], []);
  map.addEdge(hc1, sideA, healthCareer); // layer 1 sibling of the chain
  const sideB = new Goal(cx - 190, cy - 60, "Side B", [], []);
  map.addEdge(hc2, sideB, link1); // layer 2 sibling

  // ---- branch B: Health -> Family, stops at layer 1 ----
  const healthFamily = map.addEdge(health, family);
  map.expand(healthFamily);
  placeSubNode(healthFamily, 40);

  // ---- branch C: Career -> Friends, stays at layer 0 ----
  map.addEdge(career, friends);

  // ---- tasks and a record under Health ----
  // one task per status; Health is completed MANUALLY, so the goal shows
  // done while Sleep is still in progress (manual completion wins)
  const runTask = new Task(cx - 80, cy - 280, "Run 5km", [], []);
  const sleepTask = new Task(cx + 80, cy - 280, "Sleep 8h", [], []);
  const gymTask = new Task(cx + 160, cy - 240, "Gym 3x/week", [], []);
  map.addTask(health, runTask);
  map.addTask(health, sleepTask);
  map.addTask(health, gymTask);
  completeTask(runTask);
  startTask(sleepTask); // gym stays todo
  completeGoal(health);
  map.attachRecord(
    runTask,
    new RecordNode(cx - 80, cy - 370, "Ran 4.8km", [], [], "felt good", new Date()),
  );

  // ---- tasks under Family: one done, one todo -> Family derives in-progress ----
  const callMom = new Task(cx + 250, cy + 20, "Call mom", [], []);
  const planTrip = new Task(cx + 250, cy + 170, "Plan trip", [], []);
  map.addTask(family, callMom);
  map.addTask(family, planTrip);
  completeTask(callMom);

  return map;
}

// ---------- Screen ----------

const NODE_SIZE = 72;
const TASK_SIZE = 56;
const RECORD_SIZE = 30;

function nodeSize(kind: NodeKind): number {
  if (kind === "task") return TASK_SIZE;
  if (kind === "record") return RECORD_SIZE;
  return NODE_SIZE;
}

// long-press on empty canvas = pick a node kind and create it there;
// long-press on a node or edge arms it for dragging (move the node /
// place the edge's bend point)
const LONG_PRESS_MS = 500;

// two taps on the same target within this window = double tap
const DOUBLE_TAP_MS = 300;

// two fingers on the canvas zoom the camera continuously; with an active
// selection, each time the finger distance accumulates this ratio the
// selection also steps one detail level (spread = reveal children,
// squeeze = collapse to parents). Steps stay anchored at the pinch
// midpoint: the world point under it keeps its screen position
const PINCH_RATIO = 1.3;

// the pinch camera zoom multiplies the fit-zoom; clamped so the content
// can't be lost at either extreme
const MIN_USER_SCALE = 0.5;
const MAX_USER_SCALE = 4;

// what the create form is making: a free node of any kind at a world
// position, a node attached under a parent node (create + connect), or —
// the "Be added to" direction — a new node that becomes the PARENT of an
// existing child
type CreateTarget =
  | { mode: "goal" | "task" | "record"; x: number; y: number }
  | { mode: "goal"; parentId: string }
  | { mode: "task" | "record"; parentId: string }
  | { mode: "goal" | "task" | "record"; childId: string };

// what the info card shows: the last single-tapped node or edge
type InfoTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

// golden angle: successive children fan out around the parent without
// landing on top of each other
const CHILD_RADIUS = 120;
function childPosition(parent: Node, index: number): { x: number; y: number } {
  const angle = index * 2.4; // ~137.5 degrees
  return {
    x: parent.x + Math.cos(angle) * CHILD_RADIUS,
    y: parent.y + Math.sin(angle) * CHILD_RADIUS,
  };
}

// short readable date for the inspector's timestamps
function fmtDate(d: Date): string {
  return d.toDateString().slice(4); // drop the weekday prefix
}

// a collapsed edge is broken into one segment per hidden child edge;
// the gaps between the equal-length segments are the breakpoints
const BREAKPOINT_GAP = 6;

// world-anchored dot grid on the canvas: spacing between dots
const GRID_SPACING = 28;

// interpolate a point along a polyline, t = fraction of its total length
function pointAlongPath(path: { x: number; y: number }[], t: number): { x: number; y: number } {
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
function splitPath(
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

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

// in-progress node outline: a dotted ring breathing between 0.4 and 1.0
// opacity, drawn behind the node so the title stays still
function PulsingRing(props: { x: number; y: number; size: number; borderRadius: number; color: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: props.x - props.size / 2,
          top: props.y - props.size / 2,
          width: props.size,
          height: props.size,
          borderRadius: props.borderRadius,
          borderWidth: 2,
          borderStyle: "dotted",
          borderColor: props.color,
        },
        animated,
      ]}
    />
  );
}

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

// small outlined pill used for the inspector's status actions
function SheetButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.inspectorButton} onPress={props.onPress}>
      <Text style={styles.inspectorButtonText}>{props.label}</Text>
    </Pressable>
  );
}

// peek card for a single tap: title plus a few fact lines. Read-only by
// default (pointerEvents="none", canvas touches pass through and dismiss
// it); with actions/onClose it becomes interactive — the edge card's
// zoom controls and close button
function InfoCard(props: {
  title: string;
  lines: string[];
  actions?: { label: string; onPress: () => void }[];
  onClose?: () => void;
}) {
  const interactive = props.actions !== undefined || props.onClose !== undefined;
  return (
    <View style={styles.infoCard} pointerEvents={interactive ? "auto" : "none"}>
      <View style={styles.infoHeader}>
        <Text style={[styles.infoTitle, { flex: 1 }]}>{props.title}</Text>
        {props.onClose && (
          <Pressable onPress={props.onClose} hitSlop={8}>
            <Text style={styles.infoClose}>✕</Text>
          </Pressable>
        )}
      </View>
      {props.lines.map((l, i) => (
        <Text key={i} style={styles.infoMeta}>
          {l}
        </Text>
      ))}
      {props.actions && props.actions.length > 0 && (
        <View style={styles.infoActions}>
          {props.actions.map((a) => (
            <SheetButton key={a.label} label={a.label} onPress={a.onPress} />
          ))}
        </View>
      )}
    </View>
  );
}

// bottom sheet of mutation actions for a node or edge (double-tap target).
// Actions render as a wrap grid of icon tiles, destructive ones tinted red.
interface SheetAction {
  label: string;
  icon: string;
  destructive?: boolean;
  // tints the icon; used by the color picker's swatches
  color?: string;
  onPress: () => void;
}

function ActionSheet(props: { title: string; subtitle?: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.formBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{props.title}</Text>
          {props.subtitle && <Text style={styles.sheetSubtitle}>{props.subtitle}</Text>}
          <View style={styles.actionGrid}>
            {props.actions.map((a) => (
              <Pressable
                key={a.label}
                style={({ pressed }) => [
                  styles.actionTile,
                  a.destructive && styles.actionTileDestructive,
                  pressed && { opacity: 0.6 },
                ]}
                onPress={a.onPress}
              >
                <Text style={[styles.actionTileIcon, a.color && { color: a.color }]}>{a.icon}</Text>
                <Text
                  style={[styles.actionTileLabel, a.destructive && styles.actionTileLabelDestructive]}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// top banner for modes that retarget canvas taps/drags: connect mode,
// summarize mode, bend-drag mode
function ModeBanner(props: { text: string; confirmLabel?: string; onConfirm?: () => void; onCancel: () => void }) {
  return (
    <View style={styles.modeBanner}>
      <Text style={styles.modeBannerText}>{props.text}</Text>
      {props.onConfirm && props.confirmLabel && (
        <Pressable onPress={props.onConfirm}>
          <Text style={styles.modeBannerAction}>{props.confirmLabel}</Text>
        </Pressable>
      )}
      <Pressable onPress={props.onCancel}>
        <Text style={styles.modeBannerAction}>Cancel</Text>
      </Pressable>
    </View>
  );
}

// route query panel: two search inputs with autocomplete suggestions.
// Each field can also be filled by tapping a node on the canvas.
function RoutePanel(props: {
  query: { from: string; to: string };
  pickerField: "from" | "to" | null;
  suggestions: { from: NodeViewModel[]; to: NodeViewModel[] };
  hasRoutes: boolean;
  onFocusField: (field: "from" | "to") => void;
  onChangeQuery: (field: "from" | "to", text: string) => void;
  onPickSuggestion: (field: "from" | "to", id: string, title: string) => void;
  onSwap: () => void;
  onShowRoutes: () => void;
  onClose: () => void;
}) {
  const renderField = (field: "from" | "to") => (
    <View key={field}>
      <View
        style={[
          styles.routeRow,
          props.pickerField === field && styles.routeRowActive,
        ]}
      >
        <Text style={styles.routeRowLabel}>
          {field === "from" ? "From" : "To"}
        </Text>
        <TextInput
          style={styles.routeInput}
          placeholder="Type a node name, or tap it on the map"
          value={props.query[field]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onFocus={() => props.onFocusField(field)}
          onChangeText={(t) => props.onChangeQuery(field, t)}
        />
      </View>
      {props.pickerField === field &&
        props.suggestions[field].map((n) => (
          <Pressable
            key={n.id}
            style={styles.routeSuggestion}
            onPress={() => props.onPickSuggestion(field, n.id, n.title)}
          >
            <Text style={styles.routeSuggestionText}>
              {n.title}
              <Text style={styles.routeSuggestionKind}>
                {"  "}
                {n.kind}
              </Text>
            </Text>
          </Pressable>
        ))}
    </View>
  );
  return (
    <View style={styles.routePanel}>
      <View style={styles.routeFields}>
        {renderField("from")}
        {renderField("to")}
      </View>
      <Pressable style={styles.routeIconButton} onPress={props.onSwap}>
        <Text style={styles.routeIconButtonText}>⇅</Text>
      </Pressable>
      {props.hasRoutes && (
        <Pressable style={styles.routeIconButton} onPress={props.onShowRoutes}>
          <Text style={styles.routeIconButtonText}>☰</Text>
        </Pressable>
      )}
      <Pressable style={styles.routeIconButton} onPress={props.onClose}>
        <Text style={styles.routeIconButtonText}>✕</Text>
      </Pressable>
    </View>
  );
}

// note query panel: one search input over every note on the map; each
// result shows the note excerpt and its owning node
function NoteSearchPanel(props: {
  query: string;
  results: { noteId: string; nodeId: string; excerpt: string; nodeTitle: string; nodeKind: NodeKind; createdAt: Date }[];
  onChangeQuery: (text: string) => void;
  onPickResult: (nodeId: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.routePanel}>
      <View style={styles.routeFields}>
        <View style={styles.routeRow}>
          <Text style={styles.routeRowLabel}>Note</Text>
          <TextInput
            style={styles.routeInput}
            placeholder="Search notes…"
            value={props.query}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            autoFocus
            onChangeText={props.onChangeQuery}
          />
        </View>
        {props.query.trim() !== "" && props.results.length === 0 && (
          <Text style={styles.noteSearchEmpty}>No notes match</Text>
        )}
        <ScrollView style={styles.noteResults}>
          {props.results.map((r) => (
            <Pressable
              key={r.noteId}
              style={styles.routeSuggestion}
              onPress={() => props.onPickResult(r.nodeId)}
            >
              <Text style={styles.routeSuggestionText} numberOfLines={1}>
                {r.excerpt}
              </Text>
              <Text style={styles.routeSuggestionKind}>
                {r.nodeTitle}
                {"  "}
                {r.nodeKind} · {fmtDate(r.createdAt)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Pressable style={styles.routeIconButton} onPress={props.onClose}>
        <Text style={styles.routeIconButtonText}>✕</Text>
      </Pressable>
    </View>
  );
}

// one node on the canvas: tap shows info / double-tap opens its sheet
// (handled by the parent), long-press arms it so a following movement
// becomes a drag that repositions it in the domain
function DraggableNode(props: {
  n: NodeViewModel;
  screenX: number;
  screenY: number;
  // visual size in screen px (world size * pin scale)
  size: number;
  // camera zoom: gesture deltas are screen px, so world deltas = px / scale
  scale: number;
  // pin scale for the title: tracks the fit-zoom, not the pinch zoom
  textScale: number;
  selected: boolean;
  pulsing: boolean;
  dimmed: boolean;
  armed: boolean;
  borderStyle: "dashed" | "dotted" | "solid";
  onPress: (id: string) => void;
  onArm: (id: string) => void;
  onDragStart: (id: string, x: number, y: number) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}) {
  const size = props.size;
  // task corners keep their 12/56 ratio under the zoom
  const borderRadius = props.n.kind === "task" ? size * (12 / 56) : size / 2;
  // the title shrinks with the fit-zoom, then drops out entirely when the
  // node becomes a dot; the floor keeps it faintly readable meanwhile.
  // Pinch zoom never inflates it (nodes are pins)
  const baseFont = props.n.kind === "record" ? 9 : 13;
  const fontSize = Math.max(6, Math.round(baseFont * props.textScale));
  const showTitle = size >= 18;
  // keep even the smallest node tappable at a comfortable touch target
  const hitSlop = Math.max(0, (44 - size) / 2);
  // the pan responder is created once, so it reads the latest props
  // through a ref instead of closing over stale ones
  const latest = useRef(props);
  latest.current = props;
  const dragOrigin = useRef({ x: 0, y: 0 });
  const dragResponder = useRef(
    PanResponder.create({
      // drag is only possible after a long-press armed this node; the
      // Pressable owns the touch until then (tap / double-tap / long-press)
      onMoveShouldSetPanResponder: (_e, g) =>
        latest.current.armed && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
      onPanResponderGrant: () => {
        const { n, onDragStart } = latest.current;
        dragOrigin.current = { x: n.x, y: n.y };
        onDragStart(n.id, n.x, n.y);
      },
      onPanResponderMove: (_e, g) => {
        const { n, scale, onDragMove } = latest.current;
        onDragMove(n.id, dragOrigin.current.x + g.dx / scale, dragOrigin.current.y + g.dy / scale);
      },
      onPanResponderRelease: (_e, g) => {
        const { n, scale, onDragEnd } = latest.current;
        onDragEnd(n.id, dragOrigin.current.x + g.dx / scale, dragOrigin.current.y + g.dy / scale);
      },
      onPanResponderTerminate: (_e, g) => {
        const { n, scale, onDragEnd } = latest.current;
        onDragEnd(n.id, dragOrigin.current.x + g.dx / scale, dragOrigin.current.y + g.dy / scale);
      },
    }),
  ).current;

  return (
    <View
      {...dragResponder.panHandlers}
      style={{
        position: "absolute",
        left: props.screenX - size / 2,
        top: props.screenY - size / 2,
        opacity: props.dimmed ? 0.2 : 1,
      }}
    >
      <Pressable
        onPress={() => props.onPress(props.n.id)}
        onLongPress={() => props.onArm(props.n.id)}
        delayLongPress={LONG_PRESS_MS}
        hitSlop={hitSlop}
        style={[
          styles.node,
          {
            width: size,
            height: size,
            borderRadius,
            borderStyle: props.borderStyle,
          },
          props.n.kind === "record" && styles.nodeRecord,
          // todo: dashed tertiary outline and title (grayscale status)
          props.n.status === "todo" && styles.nodeTodo,
          // user color: colored border over a faint fill; selection,
          // pulsing and armed styles below still win over it
          props.n.color && { borderColor: props.n.color, backgroundColor: props.n.color + "33" },
          // the pulsing ring draws the border; keep the base invisible
          props.pulsing && styles.nodePulsingBase,
          props.selected && styles.nodeSelected,
          props.armed && styles.nodeArmed,
        ]}
      >
        {showTitle && (
          <Text
            style={[
              styles.nodeTitle,
              props.n.kind === "record" && styles.nodeTitleRecord,
              { fontSize },
              props.n.status === "todo" && styles.nodeTitleTodo,
              props.n.status === "done" && styles.nodeTitleDone,
            ]}
          >
            {props.n.title}
          </Text>
        )}
      </Pressable>
    </View>
  );
}


/**
 * 
 * The map canvas 
 * UI composition method using the absolute position to layout the item in the container.
 * container: View
 *  edges: SVG 
 *  nodes: view
 *  control panle: view
 * 
 * 
 * @returns 
 * 
 * 
 */
export default function MapScreen() {
  const { width, height } = useWindowDimensions();
  console.log("[FLOW] render step 1: React is running MapScreen()");

  // The domain object and its layer view are created once and survive re-renders.
  // The map starts empty and is filled from the local sqlite database on
  // mount; the demo map only seeds a first launch with an empty database.
  const mapRef = useRef<LifeMap | null>(null);
  const layerViewRef = useRef<LayerView | null>(null);
  if (mapRef.current === null) {
    mapRef.current = new LifeMap();
    layerViewRef.current = new LayerView(mapRef.current);
  }
  const map = mapRef.current;
  const layerView = layerViewRef.current!;
  const [mapLoaded, setMapLoaded] = useState(false);

  // Every domain change goes through run(): mutate, re-sync the layer
  // view, persist, then bump state so React re-renders from fresh view models.
  const [, setVersion] = useState(0);
  const run = (mutate: (m: LifeMap) => void) => {
    console.log("[FLOW] event -> mutating domain now");
    mutate(map);
    layerView.refresh();
    scheduleSave(map);
    // domain edits can hide or remove selected edges; prune the selection
    const visible = new Set(layerView.edges.map((e) => e.id));
    setZoomEdgeIds((prev) => prev.filter((id) => visible.has(id)));
    console.log("[FLOW] calling setVersion -> tells React to re-render");
    setVersion((v) => v + 1);
  };

  // ---------- interaction state ----------
  // single tap -> read-only info card; double tap -> action sheet
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null);
  const [sheetNodeId, setSheetNodeId] = useState<string | null>(null);
  const [sheetEdgeId, setSheetEdgeId] = useState<string | null>(null);
  // connect mode: next node tap becomes the target of a new edge
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  // reverse connect mode ("Be connected to"): next node tap becomes the
  // SOURCE of a new edge whose target is this node
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null);
  // kind-picker step of the node sheet: "Add to" creates a child of the
  // chosen kind, "Be added to" creates a parent of the chosen kind
  const [kindPicker, setKindPicker] = useState<{ nodeId: string; direction: "child" | "parent" } | null>(null);
  // status-picker step of the node sheet: offers only the statuses the
  // state machine allows from the node's current one
  const [statusPickerNodeId, setStatusPickerNodeId] = useState<string | null>(null);
  // color-picker step of the node/edge sheet: pick a palette color or
  // Default (clear) for the target
  const [colorPicker, setColorPicker] = useState<{ kind: "node" | "edge"; id: string; title: string } | null>(null);
  // summarize mode: edge taps accumulate a selection to summarize
  const [summarizeMode, setSummarizeMode] = useState(false);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  // long-press arms a node for dragging; the drag itself lives in `drag`
  const [dragArmedId, setDragArmedId] = useState<string | null>(null);
  // long-press on an edge arms bend-drag: the next canvas drag places the
  // edge's bend point (live position kept here, committed on release)
  const [bendDrag, setBendDrag] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const bendDragRef = useRef(bendDrag);
  bendDragRef.current = bendDrag;

  const closeOverlays = () => {
    setInfoTarget(null);
    setSheetNodeId(null);
    setSheetEdgeId(null);
    setInspectorNodeId(null);
    setKindPicker(null);
    setStatusPickerNodeId(null);
    setColorPicker(null);
    setNotesNodeId(null);
    setNoteDraft(null);
  };
  // the pan responder is created once; it reaches the latest closer via ref
  const closeOverlaysRef = useRef(closeOverlays);
  closeOverlaysRef.current = closeOverlays;

  // ---------- selection-scoped zoom ----------
  // The selection is the lens for zoom/collapse: a single tap selects an
  // edge, the route query selects a whole road. Zooming reveals the hidden
  // children of selected edges one level at a time; collapsing folds the
  // deepest selected frontier back into its parents. Pure view state —
  // zoom never touches the domain.
  const [zoomEdgeIds, setZoomEdgeIds] = useState<string[]>([]);
  const zoomEdgeIdsRef = useRef(zoomEdgeIds);
  zoomEdgeIdsRef.current = zoomEdgeIds;

  // One zoom step on the selection, anchored at (mx, my) so the content
  // under the gesture stays put while the fit view reacts to the changed
  // node set. Selection is hereditary: revealed children inherit it on
  // zoom-in, parents inherit it on collapse.
  const zoomSelectionStep = (deeper: boolean, mx: number, my: number) => {
    const sel = zoomEdgeIdsRef.current;
    if (sel.length === 0) return;
    const cam = fitRef.current;
    const vp = viewportRef.current;
    const wx = (mx - vp.x - cam.x) / cam.scale;
    const wy = (my - vp.y - cam.y) / cam.scale;
    const next = deeper ? layerView.zoomIn(sel) : layerView.zoomOut(sel);
    if (next.length === 0) return; // nothing to reveal/collapse: camera only
    const visible = new Set(layerView.edges.map((e) => e.id));
    setZoomEdgeIds([
      ...sel.filter((id) => visible.has(id)),
      ...next.map((e) => e.id),
    ]);
    // the visible node set changed, so re-derive the camera and solve the
    // pan that keeps the anchor world point fixed:
    // viewport = screen - world * scale - camOffset
    const newCam = composedCam(
      computeFitView(mapDomainToViewModel(layerView).nodes, { width, height }),
      userScaleRef.current,
      { width, height },
    );
    setViewport({
      x: mx - wx * newCam.scale - newCam.x,
      y: my - wy * newCam.scale - newCam.y,
    });
    setVersion((v) => v + 1);
  };

  // fit/reset: fold every zoomed edge back to the top layer and restore
  // the fit-to-screen camera
  const resetView = () => {
    layerView.reset();
    userScaleRef.current = 1;
    setUserScale(1);
    setViewport({ x: 0, y: 0 });
    setZoomEdgeIds([]);
    closeOverlays();
    setVersion((v) => v + 1);
  };

  // respect the OS reduce-motion setting: pulse/march fall back to static outlines
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  // load the persisted map once on mount; seed the demo map (and persist
  // it) only when the database is still empty
  useEffect(() => {
    let cancelled = false;
    loadLifeMap()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          mapRef.current = loaded;
        } else {
          mapRef.current = createDemoMap(width / 2, height / 3);
          scheduleSave(mapRef.current);
        }
        layerViewRef.current = new LayerView(mapRef.current);
        setMapLoaded(true);
        setVersion((v) => v + 1);
      })
      .catch((err) => console.warn("[lifeMapStore] load failed", err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // creation flow: what the form is making
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [draft, setDraft] = useState({ title: "", detail: "" });

  // inspector flow: which node's panel is open, and its editable text.
  // Status buttons act immediately; title/description/note wait for Save.
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [inspectorDraft, setInspectorDraft] = useState({ title: "", detail: "" });

  // notes flow: which node's note list is open, and the note being added
  // or edited (noteId present = editing that existing note)
  const [notesNodeId, setNotesNodeId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ nodeId: string; noteId?: string; text: string } | null>(null);

  // note query flow: keyword search across every note on the map
  const [noteSearchMode, setNoteSearchMode] = useState(false);
  const [noteQuery, setNoteQuery] = useState("");

  // route query flow: pick From/To nodes, list candidate routes, then
  // focus the chosen one (center it, highlight it, dim everything else)
  const [routeMode, setRouteMode] = useState(false);
  const [routeFromId, setRouteFromId] = useState<string | null>(null);
  const [routeToId, setRouteToId] = useState<string | null>(null);
  const [routePickerField, setRoutePickerField] = useState<"from" | "to" | null>(null);
  // the text typed into the From/To search inputs
  const [routeQuery, setRouteQuery] = useState({ from: "", to: "" });
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number | null>(null);

  const clearRouteState = () => {
    setRouteFromId(null);
    setRouteToId(null);
    setRoutePickerField(null);
    setRouteQuery({ from: "", to: "" });
    setRoutes([]);
    setSelectedRouteIndex(null);
  };

  const enterRouteMode = () => {
    setSelectedEdgeIds([]);
    setSummarizeMode(false);
    setConnectSourceId(null);
    setConnectTargetId(null);
    setKindPicker(null);
    setBendDrag(null);
    setDragArmedId(null);
    closeOverlays();
    clearRouteState();
    exitNoteSearchMode(); // modes are mutually exclusive
    setRouteMode(true);
  };

  const exitRouteMode = () => {
    clearRouteState();
    setRouteMode(false);
  };

  const enterNoteSearchMode = () => {
    setSelectedEdgeIds([]);
    setSummarizeMode(false);
    setConnectSourceId(null);
    setConnectTargetId(null);
    setKindPicker(null);
    setBendDrag(null);
    setDragArmedId(null);
    closeOverlays();
    clearRouteState();
    setRouteMode(false); // modes are mutually exclusive
    setNoteQuery("");
    setNoteSearchMode(true);
  };

  const exitNoteSearchMode = () => {
    setNoteQuery("");
    setNoteSearchMode(false);
  };

  // focus a search result's node: zoom open the ancestors of its
  // shallowest edge so the node becomes visible, center it on screen, and
  // open its info card
  const focusNoteNode = (nodeId: string) => {
    const node = findDomainNode(map, nodeId);
    if (!node) return;
    const edges = [...node.startEdges, ...node.endEdges];
    if (edges.length > 0) {
      const shallowest = edges.reduce((a, b) => (a.layer <= b.layer ? a : b));
      layerView.reveal(shallowest);
      setVersion((v) => v + 1);
    }
    // the reveal changed the visible nodes, so derive the new camera from
    // them, then pan so the node lands at the screen center:
    // userPan = (screenCenter - world * scale) - camOffset
    const newCam = composedCam(
      computeFitView(mapDomainToViewModel(layerView).nodes, { width, height }),
      userScaleRef.current,
      { width, height },
    );
    setViewport({
      x: width / 2 - node.x * newCam.scale - newCam.x,
      y: height / 2 - node.y * newCam.scale - newCam.y,
    });
    Keyboard.dismiss();
    setInfoTarget({ kind: "node", id: node.id });
  };

  // search over the currently visible edges so every route edge can be
  // rendered and highlighted
  const searchRoutes = (fromId: string, toId: string) => {
    const found = findRoutes(layerView.edges, fromId, toId);
    if (found.length === 0) {
      setRoutes([]);
      setSelectedRouteIndex(null);
      Alert.alert("No route", "No directed path connects these two nodes.");
      return;
    }
    setRoutes(found);
    setSelectedRouteIndex(null);
  };

  // confirm a candidate: focus it — center its bounding box on screen,
  // the renderer highlights its edges and dims everything else — and make
  // its edges the zoom selection, so a following pinch reveals or
  // collapses detail along the whole road at once
  const confirmRoute = (index: number) => {
    const route = routes[index];
    if (!route) return;
    setSelectedRouteIndex(index);
    setZoomEdgeIds(route.edges.map((e) => e.id));
    const xs = route.nodes.map((n) => n.x);
    const ys = route.nodes.map((n) => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // userPan = (screenCenter - world * scale) - camOffset
    setViewport({
      x: width / 2 - cx * cam.scale - cam.x,
      y: height / 2 - cy * cam.scale - cam.y,
    });
  };

  // fill one route end from a suggestion tap or a canvas tap, then
  // search as soon as both ends are known
  const pickRouteNode = (field: "from" | "to", id: string, title: string) => {
    if (field === "from") {
      setRouteFromId(id);
      setRouteQuery((q) => ({ ...q, from: title }));
    } else {
      setRouteToId(id);
      setRouteQuery((q) => ({ ...q, to: title }));
    }
    setRoutePickerField(null);
    Keyboard.dismiss();
    const from = field === "from" ? id : routeFromId;
    const to = field === "to" ? id : routeToId;
    if (from && to) {
      if (from === to) {
        Alert.alert("Same node", "Choose two different nodes for a route.");
        return;
      }
      searchRoutes(from, to);
    }
  };

  const swapRouteEnds = () => {
    const from = routeFromId;
    const to = routeToId;
    setRouteFromId(to);
    setRouteToId(from);
    setRouteQuery((q) => ({ from: q.to, to: q.from }));
    if (from && to) searchRoutes(to, from);
  };

  // the route shown on the canvas: the confirmed one, or the shortest
  // candidate as a preview while the alternatives sheet is open
  const activeRoute =
    selectedRouteIndex !== null
      ? (routes[selectedRouteIndex] ?? null)
      : routeMode && routes.length > 0
        ? routes[0]
        : null;
  const routeEdgeIds = new Set((activeRoute?.edges ?? []).map((e) => e.id));
  const routeNodeIds = new Set((activeRoute?.nodes ?? []).map((n) => n.id));
  // dim everything off the route only once a candidate is confirmed
  const routeFocusOn = routeMode && selectedRouteIndex !== null;
  // the zoom selection: pinch reveals/collapses detail on exactly these edges
  const zoomEdgeIdSet = new Set(zoomEdgeIds);

  // Camera = fit-zoom × user pinch zoom + user pan. The fit view (scale +
  // centering offset) is recomputed from the visible nodes on every
  // render; `userScale` is the pinch zoom composed on top of it (about the
  // screen center, see composedCam) and `viewport` is the user's pan.
  // Domain coordinates never change: screen = world * cam.scale + cam
  // offset + viewport.
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [userScale, setUserScale] = useState(1);
  const userScaleRef = useRef(userScale);
  userScaleRef.current = userScale;
  // the raw fit view and the latest composed camera (zoom + centering
  // offset, without the pan), read by the once-created pan responder for
  // world <-> screen conversion
  const baseFitRef = useRef<FitView>({ scale: 1, x: 0, y: 0 });
  const fitRef = useRef({ scale: 1, x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  // continuous pinch camera zoom, anchored at the pinch midpoint (mx, my):
  // the world point under it keeps its screen position
  const pinchCameraZoom = (ratio: number, mx: number, my: number) => {
    const z = Math.min(MAX_USER_SCALE, Math.max(MIN_USER_SCALE, userScaleRef.current * ratio));
    if (z === userScaleRef.current) return;
    const cam = fitRef.current;
    const vp = viewportRef.current;
    const wx = (mx - vp.x - cam.x) / cam.scale;
    const wy = (my - vp.y - cam.y) / cam.scale;
    userScaleRef.current = z;
    setUserScale(z);
    const newCam = composedCam(baseFitRef.current, z, { width, height });
    setViewport({
      x: mx - wx * newCam.scale - newCam.x,
      y: my - wy * newCam.scale - newCam.y,
    });
  };

  // the pinch gesture lives in the canvas pan responder (created once),
  // so it reaches the latest zoom functions through a ref
  const pinchRef = useRef({ camera: pinchCameraZoom, detail: zoomSelectionStep });
  pinchRef.current = { camera: pinchCameraZoom, detail: zoomSelectionStep };

  // whether the current touch has moved past the tap threshold
  const panMoved = useRef(false);
  // pinch state: baseline distance between the two fingers, whether a
  // pinch is currently active, and the accumulated ratio toward the next
  // detail step
  const pinchStart = useRef<number | null>(null);
  const pinching = useRef(false);
  const detailAcc = useRef(1);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // long-press on empty canvas opens a kind picker at that point; picking
  // a kind opens the create form there (world position = (screen position
  // - camera offset) / zoom)
  const [freeSpacePicker, setFreeSpacePicker] = useState<{ x: number; y: number } | null>(null);
  const openCreatePickerAt = (screenX: number, screenY: number) => {
    closeOverlays();
    setFreeSpacePicker({
      x: (screenX - viewportRef.current.x - fitRef.current.x) / fitRef.current.scale,
      y: (screenY - viewportRef.current.y - fitRef.current.y) / fitRef.current.scale,
    });
  };

  // The container claims empty-space touches immediately (node Pressables
  // still win on their own area) so it can start a long-press timer. Any
  // movement past the threshold cancels the timer and becomes a pan —
  // unless a bend drag is armed, in which case the drag moves the bend.
  // A second finger turns the gesture into a pinch: the camera zooms
  // continuously with the finger distance, and the selection steps one
  // detail level each time the accumulated distance crosses PINCH_RATIO.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        panStart.current = viewportRef.current;
        panMoved.current = false;
        pinchStart.current = null;
        pinching.current = false;
        if (bendDragRef.current) return; // bend drag: no create-picker timer
        const { pageX, pageY } = e.nativeEvent;
        cancelLongPress();
        longPressTimer.current = setTimeout(
          () => openCreatePickerAt(pageX, pageY),
          LONG_PRESS_MS,
        );
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          // pinch: zoom the camera continuously, and step the selection's
          // detail level each time the accumulated finger-distance ratio
          // crosses PINCH_RATIO (spread = reveal, squeeze = collapse)
          pinching.current = true;
          panMoved.current = true;
          cancelLongPress();
          const dist = Math.hypot(
            touches[1].pageX - touches[0].pageX,
            touches[1].pageY - touches[0].pageY,
          );
          const mx = (touches[0].pageX + touches[1].pageX) / 2;
          const my = (touches[0].pageY + touches[1].pageY) / 2;
          if (pinchStart.current === null) {
            pinchStart.current = dist;
            detailAcc.current = 1;
            return;
          }
          const ratio = dist / pinchStart.current;
          pinchStart.current = dist;
          pinchRef.current.camera(ratio, mx, my);
          detailAcc.current *= ratio;
          if (detailAcc.current >= PINCH_RATIO) {
            detailAcc.current = 1;
            pinchRef.current.detail(true, mx, my);
          } else if (detailAcc.current <= 1 / PINCH_RATIO) {
            detailAcc.current = 1;
            pinchRef.current.detail(false, mx, my);
          }
          return;
        }
        if (pinching.current) {
          // back to one finger: re-baseline the pan so the viewport
          // doesn't jump when the remaining finger moves
          pinching.current = false;
          pinchStart.current = null;
          panStart.current = {
            x: viewportRef.current.x - g.dx,
            y: viewportRef.current.y - g.dy,
          };
        }
        const bd = bendDragRef.current;
        if (bd) {
          // bend drag: the bend point follows the finger (world coords)
          if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
            panMoved.current = true;
            setBendDrag({
              edgeId: bd.edgeId,
              x: (g.moveX - viewportRef.current.x - fitRef.current.x) / fitRef.current.scale,
              y: (g.moveY - viewportRef.current.y - fitRef.current.y) / fitRef.current.scale,
            });
          }
          return;
        }
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
          panMoved.current = true;
          cancelLongPress();
          closeOverlaysRef.current();
          setViewport({
            x: panStart.current.x + g.dx,
            y: panStart.current.y + g.dy,
          });
        }
      },
      // a touch that never moved is a tap on empty canvas: dismiss
      // overlays and clear the zoom selection (the lens), so the next
      // pinch moves only the camera; a bend drag commits its bend point
      // here if the finger moved
      onPanResponderRelease: () => {
        cancelLongPress();
        pinchStart.current = null;
        pinching.current = false;
        const bd = bendDragRef.current;
        if (bd) {
          if (panMoved.current) {
            const edge = layerView.edges.find((e) => e.id === bd.edgeId);
            if (edge) {
              console.log("[FLOW] bend drag -> set edge bend (goes through run())");
              run(() => {
                edge.bend = { x: bd.x, y: bd.y };
              });
            }
          }
          setBendDrag(null); // release without a move cancels the bend drag
          return;
        }
        if (!panMoved.current) {
          setInfoTarget(null);
          setDragArmedId(null);
          setZoomEdgeIds([]);
        }
      },
      onPanResponderTerminate: () => {
        cancelLongPress();
        pinchStart.current = null;
        pinching.current = false;
        setBendDrag(null);
      },
    }),
  ).current;

  // node drag = "reposition one node": the live position is UI state so
  // the node and its edges follow the finger, then on release the new
  // world position is committed to the domain through run(). Only an
  // armed (long-pressed) node can be dragged.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const onNodeDragStart = (id: string, x: number, y: number) => {
    closeOverlays();
    setDrag({ id, x, y });
  };
  const onNodeDragMove = (id: string, x: number, y: number) => setDrag({ id, x, y });
  const onNodeDragEnd = (id: string, x: number, y: number) => {
    setDrag(null);
    setDragArmedId(null);
    const node = findDomainNode(map, id);
    if (!node || (node.x === x && node.y === y)) return;
    console.log("[FLOW] drag -> move node (goes through run())");
    run(() => {
      node.x = x;
      node.y = y;
    });
  };

  // domain -> UI: derive plain view models on every render
  const vm = mapDomainToViewModel(layerView);
  // camera: the fit-zoom (recomputed from the visible nodes so a crowded
  // view shrinks into view) with the user's pinch zoom composed on top
  const fit = computeFitView(vm.nodes, { width, height });
  baseFitRef.current = fit;
  const cam = composedCam(fit, userScale, { width, height });
  fitRef.current = cam;
  // nodes render as map pins: pinch zoom spreads the ground beneath them
  // but never grows them past their fit size, so zooming in adds room
  // instead of crowding the map
  const pinScale = fit.scale * Math.min(1, userScale);
  // the dragged node renders at its live drag position, so edges follow it
  const posById = new Map(
    vm.nodes.map((n) => [
      n.id,
      drag && drag.id === n.id ? { ...n, x: drag.x, y: drag.y } : n,
    ]),
  );
  console.log(
    `[FLOW]   render step 3: drawing ${vm.nodes.length} nodes, ${vm.edges.length} edges, ${layerView.zoomedEdgeIds.size} zoomed`,
  );

  const saveInspector = () => {
    if (!inspectorNodeId) return;
    const node = findDomainNode(map, inspectorNodeId);
    if (!node) return;
    const title = inspectorDraft.title.trim();
    if (!title) return;
    console.log("[FLOW] inspector -> save (goes through run())");
    run(() => {
      node.title = title;
      if (isGoalNode(node)) node.description = inspectorDraft.detail.trim() || undefined;
      else if (isRecordNode(node)) node.note = inspectorDraft.detail.trim();
    });
    setInspectorNodeId(null);
  };

  // ---------- single/double tap routing ----------
  // A tap starts a timer: if a second tap on the same target lands within
  // DOUBLE_TAP_MS it becomes a double tap, otherwise the single-tap action
  // fires when the timer expires. A tap on a DIFFERENT target flushes the
  // pending one immediately so the info card stays responsive.
  const nodeTapRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const edgeTapRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const onNodeSingleTap = (id: string) => {
    console.log("[FLOW] tap -> node info card (UI state only)");
    setDragArmedId(null);
    setSheetNodeId(null);
    setSheetEdgeId(null);
    setInspectorNodeId(null);
    setInfoTarget({ kind: "node", id });
    setZoomEdgeIds([]); // nodes aren't zoomable; the edge lens clears
  };

  const onNodeDoubleTap = (id: string) => {
    console.log("[FLOW] double tap -> node action sheet (UI state only)");
    setInfoTarget(null);
    setSheetEdgeId(null);
    setSheetNodeId(id);
  };

  const onNodePress = (id: string) => {
    // route mode: taps only fill the From/To fields, never select/connect
    if (routeMode) {
      const field =
        routePickerField ?? (routeFromId === null ? "from" : routeToId === null ? "to" : null);
      if (!field) return;
      const node = findDomainNode(map, id);
      pickRouteNode(field, id, node?.title ?? "");
      return;
    }
    // note search mode: results are picked in the panel, not on the canvas
    if (noteSearchMode) {
      Keyboard.dismiss();
      return;
    }
    if (bendDrag) return; // bend drag owns the canvas until released/cancelled
    // reverse connect mode: this tap picks the edge source; duplicates allowed
    if (connectTargetId) {
      if (id !== connectTargetId) {
        console.log("[FLOW] reverse connect mode -> add edge (goes through run())");
        const from = findDomainNode(map, id);
        const to = findDomainNode(map, connectTargetId);
        if (from && to) {
          run((m) => m.addEdge(from, to));
        }
      }
      setConnectTargetId(null);
      return;
    }
    // connect mode: this tap picks the edge target; duplicates allowed
    if (connectSourceId) {
      if (id !== connectSourceId) {
        console.log("[FLOW] connect mode -> add edge (goes through run())");
        const from = findDomainNode(map, connectSourceId);
        const to = findDomainNode(map, id);
        if (from && to) {
          run((m) => m.addEdge(from, to));
        }
      }
      setConnectSourceId(null);
      return;
    }
    const pending = nodeTapRef.current;
    if (pending && pending.id === id) {
      clearTimeout(pending.timer);
      nodeTapRef.current = null;
      onNodeDoubleTap(id);
      return;
    }
    if (pending) {
      clearTimeout(pending.timer);
      onNodeSingleTap(pending.id);
    }
    nodeTapRef.current = {
      id,
      timer: setTimeout(() => {
        nodeTapRef.current = null;
        onNodeSingleTap(id);
      }, DOUBLE_TAP_MS),
    };
  };

  const onEdgeSingleTap = (id: string) => {
    console.log("[FLOW] tap -> edge info card + select (UI state only)");
    setSheetNodeId(null);
    setSheetEdgeId(null);
    setInfoTarget({ kind: "edge", id });
    setZoomEdgeIds([id]); // the tapped edge becomes the zoom selection
  };

  const onEdgeDoubleTap = (id: string) => {
    console.log("[FLOW] double tap -> edge action sheet (UI state only)");
    setInfoTarget(null);
    setSheetNodeId(null);
    setSheetEdgeId(id);
  };

  const onEdgePress = (id: string) => {
    if (routeMode || noteSearchMode || connectSourceId || connectTargetId || bendDrag) return;
    // summarize mode: edge taps only grow/shrink the selection
    if (summarizeMode) {
      setSelectedEdgeIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
      return;
    }
    const pending = edgeTapRef.current;
    if (pending && pending.id === id) {
      clearTimeout(pending.timer);
      edgeTapRef.current = null;
      onEdgeDoubleTap(id);
      return;
    }
    if (pending) {
      clearTimeout(pending.timer);
      onEdgeSingleTap(pending.id);
    }
    edgeTapRef.current = {
      id,
      timer: setTimeout(() => {
        edgeTapRef.current = null;
        onEdgeSingleTap(id);
      }, DOUBLE_TAP_MS),
    };
  };

  // long-press an edge arms bend-drag: the bend handle appears at the
  // current bend (or the midpoint) and the next canvas drag places it
  const onEdgeLongPress = (id: string) => {
    if (routeMode || noteSearchMode || summarizeMode || connectSourceId || connectTargetId) return;
    const edge = layerView.edges.find((e) => e.id === id);
    if (!edge) return;
    console.log("[FLOW] long-press edge -> arm bend drag (UI state only)");
    setInfoTarget(null);
    setSheetEdgeId(null);
    const mid = edge.bend ?? {
      x: (edge.node1.x + edge.node2.x) / 2,
      y: (edge.node1.y + edge.node2.y) / 2,
    };
    setBendDrag({ edgeId: id, x: mid.x, y: mid.y });
  };

  // long-press a node arms it for dragging; a following movement becomes
  // the drag (see DraggableNode's armed pan responder)
  const onNodeLongPress = (id: string) => {
    if (routeMode || noteSearchMode || connectSourceId || connectTargetId) return;
    const node = findDomainNode(map, id);
    if (!node) return;
    console.log("[FLOW] long-press node -> arm drag (UI state only)");
    closeOverlays();
    setDragArmedId(id);
  };

  const startCreate = (mode: "task" | "record", parentId: string) => {
    closeOverlays();
    setDraft({ title: "", detail: "" });
    setCreateTarget({ mode, parentId });
  };

  // "Add goal" on a node: create a goal AND connect it to the parent
  const startCreateAttachedGoal = (parentId: string) => {
    closeOverlays();
    setDraft({ title: "", detail: "" });
    setCreateTarget({ mode: "goal", parentId });
  };

  // connect mode: sheet closes, source stays highlighted, next node tap
  // becomes the target
  const startConnect = (sourceId: string) => {
    closeOverlays();
    setConnectSourceId(sourceId);
  };

  // reverse connect mode ("Be connected to"): sheet closes, target stays
  // highlighted, next node tap becomes the source
  const startConnectReverse = (targetId: string) => {
    closeOverlays();
    setConnectTargetId(targetId);
  };

  // "Be added to": create a node of the chosen kind and make it the parent
  // of the current node (edge new -> current)
  const startCreateReverse = (mode: "goal" | "task" | "record", childId: string) => {
    closeOverlays();
    setDraft({ title: "", detail: "" });
    setCreateTarget({ mode, childId });
  };

  const confirmRemoveNode = (node: Node) => {
    Alert.alert("Remove node", `Remove "${node.title}" and all its edges?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          console.log("[FLOW] sheet -> remove node (goes through run())");
          run((m) => m.removeNode(node));
          setSheetNodeId(null);
          setInfoTarget(null);
          if (connectSourceId === node.id) setConnectSourceId(null);
          if (connectTargetId === node.id) setConnectTargetId(null);
        },
      },
    ]);
  };

  const confirmRemoveEdge = (edge: Edge) => {
    Alert.alert("Remove edge", `Remove "${edge.node1.title} → ${edge.node2.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          console.log("[FLOW] sheet -> remove edge (goes through run())");
          run((m) => m.removeEdge(edge));
          setSheetEdgeId(null);
          setInfoTarget(null);
        },
      },
    ]);
  };

  // color picker: apply the chosen swatch (undefined = Default, clears the
  // color) to the node or edge the picker was opened from
  const pickColor = (color?: string) => {
    if (!colorPicker) return;
    console.log("[FLOW] sheet -> set color (goes through run())");
    run((m) =>
      colorPicker.kind === "node"
        ? m.setNodeColor(colorPicker.id, color)
        : m.setEdgeColor(colorPicker.id, color),
    );
    setColorPicker(null);
  };

  const saveCreate = () => {
    if (!createTarget) return;
    const title = draft.title.trim();
    if (!title) return;
    const detail = draft.detail.trim();

    console.log("[FLOW] create form -> save (goes through run())");
    if ("childId" in createTarget) {
      // "Be added to": the new node becomes the PARENT of the current one
      const child = findDomainNode(map, createTarget.childId);
      if (!child) return;
      const index = child.startEdges.length + child.endEdges.length;
      const pos = childPosition(child, index);
      run((m) => {
        const newNode =
          createTarget.mode === "task"
            ? new Task(pos.x, pos.y, title, [], [])
            : createTarget.mode === "record"
              ? new RecordNode(pos.x, pos.y, title, [], [], detail, new Date())
              : new Goal(pos.x, pos.y, title, [], [], detail || undefined);
        m.addEdge(newNode, child);
      });
    } else if ("x" in createTarget) {
      // free node at the long-pressed position
      run((m) =>
        m.addNode(
          createTarget.mode === "task"
            ? new Task(createTarget.x, createTarget.y, title, [], [])
            : createTarget.mode === "record"
              ? new RecordNode(createTarget.x, createTarget.y, title, [], [], detail, new Date())
              : new Goal(createTarget.x, createTarget.y, title, [], [], detail || undefined),
        ),
      );
    } else if ("parentId" in createTarget) {
      const parent = findDomainNode(map, createTarget.parentId);
      if (!parent) return;
      // fan children around the parent; index from existing links so
      // repeated adds don't stack nodes on top of each other
      const index = parent.startEdges.length + parent.endEdges.length;
      const pos = childPosition(parent, index);
      run((m) => {
        if (createTarget.mode === "task") {
          m.addTask(parent as Goal, new Task(pos.x, pos.y, title, [], []));
        } else if (createTarget.mode === "record") {
          m.attachRecord(
            parent,
            new RecordNode(pos.x, pos.y, title, [], [], detail, new Date()),
          );
        } else {
          // attached goal: create + connect
          m.addEdge(parent, new Goal(pos.x, pos.y, title, [], [], detail || undefined));
        }
      });
    }
    setCreateTarget(null);
  };

  const expandEdge = (edgeId: string) => {
    const edge = layerView.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    console.log("[FLOW] sheet -> expand edge (goes through run())");
    // expand is a DOMAIN edit (it creates a sub-node); zoom is the view
    // operation. Expanding zooms this edge open locally so the new
    // children show, without disturbing the rest of the map.
    run((m) => {
      m.expand(edge);
      placeSubNode(edge, -40); // offset so the bend is visible
    });
    layerView.zoomedEdgeIds.add(edge.id);
    layerView.refresh();
    setVersion((v) => v + 1);
    setSelectedEdgeIds([]);
    setSheetEdgeId(null);
    setInfoTarget(null);
  };

  // summarize mode: the sheet's edge is pre-selected, further edge taps
  // extend the selection, Confirm runs the domain summarize
  const startSummarize = (edgeId: string) => {
    setSheetEdgeId(null);
    setInfoTarget(null);
    setSelectedEdgeIds([edgeId]);
    setSummarizeMode(true);
  };

  const cancelSummarize = () => {
    setSummarizeMode(false);
    setSelectedEdgeIds([]);
  };

  const summarizeSelected = () => {
    const edges = layerView.edges.filter((e) => selectedEdgeIds.includes(e.id));
    if (edges.length < 2) return;

    const parentId = (e: Edge) => e.parentEdge?.id ?? "";
    if (edges.some((e) => parentId(e) !== parentId(edges[0]))) {
      Alert.alert("Cannot summarize", "Selected edges must share the same parent.");
      return;
    }

    // endpoints of the summarized edge: the boundary nodes of the
    // selection, i.e. the nodes touched by exactly one selected edge
    const touched = new Map<string, { node: Node; count: number }>();
    for (const e of edges) {
      for (const n of [e.node1, e.node2]) {
        const entry = touched.get(n.id);
        touched.set(n.id, { node: n, count: (entry?.count ?? 0) + 1 });
      }
    }
    const boundary = [...touched.values()]
      .filter((t) => t.count === 1)
      .map((t) => t.node);
    if (boundary.length < 2) {
      Alert.alert("Cannot summarize", "Selected edges need two open end nodes.");
      return;
    }

    console.log("[FLOW] banner -> summarize edges (goes through run())");
    run((m) => m.summarize(boundary[0], boundary[1], edges));
    setSelectedEdgeIds([]);
    setSummarizeMode(false);
  };

  // info card content for a single-tapped node
  const nodeInfoLines = (node: Node): string[] => {
    const s = nodeStatus(node);
    const lines = [s ? `${node.kind} · ${s}` : node.kind];
    if (isGoalNode(node)) {
      if (node.description) lines.push(node.description);
      if (node.targetDate) lines.push(`Target ${fmtDate(node.targetDate)}`);
      if (node.completedAt) lines.push(`Done ${fmtDate(node.completedAt)}`);
    } else if (isTaskNode(node)) {
      if (node.startedAt) lines.push(`Started ${fmtDate(node.startedAt)}`);
      if (node.completedAt) lines.push(`Done ${fmtDate(node.completedAt)}`);
    } else if (isRecordNode(node)) {
      if (node.note) lines.push(node.note);
      lines.push(`Occurred ${fmtDate(node.occuredAt)}`);
    }
    if (node.notes.length > 0) {
      lines.push(`${node.notes.length} note${node.notes.length === 1 ? "" : "s"}`);
    }
    return lines;
  };

  // autocomplete suggestions for the focused route search field
  const routeSuggestions = {
    from:
      routePickerField === "from"
        ? [...posById.values()]
            .filter((n) =>
              n.title.toLowerCase().includes(routeQuery.from.trim().toLowerCase()),
            )
            .slice(0, 5)
        : [],
    to:
      routePickerField === "to"
        ? [...posById.values()]
            .filter((n) =>
              n.title.toLowerCase().includes(routeQuery.to.trim().toLowerCase()),
            )
            .slice(0, 5)
        : [],
  };

  // node highlight: the connect source/target, the info-card node, or route focus
  const highlightedNodeId =
    connectSourceId ?? connectTargetId ?? (infoTarget?.kind === "node" ? infoTarget.id : null);

  // note search results over the whole map (hidden layers included),
  // recomputed on every render while the panel is open
  const noteResults = noteSearchMode ? map.searchNotes(noteQuery) : [];

  // dot grid covering the visible window, in world coordinates: the dots
  // render inside the viewport-transformed edge layer, so they stay
  // anchored to the world and shift with panning. The spacing doubles
  // whenever the zoom would pack dots tighter than 24 px on screen, and
  // the radius counter-scales, so the grid looks identical at any zoom.
  const cameraX = cam.x + viewport.x;
  const cameraY = cam.y + viewport.y;
  let gridSpacing = GRID_SPACING;
  while (gridSpacing * cam.scale < 24) gridSpacing *= 2;
  const worldLeft = -cameraX / cam.scale;
  const worldTop = -cameraY / cam.scale;
  const worldRight = (width - cameraX) / cam.scale;
  const worldBottom = (height - cameraY) / cam.scale;
  const gridDots: { x: number; y: number }[] = [];
  const gridStartX = Math.floor(worldLeft / gridSpacing) * gridSpacing;
  const gridStartY = Math.floor(worldTop / gridSpacing) * gridSpacing;
  for (let x = gridStartX; x <= worldRight + gridSpacing; x += gridSpacing) {
    for (let y = gridStartY; y <= worldBottom + gridSpacing; y += gridSpacing) {
      gridDots.push({ x, y });
    }
  }

  // render nothing until the persisted map (or the seeded demo map) is in
  // place, so gestures never mutate a map that is about to be replaced
  if (!mapLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <Svg style={StyleSheet.absoluteFill}>
        {/* the whole edge layer shifts with the pan and scales with the fit-zoom */}
        <G transform={`translate(${cameraX}, ${cameraY}) scale(${cam.scale})`}>
          {gridDots.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={1.5 / cam.scale} fill={INK.primary} opacity={0.06} />
          ))}
          {vm.edges.map((e) => {
          const a = posById.get(e.fromId);
          const b = posById.get(e.toId);
          if (!a || !b) return null;
          const selected =
            selectedEdgeIds.includes(e.id) ||
            zoomEdgeIdSet.has(e.id) ||
            (infoTarget?.kind === "edge" && infoTarget.id === e.id);
          const onRoute = routeEdgeIds.has(e.id);
          const dimmed = routeFocusOn && !onRoute;
          // route and selection override everything: the whole edge draws
          // in the single override color, no per-segment colors
          const overridden = onRoute || selected;
          const color = onRoute ? ACCENT : selected ? INK.primary : "#aeaeb4";
          const edgeWidth = overridden ? 4 : Math.max(1.5, 3 - e.layer);
          // a bend drag in progress overrides the stored bend point
          const bend = bendDrag && bendDrag.edgeId === e.id ? { x: bendDrag.x, y: bendDrag.y } : e.bend;
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
          const wing = 5 / cam.scale;
          const back = 11 / cam.scale;
          const baseX = tipX - ux * back;
          const baseY = tipY - uy * back;
          const arrowPoints = `${tipX},${tipY} ${baseX - uy * wing},${baseY + ux * wing} ${baseX + uy * wing},${baseY - ux * wing}`;
          const bentPoints = bend ? `${a.x},${a.y} ${bend.x},${bend.y} ${b.x},${b.y}` : "";
          // a collapsed edge breaks into one equal-length segment per
          // hidden child edge; the gaps between segments are the breakpoints
          const { segments, breakpoints } = splitPath(bend ? [a, bend, b] : [a, b], Math.max(1, e.hiddenCount));
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
          const lastSeg = segStyles[segStyles.length - 1];
          return (
            <G key={e.id} opacity={dimmed ? 0.15 : 1}>
              {/* line style carries the edge's frontier status:
                  todo=dashed, in-progress=dotted marching toward the
                  target, done/records=solid */}
              {segments.map((pts, i) => {
                const points = pts.map((p) => `${p.x},${p.y}`).join(" ");
                const seg = segStyles[i] ?? lastSeg;
                const segDash =
                  seg.status === "todo" ? "6 6" : seg.status === "in-progress" ? "2 8" : undefined;
                return seg.status === "in-progress" && !reduceMotion ? (
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
                <Circle key={i} cx={p.x} cy={p.y} r={(edgeWidth + 1) / cam.scale} fill={(segStyles[i + 1] ?? lastSeg).color} />
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
                  onPress={() => onEdgePress(e.id)}
                  onLongPress={() => onEdgeLongPress(e.id)}
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
                  onPress={() => onEdgePress(e.id)}
                  onLongPress={() => onEdgeLongPress(e.id)}
                />
              )}
              {/* bend handle: visible while a bend drag is armed; the
                  radius counter-scales so it stays grabbable when zoomed out */}
              {bendDrag && bendDrag.edgeId === e.id && (
                <Circle
                  cx={bendDrag.x}
                  cy={bendDrag.y}
                  r={10 / cam.scale}
                  fill="#ffffff"
                  stroke={INK.primary}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </G>
          );
          })}
        </G>
      </Svg>

      {vm.nodes.map((n) => {
        // nodes are pins: positions follow the camera, but their size and
        // title only shrink with the fit-zoom — pinch zoom-in never
        // inflates them
        const size = nodeSize(n.kind) * pinScale;
        const borderRadius = n.kind === "task" ? size * (12 / 56) : size / 2;
        const pulsing = n.status === "in-progress" && !reduceMotion;
        // outline style carries status: todo=dashed, in-progress=dotted
        // (breathing ring when motion is allowed), done=solid
        const borderStyle: "dashed" | "dotted" | "solid" =
          n.status === "todo" ? "dashed" : n.status === "in-progress" ? "dotted" : "solid";
        // live position: the drag override while dragging, else the domain
        const pos = posById.get(n.id) ?? n;
        const nodeDimmed = routeFocusOn && !routeNodeIds.has(n.id);
        const screenX = pos.x * cam.scale + cameraX;
        const screenY = pos.y * cam.scale + cameraY;
        return (
        <Fragment key={n.id}>
          {pulsing && !nodeDimmed && (
            <PulsingRing
              x={screenX}
              y={screenY}
              size={size}
              borderRadius={borderRadius}
              color={INK.secondary}
            />
          )}
        <DraggableNode
          n={n}
          screenX={screenX}
          screenY={screenY}
          size={size}
          scale={cam.scale}
          textScale={pinScale}
          selected={n.id === highlightedNodeId || (routeFocusOn && routeNodeIds.has(n.id))}
          pulsing={pulsing}
          dimmed={nodeDimmed}
          armed={dragArmedId === n.id}
          borderStyle={borderStyle}
          onPress={onNodePress}
          onArm={onNodeLongPress}
          onDragStart={onNodeDragStart}
          onDragMove={onNodeDragMove}
          onDragEnd={onNodeDragEnd}
        />
        </Fragment>
        );
      })}

      {!routeMode && !noteSearchMode && (
        <Pressable style={styles.queryButton} onPress={enterRouteMode}>
          <Text style={styles.queryButtonText}>🔍</Text>
        </Pressable>
      )}

      {/* reset: fold all zoomed edges back to the top layer and restore
          the fit-to-screen camera */}
      {!routeMode && !noteSearchMode && (
        <Pressable style={styles.fitButton} onPress={resetView}>
          <Text style={styles.queryButtonText}>⤾</Text>
        </Pressable>
      )}

      {/* mode banners: connect mode and summarize mode retarget taps;
          bend mode retargets the next canvas drag */}
      {connectSourceId && (
        <ModeBanner
          text="Tap a node to connect"
          onCancel={() => setConnectSourceId(null)}
        />
      )}
      {connectTargetId && (
        <ModeBanner
          text="Tap a node to connect it here"
          onCancel={() => setConnectTargetId(null)}
        />
      )}
      {summarizeMode && (
        <ModeBanner
          text={`Tap edges to summarize (${selectedEdgeIds.length} selected)`}
          confirmLabel="Summarize"
          onConfirm={summarizeSelected}
          onCancel={cancelSummarize}
        />
      )}
      {bendDrag && (
        <ModeBanner
          text="Drag anywhere to bend the edge"
          onCancel={() => setBendDrag(null)}
        />
      )}

      {/* single-tap info card: read-only peek at a node or edge */}
      {infoTarget && !sheetNodeId && !sheetEdgeId && !inspectorNodeId &&
        (() => {
          if (infoTarget.kind === "node") {
            const node = findDomainNode(map, infoTarget.id);
            if (!node) return null;
            return <InfoCard title={node.title} lines={nodeInfoLines(node)} />;
          }
          const edge = layerView.edges.find((e) => e.id === infoTarget.id);
          if (!edge) return null;
          const s = edgeStatus(edge);
          const lines = [s ? `Layer ${edge.layer} · ${s}` : `Layer ${edge.layer}`];
          if (edge.childrenEdges.length > 0) {
            lines.push(
              `${edge.childrenEdges.length} hidden sub-edge${edge.childrenEdges.length === 1 ? "" : "s"}`,
            );
          }
          // non-gesture zoom controls on the selected edge: one level per
          // tap, the same operations as the pinch steps
          const actions: { label: string; onPress: () => void }[] = [];
          if (edge.childrenEdges.length > 0) {
            actions.push({
              label: "Zoom in",
              onPress: () => zoomSelectionStep(true, width / 2, height / 2),
            });
          }
          if (edge.parentEdge && layerView.zoomedEdgeIds.has(edge.parentEdge.id)) {
            actions.push({
              label: "Collapse",
              onPress: () => zoomSelectionStep(false, width / 2, height / 2),
            });
          }
          return (
            <InfoCard
              title={`${edge.node1.title} → ${edge.node2.title}`}
              lines={lines}
              actions={actions}
              onClose={() => {
                setInfoTarget(null);
                setZoomEdgeIds([]);
              }}
            />
          );
        })()}

      {/* double-tap node sheet: everything that mutates this node */}
      {sheetNodeId &&
        (() => {
          const node = findDomainNode(map, sheetNodeId);
          if (!node) return null;
          const actions: SheetAction[] = [];
          // records are leaves: nothing can be added under them
          if (!isRecordNode(node)) {
            actions.push({
              label: "Add to",
              icon: "➕",
              onPress: () => {
                setSheetNodeId(null);
                setKindPicker({ nodeId: node.id, direction: "child" });
              },
            });
          }
          actions.push({
            label: "Be added to",
            icon: "⤴️",
            onPress: () => {
              setSheetNodeId(null);
              setKindPicker({ nodeId: node.id, direction: "parent" });
            },
          });
          actions.push({
            label: "Connect to",
            icon: "→",
            onPress: () => startConnect(node.id),
          });
          actions.push({
            label: "Be connected to",
            icon: "←",
            onPress: () => startConnectReverse(node.id),
          });
          // every node kind can carry notes
          actions.push({
            label: "Notes",
            icon: "📝",
            onPress: () => {
              setSheetNodeId(null);
              setNotesNodeId(node.id);
            },
          });
          // records carry no status, so the change-status step is skipped
          if (!isRecordNode(node)) {
            actions.push({
              label: "Status",
              icon: "◐",
              onPress: () => {
                setSheetNodeId(null);
                setStatusPickerNodeId(node.id);
              },
            });
          }
          actions.push({
            label: "Color",
            icon: "●",
            color: node.color,
            onPress: () => {
              setSheetNodeId(null);
              setColorPicker({ kind: "node", id: node.id, title: node.title });
            },
          });
          actions.push({
            label: "Remove",
            icon: "🗑",
            destructive: true,
            onPress: () => confirmRemoveNode(node),
          });
          return (
            <ActionSheet
              title={node.title}
              subtitle={node.kind}
              actions={actions}
              onClose={() => setSheetNodeId(null)}
            />
          );
        })()}

      {/* free-space kind picker: first step of a long-press on empty
          canvas — pick the kind of the new node, then the create form
          opens at the pressed position */}
      {freeSpacePicker &&
        (() => {
          const { x, y } = freeSpacePicker;
          const pick = (mode: "goal" | "task" | "record") => {
            setFreeSpacePicker(null);
            setDraft({ title: "", detail: "" });
            setCreateTarget({ mode, x, y });
          };
          return (
            <ActionSheet
              title="Create"
              subtitle="Free space"
              actions={[
                { label: "Goal", icon: "◎", onPress: () => pick("goal") },
                { label: "Task", icon: "☑", onPress: () => pick("task") },
                { label: "Record", icon: "✎", onPress: () => pick("record") },
              ]}
              onClose={() => setFreeSpacePicker(null)}
            />
          );
        })()}

      {/* kind picker: second step of "Add to" / "Be added to" — pick the
          kind of the new node, then the create form opens */}
      {kindPicker &&
        (() => {
          const anchor = findDomainNode(map, kindPicker.nodeId);
          if (!anchor) return null;
          const pick = (mode: "goal" | "task" | "record") => {
            const { nodeId, direction } = kindPicker;
            setKindPicker(null);
            if (direction === "child") {
              if (mode === "goal") startCreateAttachedGoal(nodeId);
              else startCreate(mode, nodeId);
            } else {
              startCreateReverse(mode, nodeId);
            }
          };
          return (
            <ActionSheet
              title={anchor.title}
              subtitle={kindPicker.direction === "child" ? "Add to" : "Be added to"}
              actions={[
                { label: "Goal", icon: "◎", onPress: () => pick("goal") },
                { label: "Task", icon: "☑", onPress: () => pick("task") },
                { label: "Record", icon: "✎", onPress: () => pick("record") },
              ]}
              onClose={() => setKindPicker(null)}
            />
          );
        })()}

      {/* status picker: second step of the node sheet's "Status" action —
          offers only the statuses the state machine allows from the
          current one; picking one applies the transition immediately */}
      {statusPickerNodeId &&
        (() => {
          const node = findDomainNode(map, statusPickerNodeId);
          if (!node) return null;
          const change = (label: string, mutate: () => void): SheetAction => ({
            label,
            icon: "◐",
            onPress: () => {
              console.log("[FLOW] sheet -> change status (goes through run())");
              run(mutate);
              setStatusPickerNodeId(null);
            },
          });
          const actions: SheetAction[] = [];
          if (isTaskNode(node)) {
            if (node.status === "todo") {
              actions.push(change("In progress", () => startTask(node)));
              actions.push(change("Done", () => completeTask(node)));
            } else if (node.status === "in-progress") {
              actions.push(change("Todo", () => pauseTask(node)));
              actions.push(change("Done", () => completeTask(node)));
            } else {
              actions.push(change("Todo", () => reopenTask(node)));
            }
          } else if (isGoalNode(node)) {
            // a goal's status is derived from its tasks; the only stored
            // override is the manual completion flag
            if (node.completedAt) {
              actions.push(change("Reopen", () => reopenGoal(node)));
            } else {
              actions.push(change("Done", () => completeGoal(node)));
            }
          }
          if (actions.length === 0) return null;
          return (
            <ActionSheet
              title={node.title}
              subtitle={`Status: ${nodeStatus(node)}`}
              actions={actions}
              onClose={() => setStatusPickerNodeId(null)}
            />
          );
        })()}

      {/* color picker: second step of the node/edge sheet's "Color"
          action — a palette of swatches plus Default (clear); picking one
          applies it through run() and closes the sheet. The title is
          captured when the picker opens, so render touches no refs */}
      {colorPicker && (
        <ActionSheet
          title={colorPicker.title}
          subtitle="Color"
          actions={[
            { label: "Default", icon: "∅", onPress: () => pickColor(undefined) },
            ...PALETTE.map((c) => ({
              label: c.label,
              icon: "●",
              color: c.color,
              onPress: () => pickColor(c.color),
            })),
          ]}
          onClose={() => setColorPicker(null)}
        />
      )}

      {/* double-tap edge sheet: expand / summarize / straighten / remove */}
      {sheetEdgeId &&
        (() => {
          const edge = layerView.edges.find((e) => e.id === sheetEdgeId);
          if (!edge) return null;
          const actions: SheetAction[] = [
            { label: "Expand", icon: "⤢", onPress: () => expandEdge(edge.id) },
            { label: "Summarize with…", icon: "🧩", onPress: () => startSummarize(edge.id) },
          ];
          if (edge.bend) {
            actions.push({
              label: "Straighten",
              icon: "📏",
              onPress: () => {
                console.log("[FLOW] sheet -> straighten edge (goes through run())");
                run(() => {
                  edge.bend = undefined;
                });
                setSheetEdgeId(null);
              },
            });
          }
          actions.push({
            label: "Color",
            icon: "●",
            color: edge.color,
            onPress: () => {
              setSheetEdgeId(null);
              setColorPicker({
                kind: "edge",
                id: edge.id,
                title: `${edge.node1.title} → ${edge.node2.title}`,
              });
            },
          });
          actions.push({
            label: "Remove edge",
            icon: "🗑",
            destructive: true,
            onPress: () => confirmRemoveEdge(edge),
          });
          return (
            <ActionSheet
              title={`${edge.node1.title} → ${edge.node2.title}`}
              subtitle={`Layer ${edge.layer}`}
              actions={actions}
              onClose={() => setSheetEdgeId(null)}
            />
          );
        })()}

      {/* notes sheet: the node's notes newest-first, with add/edit/delete */}
      {notesNodeId &&
        (() => {
          const node = findDomainNode(map, notesNodeId);
          if (!node) return null;
          const confirmRemoveNote = (noteId: string) => {
            Alert.alert("Remove note", "Remove this note?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Remove",
                style: "destructive",
                onPress: () => {
                  console.log("[FLOW] notes -> remove note (goes through run())");
                  run((m) => m.removeNote(node, noteId));
                },
              },
            ]);
          };
          return (
            <Modal visible transparent animationType="fade" onRequestClose={() => setNotesNodeId(null)}>
              <View style={styles.formBackdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setNotesNodeId(null)} />
                <View style={styles.formSheet}>
                  <View style={styles.sheetHandle} />
                  <Text style={styles.formTitle}>{node.title}</Text>
                  <Text style={styles.noteSheetCount}>
                    {node.notes.length === 0
                      ? "No notes yet"
                      : `${node.notes.length} note${node.notes.length === 1 ? "" : "s"}`}
                  </Text>
                  <ScrollView style={styles.notesList}>
                    {node.notes.map((note) => (
                      <View key={note.id} style={styles.noteRow}>
                        <Text style={styles.noteRowText}>{note.text}</Text>
                        <View style={styles.noteRowFooter}>
                          <Text style={styles.noteRowMeta}>
                            {fmtDate(note.createdAt)}
                            {note.updatedAt > note.createdAt ? " · edited" : ""}
                          </Text>
                          <SheetButton
                            label="Edit"
                            onPress={() =>
                              setNoteDraft({ nodeId: node.id, noteId: note.id, text: note.text })
                            }
                          />
                          <SheetButton label="Delete" onPress={() => confirmRemoveNote(note.id)} />
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                  <View style={styles.formButtons}>
                    <Pressable
                      style={({ pressed }) => [styles.formSave, pressed && { opacity: 0.6 }]}
                      onPress={() => setNoteDraft({ nodeId: node.id, text: "" })}
                    >
                      <Text style={styles.formSaveText}>+ Add note</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Modal>
          );
        })()}

      {/* note editor: add a new note or edit an existing one */}
      {noteDraft &&
        (() => {
          const node = findDomainNode(map, noteDraft.nodeId);
          if (!node) return null;
          const saveNote = () => {
            console.log("[FLOW] note editor -> save (goes through run())");
            run((m) => {
              if (noteDraft.noteId) {
                const note = node.notes.find((n) => n.id === noteDraft.noteId);
                if (note) m.updateNote(note, noteDraft.text);
              } else {
                m.addNote(node, noteDraft.text);
              }
            });
            setNoteDraft(null);
          };
          return (
            <Modal visible transparent animationType="fade" onRequestClose={() => setNoteDraft(null)}>
              <KeyboardAvoidingView
                style={styles.formBackdrop}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
              >
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setNoteDraft(null)} />
                <View style={styles.formSheet}>
                  <View style={styles.sheetHandle} />
                  <Text style={styles.formTitle}>
                    {noteDraft.noteId ? "Edit note" : `Note on ${node.title}`}
                  </Text>
                  <TextInput
                    style={[styles.formInput, styles.formInputMultiline]}
                    placeholder="Write a note…"
                    value={noteDraft.text}
                    onChangeText={(t) => setNoteDraft((d) => (d ? { ...d, text: t } : d))}
                    multiline
                    autoFocus
                  />
                  <View style={styles.formButtons}>
                    <Pressable
                      style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
                      onPress={() => setNoteDraft(null)}
                    >
                      <Text style={styles.formCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.formSave,
                        !noteDraft.text.trim() && styles.formSaveDisabled,
                        pressed && { opacity: 0.6 },
                      ]}
                      disabled={!noteDraft.text.trim()}
                      onPress={saveNote}
                    >
                      <Text style={styles.formSaveText}>Save</Text>
                    </Pressable>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </Modal>
          );
        })()}

      {/* note query panel: search every note on the map; tapping a result
          focuses the owning node */}
      {noteSearchMode && (
        <NoteSearchPanel
          query={noteQuery}
          results={noteResults.map((r) => ({
            noteId: r.note.id,
            nodeId: r.node.id,
            excerpt: r.note.text,
            nodeTitle: r.node.title,
            nodeKind: r.node.kind,
            createdAt: r.note.createdAt,
          }))}
          onChangeQuery={setNoteQuery}
          onPickResult={focusNoteNode}
          onClose={exitNoteSearchMode}
        />
      )}

      {/* route query panel: type a node name (or tap it on the canvas) to
          fill From/To; both ends set -> candidate routes sheet opens */}
      {routeMode && (
        <RoutePanel
          query={routeQuery}
          pickerField={routePickerField}
          suggestions={routeSuggestions}
          hasRoutes={routes.length > 0}
          onFocusField={setRoutePickerField}
          onChangeQuery={(field, t) => {
            setRouteQuery((q) => ({ ...q, [field]: t }));
            // edited text no longer matches the picked node
            if (field === "from") setRouteFromId(null);
            else setRouteToId(null);
            setRoutePickerField(field);
            setRoutes([]);
            setSelectedRouteIndex(null);
          }}
          onPickSuggestion={pickRouteNode}
          onSwap={swapRouteEnds}
          onShowRoutes={() => setSelectedRouteIndex(null)}
          onClose={exitRouteMode}
        />
      )}

      {/* candidate routes: pick one to focus it on the canvas */}
      <Modal
        visible={routeMode && routes.length > 0 && selectedRouteIndex === null}
        transparent
        animationType="fade"
        onRequestClose={() => setRoutes([])}
      >
        <View style={styles.formBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setRoutes([])}
          />
          <View style={styles.formSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.formTitle}>Routes</Text>
            {routes.map((r, i) => (
              <Pressable
                key={r.nodes.map((n) => n.id).join(">")}
                style={styles.routeCard}
                onPress={() => confirmRoute(i)}
              >
                <Text style={styles.routeCardTitle}>
                  Route {i + 1} · {r.edges.length}{" "}
                  {r.edges.length === 1 ? "step" : "steps"} · ~
                  {Math.round(r.length)} px
                </Text>
                <Text style={styles.routeCardPath} numberOfLines={2}>
                  {r.nodes.map((n) => n.title).join(" → ")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      {/* inspector: edit the node's info. Status buttons act at
          once through run(); text edits stay local until Save */}
      {inspectorNodeId &&
        (() => {
          const node = findDomainNode(map, inspectorNodeId);
          if (!node) return null;
          return (
            <>
              <Pressable
                style={styles.menuBackdrop}
                onPress={() => setInspectorNodeId(null)}
              />
              <KeyboardAvoidingView
                style={styles.inspectorWrap}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                pointerEvents="box-none"
              >
                <View style={styles.inspectorSheet}>
                  <Text style={styles.formTitle}>
                    {node.kind === "goal"
                      ? "Goal"
                      : node.kind === "task"
                        ? "Task"
                        : "Record"}
                  </Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="Title"
                    value={inspectorDraft.title}
                    onChangeText={(t) =>
                      setInspectorDraft((d) => ({ ...d, title: t }))
                    }
                  />
                  {!isTaskNode(node) && (
                    <TextInput
                      style={[styles.formInput, styles.formInputMultiline]}
                      placeholder={
                        isGoalNode(node)
                          ? "Description (optional)"
                          : "Note (optional)"
                      }
                      value={inspectorDraft.detail}
                      onChangeText={(t) =>
                        setInspectorDraft((d) => ({ ...d, detail: t }))
                      }
                      multiline
                    />
                  )}

                  {/* status: tasks step through the state machine, goals
                      only toggle the manual override (their status is
                      derived from tasks, never stored) */}
                  {isTaskNode(node) && (
                    <View style={styles.inspectorStatusRow}>
                      <Text style={styles.inspectorStatusText}>
                        Status: {node.status}
                      </Text>
                      {node.status === "todo" && (
                        <>
                          <SheetButton
                            label="Start"
                            onPress={() => run(() => startTask(node))}
                          />
                          <SheetButton
                            label="Mark done"
                            onPress={() => run(() => completeTask(node))}
                          />
                        </>
                      )}
                      {node.status === "in-progress" && (
                        <>
                          <SheetButton
                            label="Pause"
                            onPress={() => run(() => pauseTask(node))}
                          />
                          <SheetButton
                            label="Complete"
                            onPress={() => run(() => completeTask(node))}
                          />
                        </>
                      )}
                      {node.status === "done" && (
                        <SheetButton
                          label="Reopen"
                          onPress={() => run(() => reopenTask(node))}
                        />
                      )}
                    </View>
                  )}
                  {isGoalNode(node) && (
                    <View style={styles.inspectorStatusRow}>
                      <Text style={styles.inspectorStatusText}>
                        Status: {goalStatus(node)}
                        {node.completedAt ? " (manual)" : ""}
                      </Text>
                      {node.completedAt ? (
                        <SheetButton
                          label="Reopen"
                          onPress={() => run(() => reopenGoal(node))}
                        />
                      ) : (
                        <SheetButton
                          label="Mark done"
                          onPress={() => run(() => completeGoal(node))}
                        />
                      )}
                    </View>
                  )}

                  {/* read-only timestamps */}
                  {isTaskNode(node) && (node.startedAt || node.completedAt) && (
                    <Text style={styles.inspectorMeta}>
                      {node.startedAt ? `Started ${fmtDate(node.startedAt)}` : ""}
                      {node.startedAt && node.completedAt ? "  ·  " : ""}
                      {node.completedAt ? `Done ${fmtDate(node.completedAt)}` : ""}
                    </Text>
                  )}
                  {isRecordNode(node) && (
                    <Text style={styles.inspectorMeta}>
                      Occurred {fmtDate(node.occuredAt)}
                    </Text>
                  )}

                  <View style={styles.formButtons}>
                    <Pressable
                      style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
                      onPress={() => setInspectorNodeId(null)}
                    >
                      <Text style={styles.formCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.formSave,
                        !inspectorDraft.title.trim() && styles.formSaveDisabled,
                        pressed && { opacity: 0.6 },
                      ]}
                      disabled={!inspectorDraft.title.trim()}
                      onPress={saveInspector}
                    >
                      <Text style={styles.formSaveText}>Save</Text>
                    </Pressable>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </>
          );
        })()}

      {/* create form: goal (title + description), task (title),
          record (title + note) */}
      <Modal
        visible={createTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateTarget(null)}
      >
        <KeyboardAvoidingView
          style={styles.formBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setCreateTarget(null)}
          />
          <View style={styles.formSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.formTitle}>
              {createTarget?.mode === "goal"
                ? "New goal"
                : createTarget?.mode === "task"
                  ? "New task"
                  : "New record"}
            </Text>
            <TextInput
              style={styles.formInput}
              placeholder="Title"
              value={draft.title}
              onChangeText={(t) => setDraft((d) => ({ ...d, title: t }))}
              autoFocus
            />
            {createTarget?.mode !== "task" && (
              <TextInput
                style={[styles.formInput, styles.formInputMultiline]}
                placeholder={
                  createTarget?.mode === "goal"
                    ? "Description (optional)"
                    : "Note (optional)"
                }
                value={draft.detail}
                onChangeText={(t) => setDraft((d) => ({ ...d, detail: t }))}
                multiline
              />
            )}
            <View style={styles.formButtons}>
              <Pressable
                style={({ pressed }) => [styles.formCancel, pressed && { opacity: 0.6 }]}
                onPress={() => setCreateTarget(null)}
              >
                <Text style={styles.formCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.formSave,
                  !draft.title.trim() && styles.formSaveDisabled,
                  pressed && { opacity: 0.6 },
                ]}
                disabled={!draft.title.trim()}
                onPress={saveCreate}
              >
                <Text style={styles.formSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // refined grayscale: kind rides on shape, status on outline style,
  // selection on border weight; tokens come from src/app/theme.ts
  container: {
    flex: 1,
    backgroundColor: CANVAS_BG,
  },
  node: {
    position: "absolute",
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#d4d4d9",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
    ...SHADOW.card,
  },
  nodeSelected: {
    borderColor: INK.primary,
    borderWidth: 2,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  },
  // long-pressed (armed) node lifts: a following movement drags it
  nodeArmed: {
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  nodePulsingBase: {
    borderColor: "transparent",
  },
  nodeTodo: {
    borderColor: INK.tertiary,
  },
  nodeTitleTodo: {
    color: INK.tertiary,
  },
  nodeTitleDone: {
    textDecorationLine: "line-through",
    opacity: 0.45,
  },
  nodeRecord: {
    borderColor: INK.tertiary,
    borderWidth: 1,
    backgroundColor: INK.subtle,
    padding: 2,
  },
  nodeTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: INK.primary,
    textAlign: "center",
  },
  nodeTitleRecord: {
    fontSize: 9,
    fontWeight: "500",
  },
  queryButton: {
    position: "absolute",
    right: 20,
    top: 56,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: INK.subtle,
    alignItems: "center",
    justifyContent: "center",
    ...SHADOW.floating,
  },
  fitButton: {
    position: "absolute",
    right: 20,
    top: 108, // below the query button
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: INK.subtle,
    alignItems: "center",
    justifyContent: "center",
    ...SHADOW.floating,
  },
  queryButtonText: {
    fontSize: 18,
    color: INK.primary,
  },
  noteResults: {
    maxHeight: 240,
  },
  noteSearchEmpty: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: INK.secondary,
  },
  noteSheetCount: {
    fontSize: 12,
    fontWeight: "500",
    color: INK.tertiary,
    marginTop: -6,
  },
  notesList: {
    maxHeight: 280,
  },
  noteRow: {
    borderWidth: 1,
    borderColor: INK.subtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    marginBottom: 8,
  },
  noteRowText: {
    fontSize: 14,
    color: INK.primary,
  },
  noteRowFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noteRowMeta: {
    flex: 1,
    fontSize: 12,
    color: INK.secondary,
  },
  routePanel: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: INK.subtle,
    padding: 8,
    ...SHADOW.floating,
  },
  routeFields: {
    flex: 1,
    gap: 4,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#e0e0e4",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  routeRowActive: {
    borderColor: INK.primary,
    borderWidth: 1.5,
  },
  routeRowLabel: {
    fontSize: 13,
    color: INK.secondary,
    fontWeight: "600",
    width: 36,
  },
  routeInput: {
    flex: 1,
    fontSize: 15,
    color: INK.primary,
    paddingVertical: 0,
  },
  routeSuggestion: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f2",
  },
  routeSuggestionText: {
    fontSize: 13,
    color: INK.primary,
  },
  routeSuggestionKind: {
    fontSize: 12,
    color: INK.tertiary,
  },
  routeIconButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  routeIconButtonText: {
    fontSize: 16,
    color: INK.primary,
    fontWeight: "600",
  },
  routeCard: {
    borderWidth: 1,
    borderColor: INK.subtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  routeCardTitle: {
    fontSize: 14,
    color: INK.primary,
    fontWeight: "600",
  },
  routeCardPath: {
    fontSize: 13,
    color: INK.secondary,
  },
  menuBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  formBackdrop: {
    flex: 1,
    backgroundColor: BACKDROP,
    justifyContent: "flex-end",
  },
  formSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 14,
  },
  formTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: INK.primary,
  },
  formInput: {
    borderWidth: 1,
    borderColor: "#e0e0e4",
    borderRadius: 12,
    backgroundColor: "#f7f7f5",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: INK.primary,
  },
  formInputMultiline: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  formButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  formCancel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  formCancelText: {
    color: INK.secondary,
    fontWeight: "600",
  },
  formSave: {
    backgroundColor: INK.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },
  formSaveDisabled: {
    opacity: 0.4,
  },
  formSaveText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  inspectorWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  inspectorSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: INK.subtle,
    padding: 24,
    gap: 14,
  },
  inspectorStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  inspectorStatusText: {
    fontSize: 14,
    color: INK.primary,
    fontWeight: "600",
  },
  inspectorButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: INK.primary,
  },
  inspectorButtonText: {
    fontSize: 13,
    color: INK.primary,
    fontWeight: "600",
  },
  inspectorMeta: {
    fontSize: 12,
    color: INK.secondary,
  },
  infoCard: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 100, // sits above the bottom row (add button)
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: INK.subtle,
    padding: 12,
    gap: 4,
    ...SHADOW.floating,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: INK.primary,
  },
  infoHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  infoClose: {
    fontSize: 14,
    fontWeight: "600",
    color: INK.secondary,
    padding: 2,
  },
  infoActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  infoMeta: {
    fontSize: 13,
    color: INK.secondary,
  },
  modeBanner: {
    position: "absolute",
    top: 110, // below the route panel row
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: "#2c2c2e",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    ...SHADOW.floating,
  },
  modeBannerText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  modeBannerAction: {
    color: "#d8d8dc",
    fontSize: 14,
    fontWeight: "600",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d8dade",
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: INK.primary,
    textAlign: "center",
  },
  sheetSubtitle: {
    fontSize: 12,
    fontWeight: "500",
    color: INK.tertiary,
    textAlign: "center",
    marginTop: -6,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  actionTile: {
    flexGrow: 1,
    flexBasis: "28%",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f4f4f6",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  actionTileDestructive: {
    backgroundColor: "#faf0ef",
  },
  actionTileIcon: {
    fontSize: 22,
  },
  actionTileLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#333333",
    textAlign: "center",
  },
  actionTileLabelDestructive: {
    color: "#b3402f",
  },
});
