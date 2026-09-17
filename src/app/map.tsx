import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Circle, G } from "react-native-svg";

import {
  addChildNode,
  addFreeNode,
  addNote,
  addParentNode,
  connectNodes,
  expandEdge as expandEdgeCmd,
  pastePayload,
  Recipe,
  removeEdge,
  removeNode,
  renameNode,
  setEdgeBend,
  setEdgeColor,
  setNodeColor,
  summarizeEdges,
  updateNote,
} from "@/domain/commands";
import { ClipboardPayload, snapshotEdge, snapshotNode, snapshotRoad } from "@/domain/clipboard";
import { EdgeData, edgeDepth, NodeData } from "@/domain/doc";
import { visibleEdges } from "@/domain/visibility";
import { useDocStore } from "@/state/docStore";
import { computeFitView } from "@/app/fitZoom";
import { INK } from "@/app/theme";
import { EdgeGlyph } from "@/map/components/edgeGlyph";
import { CanvasNode } from "@/map/components/nodeGlyph";
import { NoteSearchPanel, RoutePanel } from "@/map/components/panels";
import { ModeBanner, SelectionBar } from "@/map/components/sheets";
import { DOUBLE_TAP_MS } from "@/map/constants";
import { useCanvasGestures } from "@/map/hooks/useCanvasGestures";
import { useMapCamera } from "@/map/hooks/useMapCamera";
import { useNodeDrag } from "@/map/hooks/useNodeDrag";
import { useNoteSearch } from "@/map/hooks/useNoteSearch";
import { useRouteQuery } from "@/map/hooks/useRouteQuery";
import { useZoomLens } from "@/map/hooks/useZoomLens";
import {
  ColorPickerSheet,
  EdgeActionSheet,
  FreeSpacePicker,
  KindPickerSheet,
  NodeActionSheet,
  RoadSheet,
  StatusPickerSheet,
} from "@/map/overlays/actionSheets";
import { CreateNodeForm, InspectorSheet } from "@/map/overlays/forms";
import { MapInfoCard } from "@/map/overlays/mapInfoCard";
import { NoteEditorSheet, NotesSheet } from "@/map/overlays/notes";
import { RoutesModal } from "@/map/overlays/routesModal";
import { styles } from "@/map/styles";
import { CreateTarget, InfoTarget } from "@/map/types";
import { childPosition, composedCam, computeGridDots } from "@/map/utils";
import { useMapViewModel } from "@/map/viewModel";

/**
 *
 * The map canvas
 * UI composition method using the absolute position to layout the item in the container.
 * container: View
 *  edges: SVG
 *  nodes: view
 *  control panle: view
 *
 * The screen is an orchestrator: it owns the interaction state and the
 * domain-wiring (run/undo/redo, tap routing, the create/connect/remove
 * flows), while the camera, the zoom lens, the route and note queries,
 * the node drag and the canvas gestures live in hooks under src/map/hooks,
 * and every drawn element and overlay is a component under src/map.
 *
 */
