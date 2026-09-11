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

// ---------- View models: plain data describing what to draw ----------
// The UI renders ONLY from these. It never renders domain objects directly.

interface NodeViewModel {
  id: string;
  x: number;
  y: number;
  title: string;
  kind: NodeKind;
  status?: Status;
}

interface EdgeViewModel {
  id: string;
  fromId: string;
  toId: string;
  layer: number;
  status: Status | null;
  bend?: { x: number; y: number };
}

interface MapViewModel {
  nodes: NodeViewModel[];
  edges: EdgeViewModel[];
}

// domain -> view model: walk the edges visible at the current layer,
// then the isolated nodes. LayerView.edges is exactly the set of visible
// edges (expanded edges are replaced by their children), so do NOT
// recurse into childrenEdges here — they are not visible until revealed.
function mapDomainToViewModel(layerView: LayerView): MapViewModel {
  console.log("[FLOW]   render step 2: converting domain -> view models");
  const nodes = new Map<string, NodeViewModel>();
  const edges: EdgeViewModel[] = [];

  for (const e of layerView.edges) {
    edges.push({ id: e.id, fromId: e.node1.id, toId: e.node2.id, layer: e.layer, status: edgeStatus(e), bend: e.bend });
    for (const n of [e.node1, e.node2]) {
      if (!nodes.has(n.id)) {
        nodes.set(n.id, { id: n.id, x: n.x, y: n.y, title: n.title, kind: n.kind, status: nodeStatus(n) ?? undefined });
      }
    }
  }

  for (const n of layerView.map.rootNodes) {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, { id: n.id, x: n.x, y: n.y, title: n.title, kind: n.kind, status: nodeStatus(n) ?? undefined });
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
// how far one arrow-pad press moves the viewport, in screen pixels
const PAN_STEP = 80;

// long-press on empty canvas = create a goal there; long-press on a node or
// edge arms it for dragging (move the node / place the edge's bend point)
const LONG_PRESS_MS = 500;

// two taps on the same target within this window = double tap
const DOUBLE_TAP_MS = 300;

// what the create form is making: a free goal at a world position, a node
// attached under a parent node (create + connect), or — the "Be added to"
// direction — a new node that becomes the PARENT of an existing child
type CreateTarget =
  | { mode: "goal"; x: number; y: number }
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

const AnimatedLine = Animated.createAnimatedComponent(Line);
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
function MarchingLine(props: { x1: number; y1: number; x2: number; y2: number; color: string; width: number }) {
  const offset = useSharedValue(0);
  useEffect(() => {
    // dash period of "2 8" is 10, so -10 loops seamlessly; negative moves
    // the pattern toward (x2, y2)
    offset.value = withRepeat(withTiming(-10, { duration: 800, easing: Easing.linear }), -1, false);
  }, [offset]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  return (
    <AnimatedLine
      x1={props.x1}
      y1={props.y1}
      x2={props.x2}
      y2={props.y2}
      stroke={props.color}
      strokeWidth={props.width}
      strokeDasharray="2 8"
      animatedProps={animatedProps}
    />
  );
}

// marching variant for bent edges (from -> bend -> to)
function MarchingPolyline(props: { points: string; color: string; width: number }) {
  const offset = useSharedValue(0);
  useEffect(() => {
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

// read-only peek card for a single tap: title plus a few fact lines.
// pointerEvents="none" so canvas touches pass through and dismiss it.
function InfoCard(props: { title: string; lines: string[] }) {
  return (
    <View style={styles.infoCard} pointerEvents="none">
      <Text style={styles.infoTitle}>{props.title}</Text>
      {props.lines.map((l, i) => (
        <Text key={i} style={styles.infoMeta}>
          {l}
        </Text>
      ))}
    </View>
  );
}

// bottom sheet of mutation actions for a node or edge (double-tap target).
// Actions render as a wrap grid of icon tiles, destructive ones tinted red.
interface SheetAction {
  label: string;
  icon: string;
  destructive?: boolean;
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
                style={[styles.actionTile, a.destructive && styles.actionTileDestructive]}
                onPress={a.onPress}
              >
                <Text style={styles.actionTileIcon}>{a.icon}</Text>
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

// one node on the canvas: tap shows info / double-tap opens its sheet
// (handled by the parent), long-press arms it so a following movement
// becomes a drag that repositions it in the domain
function DraggableNode(props: {
  n: NodeViewModel;
  screenX: number;
  screenY: number;
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
  const size = nodeSize(props.n.kind);
  const borderRadius = props.n.kind === "task" ? 12 : size / 2;
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
        const { n, onDragMove } = latest.current;
        onDragMove(n.id, dragOrigin.current.x + g.dx, dragOrigin.current.y + g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        const { n, onDragEnd } = latest.current;
        onDragEnd(n.id, dragOrigin.current.x + g.dx, dragOrigin.current.y + g.dy);
      },
      onPanResponderTerminate: (_e, g) => {
        const { n, onDragEnd } = latest.current;
        onDragEnd(n.id, dragOrigin.current.x + g.dx, dragOrigin.current.y + g.dy);
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
        style={[
          styles.node,
          {
            width: size,
            height: size,
            borderRadius,
            borderStyle: props.borderStyle,
          },
          props.n.kind === "record" && styles.nodeRecord,
          // the pulsing ring draws the border; keep the base invisible
          props.pulsing && styles.nodePulsingBase,
          props.selected && styles.nodeSelected,
          props.armed && styles.nodeArmed,
        ]}
      >
        <Text
          style={[
            styles.nodeTitle,
            props.n.kind === "record" && styles.nodeTitleRecord,
            props.n.status === "done" && styles.nodeTitleDone,
          ]}
        >
          {props.n.title}
        </Text>
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
  const mapRef = useRef<LifeMap | null>(null);
  const layerViewRef = useRef<LayerView | null>(null);
  if (mapRef.current === null) {
    mapRef.current = createDemoMap(width / 2, height / 3);
    layerViewRef.current = new LayerView(mapRef.current);
  }
  const map = mapRef.current;
  const layerView = layerViewRef.current!;

  // Every domain change goes through run(): mutate, re-sync the layer
  // view, then bump state so React re-renders from fresh view models.
  const [, setVersion] = useState(0);
  const run = (mutate: (m: LifeMap) => void) => {
    console.log("[FLOW] event -> mutating domain now");
    mutate(map);
    layerView.refresh(layerView.forwardSteps);
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
  };
  // the pan responder is created once; it reaches the latest closer via ref
  const closeOverlaysRef = useRef(closeOverlays);
  closeOverlaysRef.current = closeOverlays;

  // Layer changes touch only the view, not the domain.
  const showMoreDetail = () => {
    layerView.nextLayer();
    setSelectedEdgeIds([]); // the selected edges may no longer be visible
    setSummarizeMode(false);
    setConnectSourceId(null);
    setConnectTargetId(null);
    setKindPicker(null);
    setBendDrag(null);
    setDragArmedId(null);
    closeOverlays();
    clearRouteState(); // routes were computed over the old visible edges
    setVersion((v) => v + 1);
  };
  const showLessDetail = () => {
    layerView.prevLayer();
    setSelectedEdgeIds([]);
    setSummarizeMode(false);
    setConnectSourceId(null);
    setConnectTargetId(null);
    setKindPicker(null);
    setBendDrag(null);
    setDragArmedId(null);
    closeOverlays();
    clearRouteState();
    setVersion((v) => v + 1);
  };

  // respect the OS reduce-motion setting: pulse/march fall back to static outlines
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  // creation flow: what the form is making
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [draft, setDraft] = useState({ title: "", detail: "" });

  // inspector flow: which node's panel is open, and its editable text.
  // Status buttons act immediately; title/description/note wait for Save.
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [inspectorDraft, setInspectorDraft] = useState({ title: "", detail: "" });

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
    setRouteMode(true);
  };

  const exitRouteMode = () => {
    clearRouteState();
    setRouteMode(false);
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
  // the renderer highlights its edges and dims everything else
  const confirmRoute = (index: number) => {
    const route = routes[index];
    if (!route) return;
    setSelectedRouteIndex(index);
    const xs = route.nodes.map((n) => n.x);
    const ys = route.nodes.map((n) => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    setViewport({ x: width / 2 - cx, y: height / 2 - cy });
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

  // Viewport = the camera. Domain coordinates never change when panning;
  // screen position = world position + viewport offset. The offset lives
  // in state so every pan re-renders from the same view models.
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const panStart = useRef({ x: 0, y: 0 });
  // whether the current touch has moved past the tap threshold
  const panMoved = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // long-press on empty canvas opens the goal form at that point
  // (world position = screen position - viewport offset)
  const openGoalFormAt = (screenX: number, screenY: number) => {
    closeOverlays();
    setDraft({ title: "", detail: "" });
    setCreateTarget({
      mode: "goal",
      x: screenX - viewportRef.current.x,
      y: screenY - viewportRef.current.y,
    });
  };

  // The container claims empty-space touches immediately (node Pressables
  // still win on their own area) so it can start a long-press timer. Any
  // movement past the threshold cancels the timer and becomes a pan —
  // unless a bend drag is armed, in which case the drag moves the bend.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        panStart.current = viewportRef.current;
        panMoved.current = false;
        if (bendDragRef.current) return; // bend drag: no create-goal timer
        const { pageX, pageY } = e.nativeEvent;
        cancelLongPress();
        longPressTimer.current = setTimeout(
          () => openGoalFormAt(pageX, pageY),
          LONG_PRESS_MS,
        );
      },
      onPanResponderMove: (_e, g) => {
        const bd = bendDragRef.current;
        if (bd) {
          // bend drag: the bend point follows the finger (world coords)
          if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
            panMoved.current = true;
            setBendDrag({
              edgeId: bd.edgeId,
              x: g.moveX - viewportRef.current.x,
              y: g.moveY - viewportRef.current.y,
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
      // a touch that never moved is a tap on empty canvas: dismiss overlays;
      // a bend drag commits its bend point here if the finger moved
      onPanResponderRelease: () => {
        cancelLongPress();
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
        }
      },
      onPanResponderTerminate: () => {
        cancelLongPress();
        setBendDrag(null);
      },
    }),
  ).current;

  // the arrow pad pans by a fixed step; dx/dy shift the visible content
  const panBy = (dx: number, dy: number) =>
    setViewport((v) => ({ x: v.x + dx, y: v.y + dy }));

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
  // the dragged node renders at its live drag position, so edges follow it
  const posById = new Map(
    vm.nodes.map((n) => [
      n.id,
      drag && drag.id === n.id ? { ...n, x: drag.x, y: drag.y } : n,
    ]),
  );
  console.log(
    `[FLOW]   render step 3: drawing ${vm.nodes.length} nodes, ${vm.edges.length} edges, layer ${layerView.forwardSteps}`,
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
    console.log("[FLOW] tap -> edge info card (UI state only)");
    setSheetNodeId(null);
    setSheetEdgeId(null);
    setInfoTarget({ kind: "edge", id });
  };

  const onEdgeDoubleTap = (id: string) => {
    console.log("[FLOW] double tap -> edge action sheet (UI state only)");
    setInfoTarget(null);
    setSheetNodeId(null);
    setSheetEdgeId(id);
  };

  const onEdgePress = (id: string) => {
    if (routeMode || connectSourceId || connectTargetId || bendDrag) return;
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
    if (routeMode || summarizeMode || connectSourceId || connectTargetId) return;
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

  // the + button is a fallback for the canvas long-press: same form,
  // placed at the center of the current viewport
  const addGoal = () => openGoalFormAt(width / 2, height / 2);

  // long-press a node arms it for dragging; a following movement becomes
  // the drag (see DraggableNode's armed pan responder)
  const onNodeLongPress = (id: string) => {
    if (routeMode || connectSourceId || connectTargetId) return;
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
    } else if (createTarget.mode === "goal" && !("parentId" in createTarget)) {
      run((m) =>
        m.addNode(
          new Goal(createTarget.x, createTarget.y, title, [], [], detail || undefined),
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
    // expand = drill into this edge: navigate the view to the layer
    // where the new children live (edge.layer + 1). A visible edge can
    // be shallower than the view's bottom (e.g. a layer-0 edge shown at
    // the layer-3 view), in which case the view comes back UP to the
    // children's layer — that is the navigation.
    const targetLayer = edge.layer + 1;
    run((m) => {
      m.expand(edge);
      placeSubNode(edge, -40); // offset so the bend is visible
    });
    layerView.refresh(targetLayer);
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

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <Svg style={StyleSheet.absoluteFill}>
        {/* the whole edge layer shifts with the viewport */}
        <G transform={`translate(${viewport.x}, ${viewport.y})`}>
          {vm.edges.map((e) => {
          const a = posById.get(e.fromId);
          const b = posById.get(e.toId);
          if (!a || !b) return null;
          const selected =
            selectedEdgeIds.includes(e.id) ||
            (infoTarget?.kind === "edge" && infoTarget.id === e.id);
          const onRoute = routeEdgeIds.has(e.id);
          const dimmed = routeFocusOn && !onRoute;
          const color = onRoute ? "#1a73e8" : selected ? "#333333" : "#9aa5b1";
          const edgeWidth = onRoute || selected ? 4 : Math.max(1.5, 3 - e.layer);
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
          const wing = 6;
          const back = 12;
          const baseX = tipX - ux * back;
          const baseY = tipY - uy * back;
          const arrowPoints = `${tipX},${tipY} ${baseX - uy * wing},${baseY + ux * wing} ${baseX + uy * wing},${baseY - ux * wing}`;
          const dash =
            e.status === "todo" ? "6 6" : e.status === "in-progress" ? "2 8" : undefined;
          const bentPoints = bend ? `${a.x},${a.y} ${bend.x},${bend.y} ${b.x},${b.y}` : "";
          return (
            <G key={e.id} opacity={dimmed ? 0.15 : 1}>
              {/* line style carries the edge's frontier status:
                  todo=dashed, in-progress=dotted marching toward the
                  target, done/records=solid */}
              {bend ? (
                e.status === "in-progress" && !reduceMotion ? (
                  <MarchingPolyline points={bentPoints} color={color} width={edgeWidth} />
                ) : (
                  <Polyline
                    points={bentPoints}
                    fill="none"
                    stroke={color}
                    strokeWidth={edgeWidth}
                    strokeDasharray={dash}
                  />
                )
              ) : e.status === "in-progress" && !reduceMotion ? (
                <MarchingLine
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  color={color}
                  width={edgeWidth}
                />
              ) : (
                <Line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeWidth={edgeWidth}
                  strokeDasharray={dash}
                />
              )}
              <Polygon points={arrowPoints} fill={color} />
              {/* wide invisible hit area so thin lines are tappable */}
              {bend ? (
                <Polyline
                  points={bentPoints}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={24}
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
                  onPress={() => onEdgePress(e.id)}
                  onLongPress={() => onEdgeLongPress(e.id)}
                />
              )}
              {/* bend handle: visible while a bend drag is armed */}
              {bendDrag && bendDrag.edgeId === e.id && (
                <Circle
                  cx={bendDrag.x}
                  cy={bendDrag.y}
                  r={10}
                  fill="#ffffff"
                  stroke="#333333"
                  strokeWidth={2}
                />
              )}
            </G>
          );
          })}
        </G>
      </Svg>

      {vm.nodes.map((n) => {
        const size = nodeSize(n.kind);
        const borderRadius = n.kind === "task" ? 12 : size / 2;
        const pulsing = n.status === "in-progress" && !reduceMotion;
        // outline style carries status: todo=dashed, in-progress=dotted
        // (breathing ring when motion is allowed), done=solid
        const borderStyle: "dashed" | "dotted" | "solid" =
          n.status === "todo" ? "dashed" : n.status === "in-progress" ? "dotted" : "solid";
        // live position: the drag override while dragging, else the domain
        const pos = posById.get(n.id) ?? n;
        const nodeDimmed = routeFocusOn && !routeNodeIds.has(n.id);
        return (
        <Fragment key={n.id}>
          {pulsing && !nodeDimmed && (
            <PulsingRing
              x={pos.x + viewport.x}
              y={pos.y + viewport.y}
              size={size}
              borderRadius={borderRadius}
              color="#333333"
            />
          )}
        <DraggableNode
          n={n}
          screenX={pos.x + viewport.x}
          screenY={pos.y + viewport.y}
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

      <View style={styles.layerControls}>
        <Pressable style={styles.layerButton} onPress={showLessDetail}>
          <Text style={styles.layerButtonText}>-</Text>
        </Pressable>
        <Text style={styles.layerLabel}>Layer {layerView.forwardSteps}</Text>
        <Pressable style={styles.layerButton} onPress={showMoreDetail}>
          <Text style={styles.layerButtonText}>+</Text>
        </Pressable>
      </View>

      {/* arrow pad: button-driven viewport panning, same offset as drag */}
      <View style={styles.panPad}>
        <Pressable style={styles.panButton} onPress={() => panBy(0, PAN_STEP)}>
          <Text style={styles.panButtonText}>↑</Text>
        </Pressable>
        <View style={styles.panPadRow}>
          <Pressable style={styles.panButton} onPress={() => panBy(PAN_STEP, 0)}>
            <Text style={styles.panButtonText}>←</Text>
          </Pressable>
          <Pressable style={styles.panButton} onPress={() => panBy(-PAN_STEP, 0)}>
            <Text style={styles.panButtonText}>→</Text>
          </Pressable>
        </View>
        <Pressable style={styles.panButton} onPress={() => panBy(0, -PAN_STEP)}>
          <Text style={styles.panButtonText}>↓</Text>
        </Pressable>
      </View>

      <Pressable style={styles.addButton} onPress={addGoal}>
        <Text style={styles.addButtonText}>+ Add goal</Text>
      </Pressable>

      {!routeMode && (
        <Pressable style={styles.routeButton} onPress={enterRouteMode}>
          <Text style={styles.addButtonText}>Route</Text>
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
          return (
            <InfoCard
              title={`${edge.node1.title} → ${edge.node2.title}`}
              lines={lines}
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
                      style={styles.formCancel}
                      onPress={() => setInspectorNodeId(null)}
                    >
                      <Text style={styles.formCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.formSave,
                        !inspectorDraft.title.trim() && styles.formSaveDisabled,
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
                style={styles.formCancel}
                onPress={() => setCreateTarget(null)}
              >
                <Text style={styles.formCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.formSave,
                  !draft.title.trim() && styles.formSaveDisabled,
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
  // grayscale for now: the color channel is undecided — kind rides on
  // shape, status on outline style, selection on border weight
  container: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },
  node: {
    position: "absolute",
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#333333",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  nodeSelected: {
    borderColor: "#111111",
    borderWidth: 3,
    backgroundColor: "#e5e7eb",
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
  nodeTitleDone: {
    textDecorationLine: "line-through",
    color: "#666666",
  },
  nodeRecord: {
    borderColor: "#9aa5b1",
    borderWidth: 1,
    backgroundColor: "#e2e8f0",
    padding: 2,
  },
  nodeTitle: {
    fontSize: 12,
    textAlign: "center",
  },
  nodeTitleRecord: {
    fontSize: 8,
  },
  layerControls: {
    position: "absolute",
    left: 20,
    bottom: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#d0d7de",
  },
  layerButton: {
    paddingHorizontal: 8,
  },
  layerButtonText: {
    fontSize: 20,
    color: "#333333",
    fontWeight: "600",
  },
  layerLabel: {
    fontSize: 13,
    color: "#333333",
  },
  panPad: {
    position: "absolute",
    top: 60,
    left: 20,
    alignItems: "center",
    gap: 4,
  },
  panPadRow: {
    flexDirection: "row",
    gap: 36, // leaves room for the middle cell of the cross layout
  },
  panButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d0d7de",
    alignItems: "center",
    justifyContent: "center",
  },
  panButtonText: {
    fontSize: 16,
    color: "#333333",
    fontWeight: "600",
  },
  addButton: {
    position: "absolute",
    right: 20,
    bottom: 40,
    backgroundColor: "#333333",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
  },
  addButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  routeButton: {
    position: "absolute",
    right: 20,
    bottom: 92, // stacked above the add button
    backgroundColor: "#1a73e8",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
  },
  routePanel: {
    position: "absolute",
    top: 60,
    left: 76, // clears the arrow pad
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d0d7de",
    padding: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
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
    borderColor: "#d0d7de",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  routeRowActive: {
    borderColor: "#1a73e8",
    borderWidth: 2,
  },
  routeRowLabel: {
    fontSize: 13,
    color: "#666666",
    fontWeight: "600",
    width: 36,
  },
  routeInput: {
    flex: 1,
    fontSize: 14,
    color: "#333333",
    paddingVertical: 0,
  },
  routeSuggestion: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#eef1f4",
  },
  routeSuggestionText: {
    fontSize: 14,
    color: "#333333",
  },
  routeSuggestionKind: {
    fontSize: 12,
    color: "#9aa5b1",
  },
  routeIconButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  routeIconButtonText: {
    fontSize: 16,
    color: "#333333",
    fontWeight: "600",
  },
  routeCard: {
    borderWidth: 1,
    borderColor: "#d0d7de",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  routeCardTitle: {
    fontSize: 14,
    color: "#1a73e8",
    fontWeight: "600",
  },
  routeCardPath: {
    fontSize: 13,
    color: "#666666",
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
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "flex-end",
  },
  formSheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 12,
  },
  formTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#333333",
  },
  formInput: {
    borderWidth: 1,
    borderColor: "#d0d7de",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
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
    borderRadius: 20,
  },
  formCancelText: {
    color: "#666666",
    fontWeight: "600",
  },
  formSave: {
    backgroundColor: "#333333",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: "#d0d7de",
    padding: 20,
    gap: 12,
  },
  inspectorStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  inspectorStatusText: {
    fontSize: 14,
    color: "#333333",
    fontWeight: "600",
  },
  inspectorButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333333",
  },
  inspectorButtonText: {
    fontSize: 13,
    color: "#333333",
    fontWeight: "600",
  },
  inspectorMeta: {
    fontSize: 12,
    color: "#666666",
  },
  infoCard: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 100, // sits above the bottom row (layer controls / add button)
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d0d7de",
    padding: 12,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333333",
  },
  infoMeta: {
    fontSize: 13,
    color: "#666666",
  },
  modeBanner: {
    position: "absolute",
    top: 110, // below the route panel row
    left: 76, // clears the arrow pad
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: "#333333",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modeBannerText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  modeBannerAction: {
    color: "#9ecbff",
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
    fontSize: 16,
    fontWeight: "700",
    color: "#222222",
    textAlign: "center",
  },
  sheetSubtitle: {
    fontSize: 12,
    color: "#8a8f98",
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
    backgroundColor: "#f2f3f7",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  actionTileDestructive: {
    backgroundColor: "#fdeceb",
  },
  actionTileIcon: {
    fontSize: 20,
  },
  actionTileLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#333333",
    textAlign: "center",
  },
  actionTileLabelDestructive: {
    color: "#c0392b",
  },
});
