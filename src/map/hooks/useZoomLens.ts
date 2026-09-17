import { RefObject, useLayoutEffect, useRef, useState } from "react";

import { computeFitView, FitView } from "@/app/fitZoom";
import { useDocStore } from "@/state/docStore";
import { visibleEdges, zoomInIds, zoomOutIds } from "@/domain/visibility";
import { composedCam } from "../utils";
import { deriveViewModel } from "../viewModel";

// ---------- selection-scoped zoom ----------
// The selection is the lens for zoom/collapse: a single tap selects an
// edge, the route query selects a whole road. Zooming reveals the hidden
// children of selected edges one level at a time; collapsing folds the
// deepest selected frontier back into its parents. Pure view state —
// zoom never touches the domain.
export function useZoomLens(params: {
  width: number;
  height: number;
  fitRef: RefObject<FitView>;
  viewportRef: RefObject<{ x: number; y: number }>;
  userScaleRef: RefObject<number>;
  setViewport: (v: { x: number; y: number }) => void;
}) {
  const { width, height, fitRef, viewportRef, userScaleRef, setViewport } = params;
  const [zoomEdgeIds, setZoomEdgeIds] = useState<string[]>([]);
  const zoomEdgeIdsRef = useRef(zoomEdgeIds);
  useLayoutEffect(() => {
    zoomEdgeIdsRef.current = zoomEdgeIds;
  });
  // the lens: ids of edges currently zoomed open. Pure UI state owned here
  // (never persisted); always REPLACED with the fresh Set returned by the
  // pure lens functions (zoomInIds/zoomOutIds/revealEdge), never mutated
  const [zoomedIds, setZoomedIds] = useState<Set<string>>(new Set());
  const zoomedIdsRef = useRef(zoomedIds);
  useLayoutEffect(() => {
    zoomedIdsRef.current = zoomedIds;
  });
  // the lock pins the selection: while locked, stray canvas and node taps
  // no longer clear it. Explicit actions (tapping another edge, confirming
  // a route, pasting) still replace it, and pruning still applies when
  // selected edges vanish from the view
  const [selectionLocked, setSelectionLocked] = useState(false);
  const selectionLockedRef = useRef(selectionLocked);
  useLayoutEffect(() => {
    selectionLockedRef.current = selectionLocked;
  });
  // undo stack for selection-less pinch-in: each spread pushes the revealed
  // child edge ids, so a squeeze with no lens collapses the last spread
  // even after the selection was accidentally cleared
  const zoomHistoryRef = useRef<string[][]>([]);

  // One zoom step on the selection, anchored at (mx, my) so the content
  // under the gesture stays put while the fit view reacts to the changed
  // node set. Selection is hereditary: revealed children inherit it on
  // zoom-in, parents inherit it on collapse. With no selection, a collapse
  // pops the zoom history instead: a squeeze undoes the last spread even
  // after the lens was accidentally cleared.
  const zoomSelectionStep = (deeper: boolean, mx: number, my: number) => {
    const d = useDocStore.getState().doc;
    const zoomed = zoomedIdsRef.current;
    let sel = zoomEdgeIdsRef.current;
    let fromHistory = false;
    if (sel.length === 0) {
      if (deeper) return; // no lens: a spread only moves the camera
      fromHistory = true;
      // drop stale entries (edges since removed, collapsed, or re-hidden)
      // until the top of the stack names a collapsible group
      const visibleNow = visibleEdges(d, zoomed);
      while (zoomHistoryRef.current.length > 0) {
        const top = zoomHistoryRef.current[zoomHistoryRef.current.length - 1];
        const collapsible = top.some((id) =>
          visibleNow.some(
            (e) => e.id === id && e.parentEdgeId !== null && zoomed.has(e.parentEdgeId),
          ),
        );
        if (collapsible) {
          sel = top;
          break;
        }
        zoomHistoryRef.current.pop();
      }
      if (sel.length === 0) return;
    }
    const cam = fitRef.current;
    const vp = viewportRef.current;
    const wx = (mx - vp.x - cam.x) / cam.scale;
    const wy = (my - vp.y - cam.y) / cam.scale;
    // one lens step: reveal the selected edges' children (zoom in) or fold
    // the deepest selected frontier back into its parents (zoom out); the
    // revealed children / parents inherit the selection
    let next: Set<string>;
    let inherited: string[];
    if (deeper) {
      const r = zoomInIds(d, zoomed, sel);
      next = r.next;
      inherited = r.revealed;
    } else {
      const r = zoomOutIds(d, zoomed, sel);
      next = r.next;
      inherited = r.parents;
    }
    if (inherited.length === 0) return; // nothing to reveal/collapse: camera only
    if (deeper) {
      // remember the spread so a later selection-less squeeze can undo it
      zoomHistoryRef.current.push(inherited);
    } else if (fromHistory) {
      zoomHistoryRef.current.pop(); // the spread this collapse undoes
    }
    zoomedIdsRef.current = next;
    setZoomedIds(next);
    const visible = new Set(visibleEdges(d, next).map((e) => e.id));
    setZoomEdgeIds([
      ...sel.filter((id) => visible.has(id)),
      ...inherited,
    ]);
    // the visible node set changed, so re-derive the camera and solve the
    // pan that keeps the anchor world point fixed:
    // viewport = screen - world * scale - camOffset
    const newCam = composedCam(
      computeFitView(deriveViewModel(d, next).nodes, { width, height }),
      userScaleRef.current,
      { width, height },
    );
    setViewport({
      x: mx - wx * newCam.scale - newCam.x,
      y: my - wy * newCam.scale - newCam.y,
    });
  };

  return {
    zoomEdgeIds,
    setZoomEdgeIds,
    zoomEdgeIdsRef,
    zoomedIds,
    setZoomedIds,
    zoomedIdsRef,
    selectionLocked,
    setSelectionLocked,
    selectionLockedRef,
    zoomHistoryRef,
    zoomSelectionStep,
  };
}
