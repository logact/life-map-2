import { useLayoutEffect, useRef, useState } from "react";

import { moveNode, Recipe } from "@/domain/commands";
import { useDocStore } from "@/state/docStore";

// node drag = "reposition one node": the live position is UI state so
// the node and its edges follow the finger, then on release the new
// world position is committed to the domain through run(). Only an
// armed (long-pressed) node can be dragged.
export function useNodeDrag(params: {
  run: (recipe: Recipe) => void;
  closeOverlays: () => void;
  setNodeFocusId: (id: string | null) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  // long-press arms a node for dragging; the drag itself lives in `drag`
  const [dragArmedId, setDragArmedId] = useState<string | null>(null);

  // the handlers go to memoized node glyphs, so they are created ONCE and
  // read the latest params through a ref — a fresh closure per render
  // would defeat the memo (same pattern as the pan responders)
  const latest = useRef(params);
  useLayoutEffect(() => {
    latest.current = params;
  });
  const [handlers] = useState(() => ({
    onNodeDragStart: (id: string, x: number, y: number) => {
      latest.current.closeOverlays();
      // spotlight the dragged node's directly-connected edges (visual only)
      latest.current.setNodeFocusId(id);
      setDrag({ id, x, y });
    },
    onNodeDragMove: (id: string, x: number, y: number) => setDrag({ id, x, y }),
    onNodeDragEnd: (id: string, x: number, y: number) => {
      setDrag(null);
      setDragArmedId(null);
      const node = useDocStore.getState().doc.nodes[id];
      if (!node || (node.x === x && node.y === y)) return;
      latest.current.run(moveNode(id, x, y));
    },
  }));

  return { drag, dragArmedId, setDragArmedId, ...handlers };
}