export default function MapScreen() {
  const { width, height } = useWindowDimensions();

  // The document lives in the store outside React; these subscriptions
  // re-render the screen when it changes. Gesture handlers and timers read
  // useDocStore.getState() instead, so no closure captures a stale doc.
  const doc = useDocStore((s) => s.doc);
  const loaded = useDocStore((s) => s.loaded);
  const canUndo = useDocStore((s) => s.canUndo);
  const canRedo = useDocStore((s) => s.canRedo);

  // camera and lens come first: the view model, the queries and the
  // gestures below all read their refs
  const camera = useMapCamera(width, height);
  const { fitRef, baseFitRef, viewportRef, userScaleRef, setViewport } = camera;
  const lens = useZoomLens({ width, height, fitRef, viewportRef, userScaleRef, setViewport });
  const {
    zoomEdgeIds,
    setZoomEdgeIds,
    zoomedIds,
    setZoomedIds,
    zoomedIdsRef,
    zoomHistoryRef,
    selectionLocked,
    setSelectionLocked,
    selectionLockedRef,
    zoomSelectionStep,
  } = lens;

  // ---------- interaction state ----------
  // single tap -> read-only info card; double tap -> action sheet
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null);
  // node spotlight: a tapped or dragged node's directly-connected edges
  // (and their endpoints) light up while everything else dims. Purely
  // visual — the zoom selection is untouched
  const [nodeFocusId, setNodeFocusId] = useState<string | null>(null);
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
  // long-press on an edge arms bend-drag: the next canvas drag places the
  // edge's bend point (live position kept here, committed on release)
  const [bendDrag, setBendDrag] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const bendDragRef = useRef(bendDrag);
  useLayoutEffect(() => {
    bendDragRef.current = bendDrag;
  });
  // clipboard: the last copied node/edge/road as a plain-data snapshot;
  // paste recreates it with fresh ids at the tapped canvas point
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  // road sheet: long-press on the selection bar with a multi-edge
  // selection offers copying the road or editing its route query
  const [roadSheetOpen, setRoadSheetOpen] = useState(false);
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
  // pending empty-canvas double tap: the kind picker opens at this world
  // position (a Paste tile joins when the clipboard is non-empty)
  const [freeSpacePicker, setFreeSpacePicker] = useState<{ x: number; y: number } | null>(null);

  const closeOverlays = () => {
    setInfoTarget(null);
    setNodeFocusId(null);
    setSheetNodeId(null);
    setSheetEdgeId(null);
    setInspectorNodeId(null);
    setKindPicker(null);
    setStatusPickerNodeId(null);
    setColorPicker(null);
    setNotesNodeId(null);
    setNoteDraft(null);
  };

  // Every domain change goes through the store's run(). Afterwards, prune
  // the edge selection to edges still visible — an edit can hide or remove
  // selected edges (mirrors the old run()'s post-edit cleanup). Reads and
  // writes go through refs/setters only, so the once-created pan responder
  // can safely call this.
  const run = (recipe: Recipe) => {
    useDocStore.getState().run(recipe);
    const next = useDocStore.getState().doc;
    const visibleNow = new Set(visibleEdges(next, zoomedIdsRef.current).map((e) => e.id));
    setZoomEdgeIds((prev) => prev.filter((id) => visibleNow.has(id)));
  };

  // Undo/redo: patch-based history in the store. After a history jump,
  // prune lens/selection state pointing at edges the restored doc no longer
  // has and close overlays holding stale ids (the old applySnapshot did the
  // same against its rebuilt layer view).
  const pruneAfterHistoryJump = () => {
    const edges = useDocStore.getState().doc.edges;
    zoomHistoryRef.current = zoomHistoryRef.current
      .map((group) => group.filter((id) => edges[id]))
      .filter((group) => group.length > 0);
    const nextZoom = new Set([...zoomedIdsRef.current].filter((id) => edges[id]));
    zoomedIdsRef.current = nextZoom;
    setZoomedIds(nextZoom);
    setZoomEdgeIds((prev) => prev.filter((id) => edges[id]));
    closeOverlays();
  };

  const undo = () => {
    const store = useDocStore.getState();
    if (!store.canUndo) return;
    store.undo();
    pruneAfterHistoryJump();
  };

  const redo = () => {
    const store = useDocStore.getState();
    if (!store.canRedo) return;
    store.redo();
    pruneAfterHistoryJump();
  };

  // domain -> UI: the visible frontier at the current lens, then plain
  // view models derived from it (memoized on [doc, zoomedIds])
  const { visible, vm } = useMapViewModel(doc, zoomedIds);

  // camera: the fit-zoom (recomputed from the visible nodes so a crowded
  // view shrinks into view) with the user's pinch zoom composed on top;
  // the refs feed the once-created pan responder, synced on every commit
  const fit = computeFitView(vm.nodes, { width, height });
  const cam = composedCam(fit, camera.userScale, { width, height });
  useLayoutEffect(() => {
    baseFitRef.current = fit;
    fitRef.current = cam;
  });
  // nodes render as map pins: pinch zoom spreads the ground beneath them
  // but never grows them past their fit size, so zooming in adds room
  // instead of crowding the map
  const pinScale = fit.scale * Math.min(1, camera.userScale);

  const noteSearch = useNoteSearch({
    doc,
    width,
    height,
    userScaleRef,
    setViewport,
    zoomedIdsRef,
    setZoomedIds,
    setInfoTarget,
  });
  const routeQuery = useRouteQuery({
    doc,
    visible,
    cam,
    width,
    height,
    setViewport,
    setZoomEdgeIds,
  });
  const nodeDrag = useNodeDrag({ run, closeOverlays, setNodeFocusId });
  const { drag, dragArmedId, setDragArmedId } = nodeDrag;

  // tear down every canvas mode that retargets taps/drags; entering the
  // route or note query starts from this clean slate
  const resetCanvasModes = () => {
    setSelectedEdgeIds([]);
    setSummarizeMode(false);
    setConnectSourceId(null);
    setConnectTargetId(null);
    setKindPicker(null);
    setBendDrag(null);
    setDragArmedId(null);
    closeOverlays();
  };

  // modes are mutually exclusive: entering one tears the other down
  const enterRouteMode = () => {
    resetCanvasModes();
    noteSearch.exitNoteSearchMode();
    routeQuery.enterRouteMode();
  };

  // double tap on empty canvas opens a kind picker at that point; picking
  // a kind opens the create form there (world position = (screen position
  // - camera offset) / zoom)
  const openCreatePickerAt = (screenX: number, screenY: number) => {
    closeOverlays();
    setFreeSpacePicker({
      x: (screenX - viewportRef.current.x - fitRef.current.x) / fitRef.current.scale,
      y: (screenY - viewportRef.current.y - fitRef.current.y) / fitRef.current.scale,
    });
  };

  // single tap on empty canvas (after the double-tap window lapses):
  // dismiss overlays and clear the zoom selection (the lens) unless it is
  // locked, so the next pinch moves only the camera
  const onCanvasSingleTap = () => {
    setInfoTarget(null);
    setNodeFocusId(null);
    setDragArmedId(null);
    // a locked selection survives stray canvas taps
    if (!selectionLockedRef.current) setZoomEdgeIds([]);
  };

  const commitBend = (edgeId: string, bend: { x: number; y: number }) =>
    run(setEdgeBend(edgeId, bend));

  const { panResponder } = useCanvasGestures({
    viewportRef,
    fitRef,
    setViewport,
    pinchCameraZoom: camera.pinchCameraZoom,
    zoomSelectionStep,
    bendDragRef,
    setBendDrag,
    closeOverlays,
    openCreatePickerAt,
    onCanvasSingleTap,
    commitBend,
  });

  // respect the OS reduce-motion setting: pulse/march fall back to static outlines
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  // load the persisted map once on mount; the store seeds (and persists)
  // the demo map itself when the database is empty or unreadable
  useEffect(() => {
    useDocStore.getState().load({ width, height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- derived render state ----------

  // the zoom selection: pinch reveals/collapses detail on exactly these edges
  const zoomEdgeIdSet = new Set(zoomEdgeIds);
  // any active edge selection — a single-tapped edge or confirmed roads —
  // focuses the map the same way: selected edges render in INK.primary,
  // everything else dims (the bright endpoint nodes derive from vm below)
  const focusOn = zoomEdgeIds.length > 0;
  // endpoint nodes of selected edges stay bright; every other node dims
  const focusNodeIds = new Set(
    vm.edges.filter((e) => zoomEdgeIdSet.has(e.id)).flatMap((e) => [e.fromId, e.toId]),
  );
  // node spotlight: the focused node's directly-connected visible edges
  // and their endpoints stay bright; everything else dims. A node with no
  // visible edges (isolated, or collapsed away) turns no spotlight on
  const nodeFocusEdges = nodeFocusId
    ? vm.edges.filter((e) => e.fromId === nodeFocusId || e.toId === nodeFocusId)
    : [];
  const nodeFocusEdgeIds = new Set(nodeFocusEdges.map((e) => e.id));
  const nodeFocusNodeIds = new Set(nodeFocusEdges.flatMap((e) => [e.fromId, e.toId]));
  const nodeFocusOn = nodeFocusEdges.length > 0;
  // the dragged node renders at its live drag position, so edges follow it
  const posById = new Map(
    vm.nodes.map((n) => [
      n.id,
      drag && drag.id === n.id ? { ...n, x: drag.x, y: drag.y } : n,
    ]),
  );
  // node highlight: the connect source/target, the info-card node, or route focus
  const highlightedNodeId =
    connectSourceId ?? connectTargetId ?? (infoTarget?.kind === "node" ? infoTarget.id : null);

  // the selection bar's "From → To": the boundary nodes of the selected
  // visible edges — a road's two ends, or a single edge's own endpoints.
  // The ids ride along so a bar tap can prefill the route query
  const selectedVmEdges = vm.edges.filter((e) => zoomEdgeIdSet.has(e.id));
  let selectionEnds: { fromId: string; toId: string; from: string; to: string } | null = null;
  if (selectedVmEdges.length > 0) {
    const selFromIds = new Set(selectedVmEdges.map((e) => e.fromId));
    const selToIds = new Set(selectedVmEdges.map((e) => e.toId));
    const start = selectedVmEdges.find((e) => !selToIds.has(e.fromId)) ?? selectedVmEdges[0];
    const end = selectedVmEdges.find((e) => !selFromIds.has(e.toId)) ?? selectedVmEdges[0];
    selectionEnds = {
      fromId: start.fromId,
      toId: end.toId,
      from: posById.get(start.fromId)?.title ?? "",
      to: posById.get(end.toId)?.title ?? "",
    };
  }

  const cameraX = cam.x + camera.viewport.x;
  const cameraY = cam.y + camera.viewport.y;
  const gridDots = computeGridDots(cameraX, cameraY, cam.scale, width, height);

  // the edge open in the action sheet, with its endpoints resolved (an
  // edit can remove the edge out from under an open sheet)
  const sheetEdge = sheetEdgeId ? visible.find((e) => e.id === sheetEdgeId) : undefined;
  const sheetEdgeFrom = sheetEdge ? doc.nodes[sheetEdge.fromId] : undefined;
  const sheetEdgeTo = sheetEdge ? doc.nodes[sheetEdge.toId] : undefined;
  // the node whose note is being edited (same out-from-under case)
  const noteDraftNode = noteDraft ? doc.nodes[noteDraft.nodeId] : undefined;

  // ---------- selection bar handlers ----------

  // long-press on the selection bar opens the mutation UI: a single edge
  // gets its action sheet; a road gets a sheet offering to copy it or
  // re-open the route query panel (the confirmed query is kept, so the
  // panel comes back prefilled)
  const editSelection = () => {
    if (selectedVmEdges.length === 1) {
      setSheetEdgeId(selectedVmEdges[0].id);
    } else if (selectedVmEdges.length > 1) {
      setRoadSheetOpen(true);
    }
  };

  // tap on the selection bar: open the route query prefilled with the
  // selection's boundary nodes — the current road fills the search by
  // default — and search right away so the candidate roads preview
  const searchSelection = () => {
    if (!selectionEnds) return;
    setInfoTarget(null);
    setSheetEdgeId(null);
    setRoadSheetOpen(false);
    routeQuery.openWithSelection(selectionEnds);
  };

  const saveInspector = () => {
    if (!inspectorNodeId) return;
    const node = doc.nodes[inspectorNodeId];
    if (!node) return;
    const title = inspectorDraft.title.trim();
    if (!title) return;
    run(renameNode(node.id, title));
    setInspectorNodeId(null);
  };

  // the note editor replaced the notes sheet; every exit reopens it
  const closeNoteEditor = () => {
    if (!noteDraft) return;
    setNoteDraft(null);
    setNotesNodeId(noteDraft.nodeId);
  };

  const saveNote = () => {
    if (!noteDraft) return;
    if (noteDraft.noteId) {
      run(updateNote(noteDraft.nodeId, noteDraft.noteId, noteDraft.text));
    } else {
      run(addNote(noteDraft.nodeId, noteDraft.text).recipe);
    }
    closeNoteEditor();
  };

  // ---------- single/double tap routing ----------
  // A tap starts a timer: if a second tap on the same target lands within
  // DOUBLE_TAP_MS it becomes a double tap, otherwise the single-tap action
  // fires when the timer expires. A tap on a DIFFERENT target flushes the
  // pending one immediately so the info card stays responsive.
  const nodeTapRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const edgeTapRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const onNodeSingleTap = (id: string) => {
    setDragArmedId(null);
    setSheetNodeId(null);
    setSheetEdgeId(null);
    setInspectorNodeId(null);
    setInfoTarget({ kind: "node", id });
    // spotlight the node's directly-connected edges (visual only)
    setNodeFocusId(id);
    // nodes aren't zoomable; the edge lens clears unless it is locked
    if (!selectionLocked) setZoomEdgeIds([]);
  };

  const onNodeDoubleTap = (id: string) => {
    setInfoTarget(null);
    setSheetEdgeId(null);
    setSheetNodeId(id);
  };

  const onNodePress = (id: string) => {
    // route mode: taps only fill the From/To fields, never select/connect
    if (routeQuery.routeMode) {
      const field =
        routeQuery.routePickerField ??
        (routeQuery.routeFromId === null ? "from" : routeQuery.routeToId === null ? "to" : null);
      if (!field) return;
      const node = doc.nodes[id];
      routeQuery.pickRouteNode(field, id, node?.title ?? "");
      return;
    }
    // note search mode: results are picked in the panel, not on the canvas
    if (noteSearch.noteSearchMode) {
      Keyboard.dismiss();
      return;
    }
    if (bendDrag) return; // bend drag owns the canvas until released/cancelled
    // reverse connect mode: this tap picks the edge source; duplicates allowed
    if (connectTargetId) {
      if (id !== connectTargetId) {
        const d = useDocStore.getState().doc;
        if (d.nodes[id] && d.nodes[connectTargetId]) {
          run(connectNodes(id, connectTargetId).recipe);
        }
      }
      setConnectTargetId(null);
      return;
    }
    // connect mode: this tap picks the edge target; duplicates allowed
    if (connectSourceId) {
      if (id !== connectSourceId) {
        const d = useDocStore.getState().doc;
        if (d.nodes[connectSourceId] && d.nodes[id]) {
          run(connectNodes(connectSourceId, id).recipe);
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
    setSheetNodeId(null);
    setSheetEdgeId(null);
    setInfoTarget({ kind: "edge", id });
    setNodeFocusId(null); // the edge's own selection takes over the canvas
    setZoomEdgeIds([id]); // the tapped edge becomes the zoom selection
  };

  const onEdgeDoubleTap = (id: string) => {
    setInfoTarget(null);
    setSheetNodeId(null);
    setSheetEdgeId(id);
  };

  const onEdgePress = (id: string) => {
    if (routeQuery.routeMode || noteSearch.noteSearchMode || connectSourceId || connectTargetId || bendDrag) return;
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
    if (routeQuery.routeMode || noteSearch.noteSearchMode || summarizeMode || connectSourceId || connectTargetId) return;
    const edge = visible.find((e) => e.id === id);
    if (!edge) return;
    const from = doc.nodes[edge.fromId];
    const to = doc.nodes[edge.toId];
    if (!from || !to) return;
    setInfoTarget(null);
    setSheetEdgeId(null);
    const mid = edge.bend ?? {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    };
    setBendDrag({ edgeId: id, x: mid.x, y: mid.y });
  };

  // long-press a node arms it for dragging; a following movement becomes
  // the drag (see DraggableNode's armed pan responder)
  const onNodeLongPress = (id: string) => {
    if (routeQuery.routeMode || noteSearch.noteSearchMode || connectSourceId || connectTargetId) return;
    const node = useDocStore.getState().doc.nodes[id];
    if (!node) return;
    closeOverlays();
    setDragArmedId(id);
  };

  // ---------- create / connect / remove flows ----------

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

  const confirmRemoveNode = (node: NodeData) => {
    Alert.alert("Remove node", `Remove "${node.title}" and all its edges?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          run(removeNode(node.id));
          setSheetNodeId(null);
          setInfoTarget(null);
          if (connectSourceId === node.id) setConnectSourceId(null);
          if (connectTargetId === node.id) setConnectTargetId(null);
        },
      },
    ]);
  };

  const confirmRemoveEdge = (edge: EdgeData) => {
    const fromTitle = doc.nodes[edge.fromId]?.title ?? "";
    const toTitle = doc.nodes[edge.toId]?.title ?? "";
    Alert.alert("Remove edge", `Remove "${fromTitle} → ${toTitle}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          run(removeEdge(edge.id));
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
    run(
      colorPicker.kind === "node"
        ? setNodeColor(colorPicker.id, color)
        : setEdgeColor(colorPicker.id, color),
    );
    setColorPicker(null);
  };

  const saveCreate = () => {
    if (!createTarget) return;
    const title = draft.title.trim();
    if (!title) return;
    const detail = draft.detail.trim();

    // fan children around the anchor; index from existing links so
    // repeated adds don't stack nodes on top of each other
    const degree = (id: string) =>
      Object.values(doc.edges).filter((e) => e.fromId === id || e.toId === id).length;

    if ("childId" in createTarget) {
      // "Be added to": the new node becomes the PARENT of the current one
      const child = doc.nodes[createTarget.childId];
      if (!child) return;
      const pos = childPosition(child, degree(child.id));
      run(addParentNode(createTarget.childId, createTarget.mode, title, detail, pos).recipe);
    } else if ("x" in createTarget) {
      // free node at the double-tapped position
      run(
        addFreeNode(createTarget.mode, title, detail, { x: createTarget.x, y: createTarget.y })
          .recipe,
      );
    } else if ("parentId" in createTarget) {
      const parent = doc.nodes[createTarget.parentId];
      if (!parent) return;
      const pos = childPosition(parent, degree(parent.id));
      run(addChildNode(createTarget.parentId, createTarget.mode, title, detail, pos).recipe);
    }
    setCreateTarget(null);
  };

  // paste the clipboard snapshot centered on a tapped canvas point, then
  // highlight the pasted root edges (a pasted lone node clears the lens)
  const pasteClipboardAt = (x: number, y: number) => {
    if (!clipboard) return;
    const payload = clipboard;
    setFreeSpacePicker(null);
    const p = pastePayload(payload, { x, y });
    run(p.recipe);
    setZoomEdgeIds(p.rootEdgeIds);
  };

  const expandEdge = (edgeId: string) => {
    const edge = useDocStore.getState().doc.edges[edgeId];
    if (!edge) return;
    // expand is a DOMAIN edit (it creates a sub-node); zoom is the view
    // operation. Expanding zooms this edge open locally so the new
    // children show, without disturbing the rest of the map.
    if (edge.childEdgeIds.length > 0) {
      // already expanded: the command would no-op, so just zoom it open
      // and record the REAL child ids for the selection-less squeeze
      zoomHistoryRef.current.push(edge.childEdgeIds);
    } else {
      const ex = expandEdgeCmd(edgeId);
      run(ex.recipe);
      // sheet-expand bypasses zoomSelectionStep; record it so a
      // selection-less squeeze can undo this spread too
      zoomHistoryRef.current.push(ex.childEdgeIds);
    }
    const nextZoom = new Set(zoomedIdsRef.current).add(edgeId);
    zoomedIdsRef.current = nextZoom;
    setZoomedIds(nextZoom);
    setSelectedEdgeIds([]);
    setSheetEdgeId(null);
    setInfoTarget(null);
  };

  // summarize mode: the sheet's edge is pre-selected, further edge taps
  // extend the selection, Confirm runs the domain summarize
  const startSummarize = (edgeId: string) => {
    setSheetEdgeId(null);
    setInfoTarget(null);
    setZoomEdgeIds([]); // the summarize selection is its own state
    setSelectedEdgeIds([edgeId]);
    setSummarizeMode(true);
  };

  const cancelSummarize = () => {
    setSummarizeMode(false);
    setSelectedEdgeIds([]);
  };

  const summarizeSelected = () => {
    const edges = selectedEdgeIds
      .map((id) => doc.edges[id])
      .filter((e): e is EdgeData => !!e);
    if (edges.length < 2) return;

    const parentId = (e: EdgeData) => e.parentEdgeId ?? "";
    if (edges.some((e) => parentId(e) !== parentId(edges[0]))) {
      Alert.alert("Cannot summarize", "Selected edges must share the same parent.");
      return;
    }

    // endpoints of the summarized edge: the boundary nodes of the
    // selection, i.e. the nodes touched by exactly one selected edge
    const touched = new Map<string, number>();
    for (const e of edges) {
      touched.set(e.fromId, (touched.get(e.fromId) ?? 0) + 1);
      touched.set(e.toId, (touched.get(e.toId) ?? 0) + 1);
    }
    const boundaryCount = [...touched.values()].filter((c) => c === 1).length;
    if (boundaryCount < 2) {
      Alert.alert("Cannot summarize", "Selected edges need two open end nodes.");
      return;
    }

    // the command re-validates strictly: exactly two boundary nodes and a
    // single directed chain — anything else throws and nothing applies
    try {
      run(summarizeEdges(selectedEdgeIds).recipe);
    } catch (err) {
      Alert.alert("Cannot summarize", err instanceof Error ? err.message : "");
      return;
    }
    setSelectedEdgeIds([]);
    setSummarizeMode(false);
  };

  // render nothing until the persisted map (or the seeded demo map) is in
  // place, so gestures never mutate a map that is about to be replaced
  if (!loaded) {
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
            const onRoute = routeQuery.routeEdgeIds.has(e.id);
            const related = nodeFocusEdgeIds.has(e.id);
            const dimmed = nodeFocusOn ? !related : focusOn && !zoomEdgeIdSet.has(e.id);
            return (
              <EdgeGlyph
                key={e.id}
                e={e}
                a={a}
                b={b}
                selected={selected}
                onRoute={onRoute}
                related={related}
                dimmed={dimmed}
                liveBend={bendDrag && bendDrag.edgeId === e.id ? { x: bendDrag.x, y: bendDrag.y } : null}
                camScale={cam.scale}
                reduceMotion={reduceMotion}
                onPress={onEdgePress}
                onLongPress={onEdgeLongPress}
              />
            );
          })}
        </G>
      </Svg>

      {vm.nodes.map((n) => {
        const pos = posById.get(n.id) ?? n;
        const nodeDimmed = nodeFocusOn
          ? !nodeFocusNodeIds.has(n.id)
          : focusOn && !focusNodeIds.has(n.id);
        return (
          <CanvasNode
            key={n.id}
            n={n}
            pos={pos}
            pinScale={pinScale}
            camScale={cam.scale}
            cameraX={cameraX}
            cameraY={cameraY}
            reduceMotion={reduceMotion}
            selected={n.id === highlightedNodeId}
            dimmed={nodeDimmed}
            armed={dragArmedId === n.id}
            onPress={onNodePress}
            onArm={onNodeLongPress}
            onDragStart={nodeDrag.onNodeDragStart}
            onDragMove={nodeDrag.onNodeDragMove}
            onDragEnd={nodeDrag.onNodeDragEnd}
          />
        );
      })}

      {/* top row: with an active selection the selection bar shows the
          selected edge/road (start left, end right, the collapsed middle
          between them) and the query button is hidden; with no selection
          the query button stands alone */}
      {!routeQuery.routeMode &&
        !noteSearch.noteSearchMode &&
        (selectionEnds ? (
          <SelectionBar
            from={selectionEnds.from}
            to={selectionEnds.to}
            steps={selectedVmEdges.length}
            locked={selectionLocked}
            onPress={searchSelection}
            onToggleLock={() => setSelectionLocked((v) => !v)}
            onLongPress={editSelection}
          />
        ) : (
          <Pressable style={styles.queryButton} onPress={enterRouteMode}>
            <Text style={styles.queryButtonText}>🔍</Text>
          </Pressable>
        ))}

      {/* undo/redo: restore the document through the store's patch history */}
      {!routeQuery.routeMode && !noteSearch.noteSearchMode && (
        <>
          <Pressable
            style={[styles.undoButton, !canUndo && styles.historyButtonDisabled]}
            onPress={undo}
            disabled={!canUndo}
          >
            <Text style={styles.queryButtonText}>{"↩\uFE0E"}</Text>
          </Pressable>
          <Pressable
            style={[styles.redoButton, !canRedo && styles.historyButtonDisabled]}
            onPress={redo}
            disabled={!canRedo}
          >
            <Text style={styles.queryButtonText}>{"↪\uFE0E"}</Text>
          </Pressable>
        </>
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
      {infoTarget && !sheetNodeId && !sheetEdgeId && !inspectorNodeId && (
        <MapInfoCard
          infoTarget={infoTarget}
          doc={doc}
          visible={visible}
          zoomedIds={zoomedIds}
          onZoomStep={(deeper) => zoomSelectionStep(deeper, width / 2, height / 2)}
          onCloseEdge={() => {
            setInfoTarget(null);
            setZoomEdgeIds([]);
          }}
        />
      )}

      {/* double-tap node sheet: everything that mutates this node */}
      {sheetNodeId &&
        (() => {
          const node = doc.nodes[sheetNodeId];
          if (!node) return null;
          return (
            <NodeActionSheet
              node={node}
              onAddTo={() => {
                setSheetNodeId(null);
                setKindPicker({ nodeId: node.id, direction: "child" });
              }}
              onBeAddedTo={() => {
                setSheetNodeId(null);
                setKindPicker({ nodeId: node.id, direction: "parent" });
              }}
              onConnectTo={() => startConnect(node.id)}
              onBeConnectedTo={() => startConnectReverse(node.id)}
              onCopy={() => {
                setClipboard(snapshotNode(doc, node.id));
                setSheetNodeId(null);
              }}
              onNotes={() => {
                setSheetNodeId(null);
                setNotesNodeId(node.id);
              }}
              onStatus={() => {
                setSheetNodeId(null);
                setStatusPickerNodeId(node.id);
              }}
              onColor={() => {
                setSheetNodeId(null);
                setColorPicker({ kind: "node", id: node.id, title: node.title });
              }}
              onRemove={() => confirmRemoveNode(node)}
              onClose={() => setSheetNodeId(null)}
            />
          );
        })()}

      {/* free-space kind picker: first step of a double tap on empty
          canvas — pick the kind of the new node, then the create form
          opens at the tapped position. With a non-empty clipboard a Paste
          tile joins, recreating the snapshot at the tapped point */}
      {freeSpacePicker && (
        <FreeSpacePicker
          hasClipboard={clipboard !== null}
          onPickKind={(mode) => {
            setFreeSpacePicker(null);
            setDraft({ title: "", detail: "" });
            setCreateTarget({ mode, x: freeSpacePicker.x, y: freeSpacePicker.y });
          }}
          onPaste={() => pasteClipboardAt(freeSpacePicker.x, freeSpacePicker.y)}
          onClose={() => setFreeSpacePicker(null)}
        />
      )}

      {/* kind picker: second step of "Add to" / "Be added to" — pick the
          kind of the new node, then the create form opens */}
      {kindPicker &&
        (() => {
          const anchor = doc.nodes[kindPicker.nodeId];
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
            <KindPickerSheet
              anchor={anchor}
              direction={kindPicker.direction}
              onPick={pick}
              onClose={() => setKindPicker(null)}
            />
          );
        })()}

      {/* status picker: second step of the node sheet's "Status" action */}
      {statusPickerNodeId &&
        (() => {
          const node = doc.nodes[statusPickerNodeId];
          if (!node) return null;
          return (
            <StatusPickerSheet
              node={node}
              doc={doc}
              run={run}
              onClose={() => setStatusPickerNodeId(null)}
            />
          );
        })()}

      {/* color picker: second step of the node/edge sheet's "Color"
          action — a palette of swatches plus Default (clear); picking one
          applies it through run() and closes the sheet. The title is
          captured when the picker opens, so render touches no refs */}
      {colorPicker && (
        <ColorPickerSheet
          title={colorPicker.title}
          onPick={pickColor}
          onClose={() => setColorPicker(null)}
        />
      )}

      {/* selection-bar long-press on a road: copy the whole road (every
          selected edge deep-copied with its subtree and endpoints) or
          edit the route query that produced it */}
      {roadSheetOpen && (
        <RoadSheet
          title={selectionEnds ? `${selectionEnds.from} → ${selectionEnds.to}` : "Road"}
          steps={selectedVmEdges.length}
          onCopyRoad={() => {
            const ids = visible.filter((e) => zoomEdgeIdSet.has(e.id)).map((e) => e.id);
            if (ids.length > 0) setClipboard(snapshotRoad(doc, ids));
            setRoadSheetOpen(false);
          }}
          onEditRouteQuery={() => {
            setRoadSheetOpen(false);
            routeQuery.setRouteMode(true);
          }}
          onClose={() => setRoadSheetOpen(false)}
        />
      )}

      {/* double-tap edge sheet: expand / summarize / copy / straighten / remove */}
      {sheetEdge && sheetEdgeFrom && sheetEdgeTo && (
        <EdgeActionSheet
          edge={sheetEdge}
          fromTitle={sheetEdgeFrom.title}
          toTitle={sheetEdgeTo.title}
          layer={edgeDepth(doc, sheetEdge.id)}
          onExpand={() => expandEdge(sheetEdge.id)}
          onSummarize={() => startSummarize(sheetEdge.id)}
          onCopy={() => {
            setClipboard(snapshotEdge(doc, sheetEdge.id));
            setSheetEdgeId(null);
          }}
          onStraighten={() => {
            run(setEdgeBend(sheetEdge.id, null));
            setSheetEdgeId(null);
          }}
          onColor={() => {
            setSheetEdgeId(null);
            setColorPicker({
              kind: "edge",
              id: sheetEdge.id,
              title: `${sheetEdgeFrom.title} → ${sheetEdgeTo.title}`,
            });
          }}
          onRemove={() => confirmRemoveEdge(sheetEdge)}
          onClose={() => setSheetEdgeId(null)}
        />
      )}

      {/* notes sheet: the node's notes newest-first, with add/edit/delete */}
      {notesNodeId &&
        (() => {
          const node = doc.nodes[notesNodeId];
          if (!node) return null;
          return (
            <NotesSheet
              node={node}
              run={run}
              onEditNote={(noteId, text) => {
                // iOS shows only one Modal at a time: swap the list for
                // the editor, which reopens it on close
                setNotesNodeId(null);
                setNoteDraft({ nodeId: node.id, noteId, text });
              }}
              onAddNote={() => {
                // iOS shows only one Modal at a time: swap the list for
                // the editor, which reopens it on close
                setNotesNodeId(null);
                setNoteDraft({ nodeId: node.id, text: "" });
              }}
              onClose={() => setNotesNodeId(null)}
            />
          );
        })()}

      {/* note editor: add a new note or edit an existing one */}
      {noteDraft && noteDraftNode && (
        <NoteEditorSheet
          nodeTitle={noteDraftNode.title}
          noteId={noteDraft.noteId}
          text={noteDraft.text}
          onChangeText={(t) => setNoteDraft((d) => (d ? { ...d, text: t } : d))}
          onSave={saveNote}
          onClose={closeNoteEditor}
        />
      )}

      {/* note query panel: search every note on the map; tapping a result
          focuses the owning node */}
      {noteSearch.noteSearchMode && (
        <NoteSearchPanel
          query={noteSearch.noteQuery}
          results={noteSearch.noteResults.map((r) => ({
            noteId: r.note.id,
            nodeId: r.node.id,
            excerpt: r.note.text,
            nodeTitle: r.node.title,
            nodeKind: r.node.kind,
            createdAt: r.note.createdAt,
          }))}
          onChangeQuery={noteSearch.setNoteQuery}
          onPickResult={noteSearch.focusNoteNode}
          onClose={noteSearch.exitNoteSearchMode}
        />
      )}

      {/* route query panel: type a node name (or tap it on the canvas) to
          fill From/To; both ends set -> candidate routes sheet opens */}
      {routeQuery.routeMode && (
        <RoutePanel
          query={routeQuery.routeQuery}
          pickerField={routeQuery.routePickerField}
          nodes={[...posById.values()]}
          hasRoutes={routeQuery.routes.length > 0}
          onFocusField={routeQuery.setRoutePickerField}
          onChangeQuery={routeQuery.changeQuery}
          onPickSuggestion={routeQuery.pickRouteNode}
          onSwap={routeQuery.swapRouteEnds}
          onShowRoutes={routeQuery.showRoutesAgain}
          onClose={routeQuery.exitRouteMode}
        />
      )}

      {/* candidate routes: every road between the two nodes is marked on
          the canvas; tick one, some, or all, then focus the selection */}
      <RoutesModal
        visible={routeQuery.routeMode && routeQuery.routes.length > 0 && !routeQuery.routeConfirmed}
        routes={routeQuery.routes}
        pickedRoutes={routeQuery.pickedRoutes}
        onTogglePick={routeQuery.toggleRoutePick}
        onToggleAll={routeQuery.toggleAllPicks}
        onConfirm={routeQuery.confirmPickedRoutes}
        onClose={() => routeQuery.setRoutes([])}
      />

      {/* inspector: edit the node's info. Status buttons act at
          once through run(); text edits stay local until Save */}
      {inspectorNodeId &&
        (() => {
          const node = doc.nodes[inspectorNodeId];
          if (!node) return null;
          return (
            <InspectorSheet
              node={node}
              doc={doc}
              draft={inspectorDraft}
              onDraftChange={setInspectorDraft}
              run={run}
              onSave={saveInspector}
              onClose={() => setInspectorNodeId(null)}
            />
          );
        })()}

      {/* create form: goal (title + description), task (title),
          record (title + note) */}
      {createTarget && (
        <CreateNodeForm
          mode={createTarget.mode}
          draft={draft}
          onDraftChange={setDraft}
          onSave={saveCreate}
          onClose={() => setCreateTarget(null)}
        />
      )}
    </View>
  );
}
