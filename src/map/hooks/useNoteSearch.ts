import { RefObject, useState } from "react";
import { Keyboard } from "react-native";

import { computeFitView } from "@/map/fitZoom";
import { edgeDepth, LifeMapDoc } from "@/domain/doc";
import { searchNotes } from "@/domain/search";
import { revealEdge } from "@/domain/visibility";
import { useDocStore } from "@/state/docStore";
import { InfoTarget } from "../types";
import { composedCam } from "../utils";
import { deriveViewModel } from "../viewModel";

// note query flow: keyword search across every note on the map. The hook
// owns only its own state; the screen composes the mutual exclusion with
// the other modes (route query, connect, summarize, …)
export function useNoteSearch(params: {
  doc: LifeMapDoc;
  width: number;
  height: number;
  userScaleRef: RefObject<number>;
  setViewport: (v: { x: number; y: number }) => void;
  zoomedIdsRef: RefObject<Set<string>>;
  setZoomedIds: (s: Set<string>) => void;
  setInfoTarget: (t: InfoTarget | null) => void;
}) {
  const { doc, width, height, userScaleRef, setViewport, zoomedIdsRef, setZoomedIds, setInfoTarget } = params;
  const [noteSearchMode, setNoteSearchMode] = useState(false);
  const [noteQuery, setNoteQuery] = useState("");

  const enterNoteSearchMode = () => {
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
    const d = useDocStore.getState().doc;
    const node = d.nodes[nodeId];
    if (!node) return;
    // the shallowest edge touching the node, at ANY layer: a node hidden
    // inside a collapsed edge has no visible touching edge, so the search
    // must cover hidden edges for the reveal to reach it
    const touching = Object.values(d.edges).filter(
      (e) => e.fromId === nodeId || e.toId === nodeId,
    );
    let nextZoom = zoomedIdsRef.current;
    if (touching.length > 0) {
      const shallowest = touching.reduce((a, b) =>
        edgeDepth(d, a.id) <= edgeDepth(d, b.id) ? a : b,
      );
      nextZoom = revealEdge(d, zoomedIdsRef.current, shallowest.id);
      zoomedIdsRef.current = nextZoom;
      setZoomedIds(nextZoom);
    }
    // the reveal changed the visible nodes, so derive the new camera from
    // them, then pan so the node lands at the screen center:
    // userPan = (screenCenter - world * scale) - camOffset
    const newCam = composedCam(
      computeFitView(deriveViewModel(d, nextZoom).nodes, { width, height }),
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

  // note search results over the whole map (hidden layers included),
  // recomputed on every render while the panel is open
  const noteResults = noteSearchMode ? searchNotes(doc, noteQuery) : [];

  return {
    noteSearchMode,
    noteQuery,
    setNoteQuery,
    noteResults,
    enterNoteSearchMode,
    exitNoteSearchMode,
    focusNoteNode,
  };
}
