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
import Svg, { Circle, G, Line, Polygon } from "react-native-svg";

import {
  addChildNode,
  addFreeNode,
  addNote,
  addParentNode,
  connectNodes,
  expandEdge as expandEdgeCmd,
  insertNodeIntoEdge,
  pastePayload,
  Recipe,
  removeEdge,
  removeNode,
  replaceDoc,
  setEdgeBend,
  setEdgeColor,
  setNodeColor,
  summarizeEdges,
  updateNote,
} from "@/domain/commands";
import { ClipboardPayload, snapshotEdge, snapshotNode, snapshotRoad } from "@/domain/clipboard";
import { EdgeData, NodeData } from "@/domain/doc";
import { buildSeedDoc } from "@/domain/seedDoc";
import { visibleEdges } from "@/domain/visibility";
import { useDocStore } from "@/state/docStore";
import { INK } from "@/ui/theme";
import { EdgeGlyph } from "@/map/components/edgeGlyph";
import { CanvasNode } from "@/map/components/nodeGlyph";
import { BottomPanel } from "@/map/components/bottomPanel";
import { NoteSearchPanel, RoutePanel } from "@/map/components/panels";
import { ModeBanner, SelectionBar } from "@/map/components/sheets";
import { DOUBLE_TAP_MS } from "@/map/constants";
import { useCanvasGestures } from "@/map/hooks/useCanvasGestures";
import { useMapCamera } from "@/map/hooks/useMapCamera";
import { useNodeDrag } from "@/map/hooks/useNodeDrag";
import { useNoteSearch } from "@/map/hooks/useNoteSearch";
import { useRouteQuery } from "@/map/hooks/useRouteQuery";
import { useZoomLens } from "@/map/hooks/useZoomLens";
import { CreateMenu, EdgeMenu, NodeMenu, RoadMenu } from "@/map/overlays/menus";
import { CreateNodeForm } from "@/map/overlays/forms";
import { MapInfoCard } from "@/map/overlays/mapInfoCard";
import { NotesSheet } from "@/map/overlays/notes";
import { RoutesModal } from "@/map/overlays/routesModal";
import { styles } from "@/map/styles";
import { CreateTarget, InfoTarget } from "@/map/types";
import { childPosition, computeGridDots, edgeEndpointNodes, nodeSize } from "@/map/utils";
import { deriveViewModel, useMapViewModel } from "@/map/viewModel";

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
  const { fitRef, viewportRef, setViewport } = camera;
  const lens = useZoomLens({ frameNodes: camera.frameNodes });
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
  // single tap -> read-only info card in the bottom panel; double tap ->
  // action menu in the bottom panel (see DESIGN_MUTATIONS.md)
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null);
  // node spotlight: an open-menu or dragged node's directly-connected edges
  // (and their endpoints) light up while everything else dims. Purely
  // visual — the zoom selection is untouched
  const [nodeFocusId, setNodeFocusId] = useState<string | null>(null);
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const [menuEdgeId, setMenuEdgeId] = useState<string | null>(null);
  // drag-to-connect: the tentative edge follows the finger (world coords);
  // the node under the finger is the candidate target. Drop = connect,
  // drop anywhere else = cancel
  const [connectDrag, setConnectDrag] = useState<{ fromId: string; x: number; y: number } | null>(
    null,
  );
  const [connectCandidateId, setConnectCandidateId] = useState<string | null>(null);
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
  // road menu: long-press on the selection bar with a multi-edge
  // selection offers copying the road or editing its route query
  const [roadMenuOpen, setRoadMenuOpen] = useState(false);
  // creation flow: what the form is making
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [draft, setDraft] = useState({ title: "", detail: "" });
  // notes flow: the info card shows only a peek of the newest note; the
  // notes sheet (notesNodeId) holds the full list, and the note being
  // added or edited sits in the sheet's draft state (noteId present =
  // editing that existing note) — the sheet swaps list/editor in place
  const [notesNodeId, setNotesNodeId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ nodeId: string; noteId?: string; text: string } | null>(null);
  // pending empty-canvas double tap: the create menu opens for this world
  // point (a Paste row joins when the clipboard is non-empty)
  const [createPicker, setCreatePicker] = useState<{ x: number; y: number } | null>(null);
  // measured height of the bottom-docked panel — the camera accommodation
  // below needs to know how much room to make
  const [panelHeight, setPanelHeight] = useState(0);

  const closeOverlays = () => {
    setInfoTarget(null);
    setNodeFocusId(null);
    setMenuNodeId(null);
    setMenuEdgeId(null);
    setNotesNodeId(null);
    setNoteDraft(null);
    setCreatePicker(null);
    setRoadMenuOpen(false);
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

  // camera: base (identity by default, a computed fit after the fit
  // button) × pinch zoom, composed in useMapCamera; fitRef inside it
  // feeds the once-created pan responder, synced on every commit.
  // Nodes render at natural size (nodeSize) at >= 1x zoom, shrinking
  // with the camera below it
  const cam = camera.cam;

  const noteSearch = useNoteSearch({
    doc,
    width,
    height,
    fitRef,
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

  // double tap on empty canvas opens the create menu for that point; the
  // camera keeps the point clear of the bottom panel (world position =
  // (screen position - camera offset) / zoom)
  const openCreatePickerAt = (screenX: number, screenY: number) => {
    closeOverlays();
    setCreatePicker({
      x: (screenX - viewportRef.current.x - fitRef.current.x) / fitRef.current.scale,
      y: (screenY - viewportRef.current.y - fitRef.current.y) / fitRef.current.scale,
    });
  };

  // single tap on empty canvas (after the double-tap window lapses):
  // dismiss overlays — the bottom panel included — and clear the zoom
  // selection (the lens) unless it is locked, so the next pinch moves
  // only the camera
  const onCanvasSingleTap = () => {
    closeOverlays();
    setDragArmedId(null);
    // a locked selection survives stray canvas taps
    if (!selectionLockedRef.current) setZoomEdgeIds([]);
  };

  const commitBend = (edgeId: string, bend: { x: number; y: number }) =>
    run(setEdgeBend(edgeId, bend));

  // ---------- drag-to-connect ----------
  // The connect handle on a focused node starts the drag; the tentative
  // edge follows the finger and snaps to the node under it. Drop on a
  // node = connect (drag direction is the edge direction); drop anywhere
  // else cancels. Duplicates are allowed — undo covers regret.
  const hitTestConnectTarget = (pageX: number, pageY: number, excludeId: string) => {
    const camNow = fitRef.current;
    const vp = viewportRef.current;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const n of vm.nodes) {
      if (n.id === excludeId) continue;
      const sx = n.x * camNow.scale + camNow.x + vp.x;
      const sy = n.y * camNow.scale + camNow.y + vp.y;
      const d = Math.hypot(sx - pageX, sy - pageY);
      const hitR = Math.max(22, (nodeSize(n.kind) * Math.min(1, camNow.scale)) / 2) + 10;
      if (d <= hitR && d < bestDist) {
        best = n.id;
        bestDist = d;
      }
    }
    return best;
  };

  const onConnectStart = (id: string) => {
    const node = doc.nodes[id];
    if (!node) return;
    setConnectDrag({ fromId: id, x: node.x, y: node.y });
    setConnectCandidateId(null);
  };

  const onConnectMove = (id: string, pageX: number, pageY: number) => {
    const camNow = fitRef.current;
    const vp = viewportRef.current;
    setConnectDrag({
      fromId: id,
      x: (pageX - vp.x - camNow.x) / camNow.scale,
      y: (pageY - vp.y - camNow.y) / camNow.scale,
    });
    setConnectCandidateId(hitTestConnectTarget(pageX, pageY, id));
  };

  const onConnectEnd = (id: string, pageX: number, pageY: number) => {
    const targetId = hitTestConnectTarget(pageX, pageY, id);
    setConnectDrag(null);
    setConnectCandidateId(null);
    if (!targetId) return;
    const d = useDocStore.getState().doc;
    if (!d.nodes[id] || !d.nodes[targetId]) return;
    run(connectNodes(id, targetId).recipe);
  };

  const { panResponder } = useCanvasGestures({
    viewportRef,
    fitRef,
    setViewport,
    pinchCameraZoom: camera.pinchCameraZoom,
    cancelCameraTween: camera.cancelCameraTween,
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
  // the initial map itself when the database is empty or unreadable
  useEffect(() => {
    useDocStore.getState().load({ width, height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // initial placement: the first time content shows up (the doc load is
  // async), center it on screen at natural size; after that the camera
  // belongs to the user
  const centeredOnceRef = useRef(false);
  useEffect(() => {
    if (centeredOnceRef.current || vm.nodes.length === 0) return;
    centeredOnceRef.current = true;
    camera.centerOnContent(vm.nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.nodes]);

  // bottom-dock accommodation: when a panel opens (or grows), ease the
  // camera up just enough that the panel's object stays clear of the
  // panel's area. An object already visible stays put (no jumpiness); any
  // user gesture cancels the tween (useMapCamera)
  useEffect(() => {
    const open = Boolean(menuNodeId || menuEdgeId || infoTarget || createPicker || roadMenuOpen);
    // a stale height after close is harmless: the panel re-measures on the
    // next open and the effect re-runs with the fresh value
    if (!open) return;
    // the road menu's object is the selection bar itself (top of screen)
    if (panelHeight === 0 || roadMenuOpen) return;
    const edgeMid = (id: string) => {
      const e = doc.edges[id];
      const a = e ? doc.nodes[e.fromId] : undefined;
      const b = e ? doc.nodes[e.toId] : undefined;
      return e && a && b ? (e.bend ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) : null;
    };
    let world: { x: number; y: number } | null = null;
    if (menuNodeId) world = doc.nodes[menuNodeId] ?? null;
    else if (menuEdgeId) world = edgeMid(menuEdgeId);
    else if (infoTarget?.kind === "node") world = doc.nodes[infoTarget.id] ?? null;
    else if (infoTarget?.kind === "edge") world = edgeMid(infoTarget.id);
    else if (createPicker) world = { x: createPicker.x, y: createPicker.y };
    if (!world) return;
    const camNow = fitRef.current;
    const screenY = world.y * camNow.scale + camNow.y + viewportRef.current.y;
    const limit = height - panelHeight - 40;
    if (screenY > limit) camera.panByAnimated(0, limit - screenY);
    // fires on panel open / height change only; reads the camera via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelHeight, menuNodeId, menuEdgeId, infoTarget, createPicker, roadMenuOpen]);

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
  // the node the canvas holds visually: the spotlight node (open menu /
  // drag), else the node whose info card is open — a single tap highlights
  // just the node itself and shows its connect handle, with no edge
  // spotlight
  const heldNodeId = nodeFocusId ?? (infoTarget?.kind === "node" ? infoTarget.id : null);
  // node highlight: the connect-drag candidate (drop target), else the held node
  const highlightedNodeId = connectCandidateId ?? heldNodeId;

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

  // the edge open in the bottom-docked menu, with its endpoints resolved
  // (an edit can remove the edge out from under an open menu)
  const menuEdge = menuEdgeId ? visible.find((e) => e.id === menuEdgeId) : undefined;
  const menuEdgeFrom = menuEdge ? doc.nodes[menuEdge.fromId] : undefined;
  const menuEdgeTo = menuEdge ? doc.nodes[menuEdge.toId] : undefined;
  // the node open in the menu (same out-from-under case)
  const menuNode = menuNodeId ? doc.nodes[menuNodeId] : undefined;
  // the node whose notes sheet is open (same out-from-under case)
  const notesNode = notesNodeId ? doc.nodes[notesNodeId] : undefined;

  // ---------- selection bar handlers ----------

  // long-press on the selection bar opens the bottom-panel mutation menu:
  // a single edge gets its menu; a road gets a menu offering to copy it or
  // re-open the route query panel (the confirmed query is kept, so the
  // panel comes back prefilled)
  const editSelection = () => {
    setInfoTarget(null);
    if (selectedVmEdges.length === 1) {
      setMenuEdgeId(selectedVmEdges[0].id);
    } else if (selectedVmEdges.length > 1) {
      setRoadMenuOpen(true);
    }
  };

  // tap on the selection bar: open the route query prefilled with the
  // selection's boundary nodes — the current road fills the search by
  // default — and search right away so the candidate roads preview
  const searchSelection = () => {
    if (!selectionEnds) return;
    setInfoTarget(null);
    setMenuEdgeId(null);
    setRoadMenuOpen(false);
    routeQuery.openWithSelection(selectionEnds);
  };

  // the note draft lives inside the notes sheet (list <-> editor swap);
  // closing the draft just returns to the list
  const closeNoteEditor = () => setNoteDraft(null);

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
    setMenuNodeId(null);
    setMenuEdgeId(null);
    setInfoTarget({ kind: "node", id });
    // nodes aren't zoomable; the edge lens clears unless it is locked
    if (!selectionLocked) setZoomEdgeIds([]);
  };

  const onNodeDoubleTap = (id: string) => {
    setInfoTarget(null);
    setMenuEdgeId(null);
    setMenuNodeId(id);
    // spotlight the menu's node the way a single tap would — the object
    // of the action stays visually held while the menu is open
    setNodeFocusId(id);
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
    setMenuNodeId(null);
    setMenuEdgeId(null);
    setInfoTarget({ kind: "edge", id });
    setNodeFocusId(null); // the edge's own selection takes over the canvas
    setZoomEdgeIds([id]); // the tapped edge becomes the zoom selection
  };

  const onEdgeDoubleTap = (id: string) => {
    setInfoTarget(null);
    setNodeFocusId(null);
    setMenuNodeId(null);
    setMenuEdgeId(id);
  };

  const onEdgePress = (id: string) => {
    if (routeQuery.routeMode || noteSearch.noteSearchMode || bendDrag) return;
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
    if (routeQuery.routeMode || noteSearch.noteSearchMode || summarizeMode) return;
    const edge = visible.find((e) => e.id === id);
    if (!edge) return;
    const from = doc.nodes[edge.fromId];
    const to = doc.nodes[edge.toId];
    if (!from || !to) return;
    setInfoTarget(null);
    setMenuEdgeId(null);
    const mid = edge.bend ?? {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    };
    setBendDrag({ edgeId: id, x: mid.x, y: mid.y });
  };

  // long-press a node arms it for dragging; a following movement becomes
  // the drag (see DraggableNode's armed pan responder)
  const onNodeLongPress = (id: string) => {
    if (routeQuery.routeMode || noteSearch.noteSearchMode) return;
    const node = useDocStore.getState().doc.nodes[id];
    if (!node) return;
    closeOverlays();
    setDragArmedId(id);
  };

  // ---------- create / connect / remove flows ----------

  // "New successor": create a node of the chosen kind, pointed at by the
  // anchor node (edge anchor -> new)
  const startCreate = (mode: "task" | "record", parentId: string) => {
    closeOverlays();
    setDraft({ title: "", detail: "" });
    setCreateTarget({ mode, parentId });
  };

  // goal variant of the above (the CreateTarget type splits goal out)
  const startCreateAttachedGoal = (parentId: string) => {
    closeOverlays();
    setDraft({ title: "", detail: "" });
    setCreateTarget({ mode: "goal", parentId });
  };

  // removal runs straight from the menu — the menu's two-tap in-place
  // confirm is the only confirmation (undo is the safety net)
  const removeNodeNow = (node: NodeData) => {
    run(removeNode(node.id));
    setMenuNodeId(null);
    setInfoTarget(null);
    setNodeFocusId(null);
  };

  const removeEdgeNow = (edge: EdgeData) => {
    run(removeEdge(edge.id));
    setMenuEdgeId(null);
    setInfoTarget(null);
  };

  // "New predecessor": create a node of the chosen kind pointing at the
  // current one (edge new -> current)
  const startCreateReverse = (mode: "goal" | "task" | "record", childId: string) => {
    closeOverlays();
    setDraft({ title: "", detail: "" });
    setCreateTarget({ mode, childId });
  };

  const saveCreate = () => {
    if (!createTarget) return;
    const title = draft.title.trim();
    if (!title) return;
    const detail = draft.detail.trim();

    // fan new nodes along the road direction (see childPosition); index by
    // the same-direction edge count so repeated adds don't stack nodes on
    // top of each other
    const outDegree = (id: string) =>
      Object.values(doc.edges).filter((e) => e.fromId === id).length;
    const inDegree = (id: string) =>
      Object.values(doc.edges).filter((e) => e.toId === id).length;

    // insert N mid-road when exactly one VISIBLE road touches the anchor in
    // the requested direction: A -> B becomes A -> N -> B at the layer the
    // user is looking at (a collapsed sub-road rides along with the N -> B
    // half). No road (nothing to insert into) or a fork (which road?) falls
    // back to a fresh branch; records always branch — they are leaves and
    // could not point onward
    const tryInsert = (anchorId: string, direction: "successor" | "predecessor") => {
      const roads = visible.filter(
        (e) => (direction === "successor" ? e.fromId : e.toId) === anchorId,
      );
      if (createTarget.mode === "record") return false;
      if (roads.length !== 1) return false;
      const road = roads[0];
      const a = doc.nodes[road.fromId];
      const b = doc.nodes[road.toId];
      if (!a || !b) return false;
      const pos = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ins = insertNodeIntoEdge(road.id, createTarget.mode, title, detail, pos);
      run(ins.recipe);
      // the two halves light up as the selection, like an expand
      setZoomEdgeIds(ins.edgeIds);
      return true;
    };

    if ("childId" in createTarget) {
      // predecessor: the new node points at the current one
      const child = doc.nodes[createTarget.childId];
      if (!child) return;
      if (!tryInsert(child.id, "predecessor")) {
        const pos = childPosition(child, inDegree(child.id), "predecessor");
        run(addParentNode(createTarget.childId, createTarget.mode, title, detail, pos).recipe);
      }
    } else if ("x" in createTarget) {
      // free node at the double-tapped position
      run(
        addFreeNode(createTarget.mode, title, detail, { x: createTarget.x, y: createTarget.y })
          .recipe,
      );
    } else if ("parentId" in createTarget) {
      const parent = doc.nodes[createTarget.parentId];
      if (!parent) return;
      if (!tryInsert(parent.id, "successor")) {
        const pos = childPosition(parent, outDegree(parent.id), "successor");
        run(addChildNode(createTarget.parentId, createTarget.mode, title, detail, pos).recipe);
      }
    }
    setCreateTarget(null);
  };

  // paste the clipboard snapshot centered on a tapped canvas point, then
  // highlight the pasted root edges (a pasted lone node clears the lens)
  const pasteClipboardAt = (x: number, y: number) => {
    if (!clipboard) return;
    const payload = clipboard;
    setCreatePicker(null);
    const p = pastePayload(payload, { x, y });
    run(p.recipe);
    setZoomEdgeIds(p.rootEdgeIds);
  };

  // load the tutorial seed over the current map (create menu's
  // destructive row): a single replaceDoc edit, so undo restores the
  // previous map. The lens and history reset to a folded view, and the
  // camera re-centers on the new map at natural size
  const loadSeedTutorial = () => {
    run(replaceDoc(buildSeedDoc(width / 2, height / 3)));
    zoomHistoryRef.current = [];
    const folded = new Set<string>();
    zoomedIdsRef.current = folded;
    setZoomedIds(folded);
    setZoomEdgeIds([]);
    const newDoc = useDocStore.getState().doc;
    camera.centerOnContent(deriveViewModel(newDoc, folded).nodes);
    closeOverlays();
  };

  const expandEdge = (edgeId: string) => {
    const edge = useDocStore.getState().doc.edges[edgeId];
    if (!edge) return;
    // expand is a DOMAIN edit (it creates a sub-node); zoom is the view
    // operation. Expanding zooms this edge open locally so the new
    // children show, without disturbing the rest of the map.
    let childIds: string[];
    if (edge.childEdgeIds.length > 0) {
      // already expanded: the command would no-op, so just zoom it open
      // and record the REAL child ids for the selection-less squeeze
      childIds = edge.childEdgeIds;
      zoomHistoryRef.current.push(childIds);
    } else {
      const ex = expandEdgeCmd(edgeId);
      run(ex.recipe);
      // menu-expand bypasses zoomSelectionStep; record it so a
      // selection-less squeeze can undo this spread too
      childIds = ex.childEdgeIds;
      zoomHistoryRef.current.push(childIds);
    }
    const nextZoom = new Set(zoomedIdsRef.current).add(edgeId);
    zoomedIdsRef.current = nextZoom;
    setZoomedIds(nextZoom);
    setSelectedEdgeIds([]);
    // the revealed children inherit the selection, exactly as a lens
    // spread's children do — the parent is now hidden, so it can't
    // stay selected
    setZoomEdgeIds(childIds);
    setMenuEdgeId(null);
    setInfoTarget(null);
    // same room-making as a lens spread: frame the edge with its children
    const after = useDocStore.getState().doc;
    camera.frameNodes(edgeEndpointNodes(after, [edgeId, ...childIds]));
  };

  // summarize mode: the menu's edge is pre-selected, further edge taps
  // extend the selection, Confirm runs the domain summarize
  const startSummarize = (edgeId: string) => {
    setMenuEdgeId(null);
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

  // render nothing until the persisted map (or the seeded initial map) is
  // in place, so gestures never mutate a map that is about to be replaced
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
          {/* tentative connect edge: follows the finger while a connect
              drag is in flight; snaps to the candidate target's rim with
              an arrowhead (same geometry as EdgeGlyph), else ends in a dot */}
          {connectDrag &&
            (() => {
              const from = posById.get(connectDrag.fromId);
              if (!from) return null;
              const target = connectCandidateId ? posById.get(connectCandidateId) : undefined;
              const tx = target ? target.x : connectDrag.x;
              const ty = target ? target.y : connectDrag.y;
              const dx = tx - from.x;
              const dy = ty - from.y;
              const len = Math.hypot(dx, dy);
              if (len === 0) return null;
              const ux = dx / len;
              const uy = dy / len;
              const rim = target ? nodeSize(target.kind) / 2 : 0;
              const tipX = tx - ux * rim;
              const tipY = ty - uy * rim;
              // start on the source rim so the preview never crosses it
              const rim0 = nodeSize(from.kind) / 2;
              const x1 = from.x + ux * rim0;
              const y1 = from.y + uy * rim0;
              const wing = 5 / cam.scale;
              const back = 11 / cam.scale;
              const baseX = tipX - ux * back;
              const baseY = tipY - uy * back;
              const arrowPoints = `${tipX},${tipY} ${baseX - uy * wing},${baseY + ux * wing} ${baseX + uy * wing},${baseY - ux * wing}`;
              return (
                <>
                  <Line
                    x1={x1}
                    y1={y1}
                    x2={tipX}
                    y2={tipY}
                    stroke={INK.primary}
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {target ? (
                    <Polygon points={arrowPoints} fill={INK.primary} />
                  ) : (
                    <Circle cx={tipX} cy={tipY} r={3 / cam.scale} fill={INK.primary} />
                  )}
                </>
              );
            })()}
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
            camScale={cam.scale}
            cameraX={cameraX}
            cameraY={cameraY}
            reduceMotion={reduceMotion}
            selected={n.id === highlightedNodeId}
            dimmed={nodeDimmed}
            armed={dragArmedId === n.id}
            // the handle yields to the node's own menu and to bend mode
            connectable={
              heldNodeId === n.id && dragArmedId !== n.id && !menuNodeId && !bendDrag
            }
            onPress={onNodePress}
            onArm={onNodeLongPress}
            onDragStart={nodeDrag.onNodeDragStart}
            onDragMove={nodeDrag.onNodeDragMove}
            onDragEnd={nodeDrag.onNodeDragEnd}
            onConnectStart={onConnectStart}
            onConnectMove={onConnectMove}
            onConnectEnd={onConnectEnd}
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

      {/* fit button: one-tap overview — the base camera becomes a computed
          fit of every visible node; pinch spread walks back to natural size */}
      {!routeQuery.routeMode && !noteSearch.noteSearchMode && (
        <Pressable style={styles.fitButton} onPress={() => camera.fitToContent(vm.nodes)}>
          <Text style={styles.queryButtonText}>{"⛶\uFE0E"}</Text>
        </Pressable>
      )}

      {/* mode banners: summarize mode retargets edge taps; bend mode
          retargets the next canvas drag */}
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

      {/* single-tap info card: read-only peek at an edge; for a node it
          carries a peek of the newest note that opens the notes sheet.
          The camera keeps the object clear of the bottom panel */}
      {infoTarget && !menuNodeId && !menuEdgeId && (
        <BottomPanel onHeight={setPanelHeight}>
          <MapInfoCard
            infoTarget={infoTarget}
            doc={doc}
            visible={visible}
            zoomedIds={zoomedIds}
            run={run}
            onOpenNotes={(nodeId) => setNotesNodeId(nodeId)}
            onZoomStep={(deeper) => zoomSelectionStep(deeper)}
            onCloseEdge={() => {
              setInfoTarget(null);
              setZoomEdgeIds([]);
            }}
          />
        </BottomPanel>
      )}

      {/* double-tap node menu: everything that mutates this node */}
      {menuNode && (
        <BottomPanel onHeight={setPanelHeight}>
          <NodeMenu
            node={menuNode}
            onPickKind={(direction, kind) => {
              // the start* helpers close overlays (this menu included)
              if (direction === "successor") {
                if (kind === "goal") startCreateAttachedGoal(menuNode.id);
                else startCreate(kind, menuNode.id);
              } else {
                startCreateReverse(kind, menuNode.id);
              }
            }}
            onCopy={() => {
              setClipboard(snapshotNode(doc, menuNode.id));
              setMenuNodeId(null);
            }}
            onColor={(color) => {
              run(setNodeColor(menuNode.id, color));
              setMenuNodeId(null);
            }}
            onRemove={() => removeNodeNow(menuNode)}
          />
        </BottomPanel>
      )}

      {/* create menu: double tap on empty canvas — pick the kind of the
          new node and the create form opens at the tapped position. With
          a non-empty clipboard a Paste row joins, recreating the snapshot
          at the tapped point */}
      {createPicker && (
        <BottomPanel onHeight={setPanelHeight}>
          <CreateMenu
            hasClipboard={clipboard !== null}
            onPickKind={(mode) => {
              setCreatePicker(null);
              setDraft({ title: "", detail: "" });
              setCreateTarget({ mode, x: createPicker.x, y: createPicker.y });
            }}
            onPaste={() => pasteClipboardAt(createPicker.x, createPicker.y)}
            onLoadSeed={loadSeedTutorial}
          />
        </BottomPanel>
      )}

      {/* selection-bar long-press on a road: copy the whole road (every
          selected edge deep-copied with its subtree and endpoints) or
          edit the route query that produced it */}
      {roadMenuOpen && (
        <BottomPanel onHeight={setPanelHeight}>
          <RoadMenu
            title={
              selectionEnds
                ? `${selectionEnds.from} → ${selectionEnds.to} · ${selectedVmEdges.length} steps`
                : "Road"
            }
            onCopyRoad={() => {
              const ids = visible.filter((e) => zoomEdgeIdSet.has(e.id)).map((e) => e.id);
              if (ids.length > 0) setClipboard(snapshotRoad(doc, ids));
              setRoadMenuOpen(false);
            }}
            onEditRouteQuery={() => {
              setRoadMenuOpen(false);
              routeQuery.setRouteMode(true);
            }}
          />
        </BottomPanel>
      )}

      {/* double-tap edge menu: expand / summarize / copy / straighten /
          color / remove */}
      {menuEdge && menuEdgeFrom && menuEdgeTo && (
        <BottomPanel onHeight={setPanelHeight}>
          <EdgeMenu
            edge={menuEdge}
            title={`${menuEdgeFrom.title} → ${menuEdgeTo.title}`}
            onExpand={() => expandEdge(menuEdge.id)}
            onSummarize={() => startSummarize(menuEdge.id)}
            onCopy={() => {
              setClipboard(snapshotEdge(doc, menuEdge.id));
              setMenuEdgeId(null);
            }}
            onStraighten={() => {
              run(setEdgeBend(menuEdge.id, null));
              setMenuEdgeId(null);
            }}
            onColor={(color) => {
              run(setEdgeColor(menuEdge.id, color));
              setMenuEdgeId(null);
            }}
            onRemove={() => removeEdgeNow(menuEdge)}
          />
        </BottomPanel>
      )}

      {/* notes sheet: the node's full notes list with add/edit/delete,
          opened from the info card's peek row. The info card stays put
          underneath; the sheet swaps its own content to the note editor
          for text entry (one Modal — stacked Modals don't reliably come
          to the front on iOS) */}
      {notesNode && (
        <NotesSheet
          node={notesNode}
          run={run}
          draft={noteDraft && noteDraft.nodeId === notesNode.id ? noteDraft : null}
          onChangeDraftText={(t) => setNoteDraft((d) => (d ? { ...d, text: t } : d))}
          onStartAdd={() => setNoteDraft({ nodeId: notesNode.id, text: "" })}
          onStartEdit={(noteId, text) => setNoteDraft({ nodeId: notesNode.id, noteId, text })}
          onSaveDraft={saveNote}
          onCloseDraft={closeNoteEditor}
          onClose={() => {
            setNotesNodeId(null);
            setNoteDraft(null);
          }}
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
