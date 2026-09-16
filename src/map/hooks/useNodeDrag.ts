import { useState } from "react";

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

  const onNodeDragStart = (id: string, x: number, y: number) => {
    params.closeOverlays();
    // spotlight the dragged node's directly-connected edges (visual only)
    params.setNodeFocusId(id);
    setDrag({ id, x, y });
  };
  const onNodeDragMove = (id: string, x: number, y: number) => setDrag({ id, x, y });
  const onNodeDragEnd = (id: string, x: number, y: number) => {
    setDrag(null);
    setDragArmedId(null);
    const node = useDocStore.getState().doc.nodes[id];
    if (!node || (node.x === x && node.y === y)) return;
    params.run(moveNode(id, x, y));
  };

  return { drag, dragArmedId, setDragArmedId, onNodeDragStart, onNodeDragMove, onNodeDragEnd };
}
