import { useState } from "react";
import { Alert, Keyboard } from "react-native";

import { FitView } from "@/map/fitZoom";
import { EdgeData, LifeMapDoc } from "@/domain/doc";
import { findRoutes, RouteResult } from "@/domain/route";
import { MAX_ROUTE_CANDIDATES } from "../constants";

// route query flow: pick From/To nodes, mark every road between them on
// the canvas, then focus the roads the user selects (all, one, or some).
// The hook owns only its own state; the screen composes the mutual
// exclusion with the other modes (note search, connect, summarize, …)
export function useRouteQuery(params: {
  doc: LifeMapDoc;
  visible: EdgeData[];
  cam: FitView;
  width: number;
  height: number;
  setViewport: (v: { x: number; y: number }) => void;
  setZoomEdgeIds: (ids: string[]) => void;
}) {
  const { doc, visible, cam, width, height, setViewport, setZoomEdgeIds } = params;
  const [routeMode, setRouteMode] = useState(false);
  const [routeFromId, setRouteFromId] = useState<string | null>(null);
  const [routeToId, setRouteToId] = useState<string | null>(null);
  const [routePickerField, setRoutePickerField] = useState<"from" | "to" | null>(null);
  // the text typed into the From/To search inputs
  const [routeQuery, setRouteQuery] = useState({ from: "", to: "" });
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  // the route indexes ticked in the sheet, and whether that selection is
  // confirmed (confirmed = dim everything else, edges become zoom targets)
  const [pickedRoutes, setPickedRoutes] = useState<number[]>([]);
  const [routeConfirmed, setRouteConfirmed] = useState(false);

  const clearRouteState = () => {
    setRouteFromId(null);
    setRouteToId(null);
    setRoutePickerField(null);
    setRouteQuery({ from: "", to: "" });
    setRoutes([]);
    setPickedRoutes([]);
    setRouteConfirmed(false);
  };

  const enterRouteMode = () => {
    clearRouteState();
    setZoomEdgeIds([]); // the query starts from a clean selection
    setRouteMode(true);
  };

  const exitRouteMode = () => {
    clearRouteState();
    setRouteMode(false);
  };

  // search over the currently visible edges so every route edge can be
  // rendered and highlighted. A new query replaces the current selection:
  // the candidates are only a preview (blue) until confirmed
  const searchRoutes = (fromId: string, toId: string) => {
    setZoomEdgeIds([]);
    const found = findRoutes(doc, visible, fromId, toId, MAX_ROUTE_CANDIDATES);
    if (found.length === 0) {
      setRoutes([]);
      setPickedRoutes([]);
      setRouteConfirmed(false);
      Alert.alert("No route", "No directed path connects these two nodes.");
      return;
    }
    setRoutes(found);
    // every road starts selected; the user narrows it to one or some
    setPickedRoutes(found.map((_, i) => i));
    setRouteConfirmed(false);
  };

  // tick or untick one road in the routes sheet
  const toggleRoutePick = (index: number) => {
    setPickedRoutes((p) =>
      p.includes(index) ? p.filter((i) => i !== index) : [...p, index],
    );
  };

  // the routes sheet toolbar: all ticked <-> none ticked
  const toggleAllPicks = () => {
    setPickedRoutes((p) =>
      p.length === routes.length ? [] : routes.map((_, i) => i),
    );
  };

  // confirm the ticked roads: center their bounding box on screen, make
  // their edges the zoom selection (so a following pinch reveals or
  // collapses detail along the whole selection at once), and close the
  // query panel — the selection bar takes over the top row. The route
  // state is kept so the road sheet's "Edit route query" re-opens the
  // panel prefilled
  const confirmPickedRoutes = () => {
    const chosen = pickedRoutes
      .map((i) => routes[i])
      .filter((r): r is RouteResult => !!r);
    if (chosen.length === 0) return;
    setRouteConfirmed(true);
    setZoomEdgeIds([...new Set(chosen.flatMap((r) => r.edges.map((e) => e.id)))]);
    setRouteMode(false);
    const nodes = chosen.flatMap((r) => r.nodes);
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
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

  // typed text no longer matches the picked node: clear that end and the
  // candidate roads, keep the field focused for suggestions
  const changeQuery = (field: "from" | "to", t: string) => {
    setRouteQuery((q) => ({ ...q, [field]: t }));
    if (field === "from") setRouteFromId(null);
    else setRouteToId(null);
    setRoutePickerField(field);
    setRoutes([]);
    setPickedRoutes([]);
    setRouteConfirmed(false);
  };

  // re-picking from the candidates sheet replaces the selection: clear it
  // so every candidate previews in blue again
  const showRoutesAgain = () => {
    setRouteConfirmed(false);
    setZoomEdgeIds([]);
  };

  // tap on the selection bar: open the route query prefilled with the
  // selection's boundary nodes — the current road fills the search by
  // default — and search right away so the candidate roads preview
  const openWithSelection = (ends: { fromId: string; toId: string; from: string; to: string }) => {
    setRouteFromId(ends.fromId);
    setRouteToId(ends.toId);
    setRouteQuery({ from: ends.from, to: ends.to });
    setRoutePickerField(null);
    setRouteMode(true);
    if (ends.fromId !== ends.toId) {
      searchRoutes(ends.fromId, ends.toId);
    }
  };

  // the roads previewed on the canvas before confirmation, drawn in ACCENT
  // blue; once confirmed their edges become the zoom selection and render
  // like any other selection
  const activeRoutes =
    !routeMode || routes.length === 0
      ? []
      : routeConfirmed
        ? pickedRoutes.map((i) => routes[i]).filter((r): r is RouteResult => !!r)
        : routes;
  const routeEdgeIds = new Set(activeRoutes.flatMap((r) => r.edges.map((e) => e.id)));

  return {
    routeMode,
    setRouteMode,
    routeFromId,
    routeToId,
    routePickerField,
    setRoutePickerField,
    routeQuery,
    routes,
    setRoutes,
    pickedRoutes,
    routeConfirmed,
    activeRoutes,
    routeEdgeIds,
    enterRouteMode,
    exitRouteMode,
    searchRoutes,
    pickRouteNode,
    swapRouteEnds,
    toggleRoutePick,
    toggleAllPicks,
    confirmPickedRoutes,
    changeQuery,
    showRoutesAgain,
    openWithSelection,
  };
}
