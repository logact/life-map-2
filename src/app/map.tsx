import { Fragment, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
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
import Svg, { G, Line, Polygon } from "react-native-svg";
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
import { edgeStatus, goalStatus, nodeStatus, Status, startTask, pauseTask, completeTask, completeGoal, reopenTask, reopenGoal } from "@/domain/status";

// ---------- View models: plain data describing what to draw ----------
// The UI renders ONLY from these. It never renders domain objects directly.


/**
 * TODO render the segement with different color 
 * 
 * 
 * 
 */
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
    edges.push({ id: e.id, fromId: e.node1.id, toId: e.node2.id, layer: e.layer, status: edgeStatus(e) });
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

// long-press = "create something here": on empty canvas a goal, on a
// node something attached to it
const LONG_PRESS_MS = 500;

// what the create form is making: a free goal at a world position, or a
// task/record attached to a parent node
type CreateTarget =
  | { mode: "goal"; x: number; y: number }
  | { mode: "task" | "record"; parentId: string };

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

// small outlined pill used for the inspector's status actions
function SheetButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.inspectorButton} onPress={props.onPress}>
      <Text style={styles.inspectorButtonText}>{props.label}</Text>
    </Pressable>
  );
}

// one node on the canvas: tap selects, long-press opens its menu, and a
// move past the threshold becomes a drag that repositions it in the domain
function DraggableNode(props: {
  n: NodeViewModel;
  screenX: number;
  screenY: number;
  selected: boolean;
  pulsing: boolean;
  borderStyle: "dashed" | "dotted" | "solid";
  onPress: (id: string) => void;
  onLongPress: (id: string) => void;
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
      // the Pressable owns the touch at first; claim it only once the
      // finger has moved enough that this is a drag, not a tap/long-press
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
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
      }}
    >
      <Pressable
        onPress={() => props.onPress(props.n.id)}
        onLongPress={() => props.onLongPress(props.n.id)}
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

  // Layer changes touch only the view, not the domain.
  const showMoreDetail = () => {
    layerView.nextLayer();
    setSelectedEdgeIds([]); // the selected edges may no longer be visible
    setVersion((v) => v + 1);
  };
  const showLessDetail = () => {
    layerView.prevLayer();
    setSelectedEdgeIds([]);
    setVersion((v) => v + 1);
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

  // respect the OS reduce-motion setting: pulse/march fall back to static outlines
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  // creation flow: which node's menu is open, and what the form is making
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [draft, setDraft] = useState({ title: "", detail: "" });

  // inspector flow: which node's panel is open, and its editable text.
  // Status buttons act immediately; title/description/note wait for Save.
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [inspectorDraft, setInspectorDraft] = useState({ title: "", detail: "" });

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
    setSelectedId(null);
    setMenuNodeId(null);
    setInspectorNodeId(null);
    setDraft({ title: "", detail: "" });
    setCreateTarget({
      mode: "goal",
      x: screenX - viewportRef.current.x,
      y: screenY - viewportRef.current.y,
    });
  };

  // The container claims empty-space touches immediately (node Pressables
  // still win on their own area) so it can start a long-press timer. Any
  // movement past the threshold cancels the timer and becomes a pan.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        panStart.current = viewportRef.current;
        panMoved.current = false;
        const { pageX, pageY } = e.nativeEvent;
        cancelLongPress();
        longPressTimer.current = setTimeout(
          () => openGoalFormAt(pageX, pageY),
          LONG_PRESS_MS,
        );
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
          panMoved.current = true;
          cancelLongPress();
          setMenuNodeId(null);
          setInspectorNodeId(null);
          setViewport({
            x: panStart.current.x + g.dx,
            y: panStart.current.y + g.dy,
          });
        }
      },
      // a touch that never moved is a tap on empty canvas: deselect
      onPanResponderRelease: () => {
        cancelLongPress();
        if (!panMoved.current) setSelectedId(null);
      },
      onPanResponderTerminate: cancelLongPress,
    }),
  ).current;

  // the arrow pad pans by a fixed step; dx/dy shift the visible content
  const panBy = (dx: number, dy: number) =>
    setViewport((v) => ({ x: v.x + dx, y: v.y + dy }));

  // node drag = "reposition one node": the live position is UI state so
  // the node and its edges follow the finger, then on release the new
  // world position is committed to the domain through run()
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const onNodeDragStart = (id: string, x: number, y: number) => {
    setSelectedId(null);
    setMenuNodeId(null);
    setInspectorNodeId(null);
    setDrag({ id, x, y });
  };
  const onNodeDragMove = (id: string, x: number, y: number) => setDrag({ id, x, y });
  const onNodeDragEnd = (id: string, x: number, y: number) => {
    setDrag(null);
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

  // tap a selected node again -> open its inspector to edit title/status.
  // Selection is cleared so a later tap can't fire a surprise connect.
  const openInspector = (id: string) => {
    const node = findDomainNode(map, id);
    if (!node) return;
    setSelectedId(null);
    setMenuNodeId(null);
    setInspectorDraft({
      title: node.title,
      detail: isGoalNode(node)
        ? node.description ?? ""
        : isRecordNode(node)
          ? node.note
          : "",
    });
    setInspectorNodeId(id);
  };

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

  const onNodePress = (id: string) => {
    if (selectedId === null) {
      console.log("[FLOW] tap -> select node (UI state only)");
      setSelectedId(id); // first tap: select
      return;
    }
    if (selectedId === id) {
      openInspector(id); // tap same node: open its inspector
      return;
    }
    // second tap on another node: connect them in the domain
    console.log("[FLOW] tap -> connect two nodes (goes through run())");
    const from = findDomainNode(map, selectedId);
    const to = findDomainNode(map, id);
    if (from && to) {
      run((m) => m.addEdge(from, to));
    }
    setSelectedId(null);
  };

  // the + button is a fallback for the canvas long-press: same form,
  // placed at the center of the current viewport
  const addGoal = () => openGoalFormAt(width / 2, height / 2);

  // long-press a node -> menu of things that can attach to it.
  // Records are leaves, so they get no menu. Cancels any pending
  // tap-to-connect selection so it can't fire by surprise later.
  const onNodeLongPress = (id: string) => {
    const node = findDomainNode(map, id);
    if (!node || node.kind === "record") return;
    setSelectedId(null);
    setInspectorNodeId(null);
    setMenuNodeId(id);
  };

  const startCreate = (mode: "task" | "record", parentId: string) => {
    setMenuNodeId(null);
    setInspectorNodeId(null);
    setDraft({ title: "", detail: "" });
    setCreateTarget({ mode, parentId });
  };

  // cycle a task through the status machine: todo -> in-progress -> done -> todo
  const advanceTaskStatus = (id: string) => {
    setMenuNodeId(null);
    const node = findDomainNode(map, id);
    if (!node || !isTaskNode(node)) return;
    run(() => {
      if (node.status === "todo") startTask(node);
      else if (node.status === "in-progress") completeTask(node);
      else reopenTask(node);
    });
  };

  const saveCreate = () => {
    if (!createTarget) return;
    const title = draft.title.trim();
    if (!title) return;
    const detail = draft.detail.trim();

    console.log("[FLOW] create form -> save (goes through run())");
    if (createTarget.mode === "goal") {
      run((m) =>
        m.addNode(
          new Goal(createTarget.x, createTarget.y, title, [], [], detail || undefined),
        ),
      );
    } else {
      const parent = findDomainNode(map, createTarget.parentId);
      if (!parent) return;
      // fan children around the parent; index from existing links so
      // repeated adds don't stack nodes on top of each other
      const index = parent.startEdges.length + parent.endEdges.length;
      const pos = childPosition(parent, index);
      run((m) => {
        if (createTarget.mode === "task") {
          m.addTask(parent as Goal, new Task(pos.x, pos.y, title, [], []));
        } else {
          m.attachRecord(
            parent,
            new RecordNode(pos.x, pos.y, title, [], [], detail, new Date()),
          );
        }
      });
    }
    setCreateTarget(null);
  };

  // edge tap toggles selection (UI state only); the domain mutation
  // happens later via the Expand / Summarize buttons
  const onEdgePress = (id: string) => {
    setSelectedEdgeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const expandSelected = () => {
    const edge = layerView.edges.find((e) => e.id === selectedEdgeIds[0]);
    if (!edge) return;
    console.log("[FLOW] tap -> expand edge (goes through run())");
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

    console.log("[FLOW] tap -> summarize edges (goes through run())");
    run((m) => m.summarize(boundary[0], boundary[1], edges));
    setSelectedEdgeIds([]);
  };

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <Svg style={StyleSheet.absoluteFill}>
        {/* the whole edge layer shifts with the viewport */}
        <G transform={`translate(${viewport.x}, ${viewport.y})`}>
          {vm.edges.map((e) => {
          const a = posById.get(e.fromId);
          const b = posById.get(e.toId);
          if (!a || !b) return null;
          const selected = selectedEdgeIds.includes(e.id);
          const color = selected ? "#333333" : "#9aa5b1";
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          // arrowhead at the target node's edge, pointing into it
          const ux = len > 0 ? dx / len : 0;
          const uy = len > 0 ? dy / len : 0;
          const tipX = b.x - ux * (nodeSize(b.kind) / 2);
          const tipY = b.y - uy * (nodeSize(b.kind) / 2);
          const wing = 6;
          const back = 12;
          const baseX = tipX - ux * back;
          const baseY = tipY - uy * back;
          const arrowPoints = `${tipX},${tipY} ${baseX - uy * wing},${baseY + ux * wing} ${baseX + uy * wing},${baseY - ux * wing}`;
          return (
            <G key={e.id}>
              {/* line style carries the edge's frontier status:
                  todo=dashed, in-progress=dotted marching toward the
                  target, done/records=solid */}
              {e.status === "in-progress" && !reduceMotion ? (
                <MarchingLine
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  color={color}
                  width={selected ? 4 : Math.max(1.5, 3 - e.layer)}
                />
              ) : (
                <Line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeWidth={selected ? 4 : Math.max(1.5, 3 - e.layer)}
                  strokeDasharray={
                    e.status === "todo" ? "6 6" : e.status === "in-progress" ? "2 8" : undefined
                  }
                />
              )}
              <Polygon points={arrowPoints} fill={color} />
              {/* wide invisible hit area so thin lines are tappable */}
              <Line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={24}
                onPress={() => onEdgePress(e.id)}
              />
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
        return (
        <Fragment key={n.id}>
          {pulsing && (
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
          selected={n.id === selectedId}
          pulsing={pulsing}
          borderStyle={borderStyle}
          onPress={onNodePress}
          onLongPress={onNodeLongPress}
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

      {selectedEdgeIds.length > 0 && (
        <View style={styles.edgeControls} pointerEvents="box-none">
          <Pressable
            style={[
              styles.edgeButton,
              selectedEdgeIds.length !== 1 && styles.edgeButtonDisabled,
            ]}
            disabled={selectedEdgeIds.length !== 1}
            onPress={expandSelected}
          >
            <Text style={styles.edgeButtonText}>Expand</Text>
          </Pressable>
          <Pressable
            style={[
              styles.edgeButton,
              selectedEdgeIds.length < 2 && styles.edgeButtonDisabled,
            ]}
            disabled={selectedEdgeIds.length < 2}
            onPress={summarizeSelected}
          >
            <Text style={styles.edgeButtonText}>Summarize</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={styles.addButton} onPress={addGoal}>
        <Text style={styles.addButtonText}>+ Add goal</Text>
      </Pressable>

      {/* long-press context menu: what can be attached to this node */}
      {menuNodeId &&
        (() => {
          const n = posById.get(menuNodeId);
          if (!n) return null;
          const size = nodeSize(n.kind);
          // prefer the right side of the node, flip left near the edge
          const menuWidth = 150;
          let left = n.x + viewport.x + size / 2 + 8;
          if (left + menuWidth > width) left = n.x + viewport.x - size / 2 - 8 - menuWidth;
          const top = Math.max(20, n.y + viewport.y - size / 2);
          return (
            <>
              <Pressable
                style={styles.menuBackdrop}
                onPress={() => setMenuNodeId(null)}
              />
              <View style={[styles.contextMenu, { left, top, width: menuWidth }]}>
                {n.kind === "goal" && (
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => startCreate("task", n.id)}
                  >
                    <Text style={styles.menuItemText}>Add task</Text>
                  </Pressable>
                )}
                {n.kind === "task" && (
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => advanceTaskStatus(n.id)}
                  >
                    <Text style={styles.menuItemText}>
                      {n.status === "todo"
                        ? "Start task"
                        : n.status === "in-progress"
                          ? "Complete task"
                          : "Reopen task"}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  style={styles.menuItem}
                  onPress={() => startCreate("record", n.id)}
                >
                  <Text style={styles.menuItemText}>Add record</Text>
                </Pressable>
              </View>
            </>
          );
        })()}

      {/* inspector: edit the tapped node's info. Status buttons act at
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
  edgeControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 100, // sits above the bottom row (layer controls / add button)
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  edgeButton: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#333333",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  edgeButtonDisabled: {
    opacity: 0.4,
  },
  edgeButtonText: {
    color: "#333333",
    fontWeight: "600",
  },
  addButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  menuBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  contextMenu: {
    position: "absolute",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d0d7de",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    overflow: "hidden",
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemText: {
    fontSize: 14,
    color: "#333333",
    fontWeight: "600",
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
});
