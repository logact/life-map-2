import { NodeKind, Status } from "@/domain/doc";

// ---------- View models: plain data describing what to draw ----------
// The UI renders ONLY from these. It never renders domain objects directly.

export interface NodeViewModel {
  id: string;
  x: number;
  y: number;
  title: string;
  kind: NodeKind;
  status?: Status;
  // a recurring task shows the habit badge on its pin
  recurring?: boolean;
}

export interface EdgeViewModel {
  id: string;
  fromId: string;
  toId: string;
  layer: number;
  status: Status | null;
  bend?: { x: number; y: number };
  // hidden sub-edges of a collapsed edge; the line is broken into this
  // many equal-length segments
  hiddenCount: number;
  // one entry per direct child edge, in order: its status
  segments?: { status: Status | null }[];
}

export interface MapViewModel {
  nodes: NodeViewModel[];
  edges: EdgeViewModel[];
}

// what the create form is making: a free node of any kind at a world
// position, a node attached under a parent node (create + connect), or —
// the "Be added to" direction — a new node that becomes the PARENT of an
// existing child
export type CreateTarget =
  | { mode: "goal" | "task" | "record"; x: number; y: number }
  | { mode: "goal"; parentId: string }
  | { mode: "task" | "record"; parentId: string }
  | { mode: "goal" | "task" | "record"; childId: string };

// what the info card shows: the last single-tapped node or edge
export type InfoTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };
