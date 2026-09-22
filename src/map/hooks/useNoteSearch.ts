import { RefObject, useState } from "react";
import { Keyboard } from "react-native";

import { edgeDepth, LifeMapDoc } from "@/domain/doc";
import { searchNotes } from "@/domain/search";
import { revealEdge } from "@/domain/visibility";
import { useDocStore } from "@/state/docStore";
import { InfoTarget } from "../types";

// note query flow: keyword search across every note on the map. The hook
// owns only its own state; the screen composes the mutual exclusion with
// the other modes (route query, connect, summarize, …)
export function useNoteSearch(params: {
  doc: LifeMapDoc;
  // center a world point on screen (the camera owns the math)
  centerOnPoint: (wx: number, wy: number) => void;
  zoomedIdsRef: RefObject<Set<string>>;
  setZoomedIds: (s: Set<string>) => void;
  setInfoTarget: (t: InfoTarget | null) => void;
}) {
  const { doc, centerOnPoint, zoomedIdsRef, setZoomedIds, setInfoTarget } = params;
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
    // pan with the CURRENT camera (the reveal changed the visible nodes,
    // but the camera no longer derives from them) so the node lands at
    // the screen center
    centerOnPoint(node.x, node.y);
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
