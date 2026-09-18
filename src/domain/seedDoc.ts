import { produce } from "immer";

import {
  addChildNode,
  addFreeNode,
  addNote,
  connectNodes,
  expandEdge,
  Recipe,
  renameNode,
  setEdgeColor,
  setNodeColor,
  transitionNodeStatus,
} from "./commands";
import { emptyDoc, Id, LifeMapDoc, NodeKind } from "./doc";

// the first-launch seed: a self-guided tour of the app. ONE directed road
// walks a new user through the whole gesture language — tap, notes, drag,
// connect, goals, create, layers — and ends at the invitation to replace
// the tour with a life of their own. Built entirely through the same
// commands the UI drives, so the document obeys every invariant a
// user-built one does. The first lessons are pre-marked done and one is
// in-progress, so the three status styles are visible on first launch.
//
// A tutorial has no history, so no backdating: every timestamp is stamped
// honestly at build time. Colors are picks from the Okabe-Ito palette
// (src/ui/palette.ts).

const BLUE = "#0072B2";

export function buildSeedDoc(cx: number, cy: number): LifeMapDoc {
  const steps: Recipe[] = [];

  const free = (kind: NodeKind, title: string, detail: string, x: number, y: number): Id => {
    const c = addFreeNode(kind, title, detail, { x, y });
    steps.push(c.recipe);
    return c.nodeId;
  };
  const goal = (title: string, detail: string, x: number, y: number, color: string): Id => {
    const id = free("goal", title, detail, x, y);
    steps.push(setNodeColor(id, color));
    return id;
  };
  // a lesson on the tour: a free-standing task the road passes through
  const lesson = (title: string, x: number, y: number): Id => free("task", title, "", x, y);
  // a road segment from -> to, in the tour's color
  const road = (fromId: Id, toId: Id): Id => {
    const c = connectNodes(fromId, toId);
    steps.push(c.recipe, setEdgeColor(c.edgeId, BLUE));
    return c.edgeId;
  };
  // a record dots the roadside of the lesson it belongs to
  const record = (parentId: Id, title: string, noteText: string, x: number, y: number): Id => {
    const c = addChildNode(parentId, "record", title, noteText, { x, y });
    steps.push(c.recipe);
    return c.nodeId;
  };
  const done = (id: Id) => {
    steps.push(transitionNodeStatus(id, "start"), transitionNodeStatus(id, "complete"));
  };
  const started = (id: Id) => {
    steps.push(transitionNodeStatus(id, "start"));
  };
  const note = (id: Id, text: string) => {
    steps.push(addNote(id, text).recipe);
  };

  const ROAD = cy - 40;

  const sTap = lesson("Tap any node — its card opens below", cx - 560, ROAD);
  done(sTap);
  note(sTap, "The card holds the dates, the status buttons, and the title — tap the title to edit it in place.");
  record(
    sTap,
    "Records are dated dots",
    "A moment on a step's roadside. Records are leaves: nothing attaches under them.",
    cx - 630,
    ROAD + 90,
  );

  const sNotes = lesson("Notes hide one tap deeper", cx - 400, ROAD);
  done(sNotes);
  // notes stack newest-first: the older line goes in first, so the card's
  // peek shows the one that explains the sheet
  note(sNotes, "Goals, tasks, and records all carry notes like this one.");
  note(sNotes, "Tap the peeked note on my card to open the full sheet — add, edit, delete.");

  const sDrag = lesson("Long-press to drag me anywhere", cx - 240, ROAD);
  started(sDrag);
  note(sDrag, "Long-press a node to move it. Long-press an edge, then drag, to bend it.");

  const sConnect = lesson("Connect: drag from my ring to another node", cx - 80, ROAD);
  note(
    sConnect,
    "Tap a node to focus it — the ring is its connect handle. Drag direction = road direction; drop anywhere else to cancel.",
  );

  // the mid-road milestone shows what a reached goal looks like: solid,
  // struck through, marked done by hand
  const gMilestone = goal(
    "Goals are the destinations",
    "Every road ends at a goal. Reach one, tap it, Mark done — Reopen undoes it.",
    cx + 80,
    ROAD,
    BLUE,
  );
  steps.push(transitionNodeStatus(gMilestone, "complete"));

  const sCreate = lesson("Double-tap empty space to create", cx + 240, ROAD);
  note(sCreate, "Goal, task, or record at the tapped point. The same menu can reload this tutorial.");

  const sLayers = lesson("Roads have layers — pinch to peek inside", cx + 400, ROAD);
  note(
    sLayers,
    "The road into me hides two steps. Pinch spread — or tap the segment and Zoom in — to reveal them; squeeze folds back.",
  );

  const gYours = goal(
    "Make this map yours",
    "Rename me, drag me, delete me — then double-tap the canvas and start your own road. Undo is top-right, always.",
    cx + 560,
    ROAD,
    BLUE,
  );

  road(sTap, sNotes);
  road(sNotes, sDrag);
  road(sDrag, sConnect);
  road(sConnect, gMilestone);
  road(gMilestone, sCreate);
  // the last stretch is layered: two micro-lessons hide inside the segment
  // (pinch or Zoom in on it to see them)
  const intoLayers = road(sCreate, sLayers);
  const z1 = expandEdge(intoLayers, { dx: 0, dy: -40 });
  steps.push(z1.recipe, renameNode(z1.midNodeId, "Spread to zoom into a road"));
  const z2 = expandEdge(z1.childEdgeIds[1], { dx: 0, dy: -40 });
  steps.push(z2.recipe, renameNode(z2.midNodeId, "Squeeze to fold it back"));
  road(sLayers, gYours);

  // stray thoughts park off the road until they earn one — isolated on purpose
  goal("Ideas", "Park stray thoughts here — no road until one is earned.", cx, cy + 150, "#999933");

  let doc = emptyDoc();
  for (const recipe of steps) {
    doc = produce(doc, recipe);
  }
  return doc;
}
