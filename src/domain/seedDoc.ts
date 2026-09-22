import { produce } from "immer";

import {
  addChildNode,
  addFreeNode,
  addNote,
  connectNodes,
  expandEdge,
  Recipe,
  renameNode,
  setNodeRecurrence,
  transitionNodeStatus,
} from "./commands";
import { emptyDoc, Id, LifeMapDoc, NodeKind } from "./doc";

// the first-launch seed: a self-guided tour of the app. ONE directed road
// walks a new user through the whole gesture language — tap, notes, drag,
// connect, goals, create, layers — and ends at the invitation to replace
// the tour with a life of their own. A habit branches off the roadside:
// repeating tasks never finish, they log. Built entirely through the same
// commands the UI drives, so the document obeys every invariant a
// user-built one does. The first lessons are pre-marked done and one is
// in-progress, so the three status colors are visible on first launch.
//
// A tutorial has no history, so no backdating: every timestamp is stamped
// honestly at build time — the habit's two logs are relative to the build,
// leaving it due today so the badge and the Log done button show.

export function buildSeedDoc(cx: number, cy: number): LifeMapDoc {
  const steps: Recipe[] = [];

  const free = (kind: NodeKind, title: string, detail: string, x: number, y: number): Id => {
    const c = addFreeNode(kind, title, detail, { x, y });
    steps.push(c.recipe);
    return c.nodeId;
  };
  const goal = (title: string, detail: string, x: number, y: number): Id =>
    free("goal", title, detail, x, y);
  // a lesson on the tour: a free-standing task the road passes through
  const lesson = (title: string, x: number, y: number): Id => free("task", title, "", x, y);
  // a road segment from -> to
  const road = (fromId: Id, toId: Id): Id => {
    const c = connectNodes(fromId, toId);
    steps.push(c.recipe);
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

  // the road climbs straight from the bottom of the map to the top — the
  // same direction new successors grow in, so the tour teaches the map's
  // reading direction by example
  const ry = (i: number) => Math.round(cy + 350 - i * 100);

  const sTap = lesson("Tap any node — its card opens below", cx, ry(0));
  done(sTap);
  note(sTap, "The card holds the dates, the status buttons, and the title — tap the title to edit it in place.");
  record(
    sTap,
    "Records are dated dots",
    "A moment on a step's roadside. Records are leaves: nothing attaches under them.",
    cx - 90,
    ry(0) + 20,
  );

  const sNotes = lesson("Notes hide one tap deeper", cx, ry(1));
  done(sNotes);
  // notes stack newest-first: the older line goes in first, so the card's
  // peek shows the one that explains the sheet
  note(sNotes, "Goals, tasks, and records all carry notes like this one.");
  note(sNotes, "Tap the peeked note on my card to open the full sheet — add, edit, delete.");

  const sDrag = lesson("Long-press to drag me anywhere", cx, ry(2));
  started(sDrag);
  note(sDrag, "Long-press a node to move it. Long-press an edge, then drag, to bend it.");

  const sConnect = lesson("Connect: drag from my ring to another node", cx, ry(3));
  note(
    sConnect,
    "Tap a node to focus it — the ring is its connect handle. Drag direction = road direction; drop anywhere else to cancel.",
  );

  // the mid-road milestone shows what a reached goal looks like: green,
  // struck through, marked done by hand
  const gMilestone = goal(
    "Goals are the destinations",
    "Every road ends at a goal. Reach one, tap it, Mark done — Reopen undoes it.",
    cx,
    ry(4),
  );
  steps.push(transitionNodeStatus(gMilestone, "complete"));

  const sCreate = lesson("Double-tap empty space to create", cx, ry(5));
  note(sCreate, "Goal, task, or record at the tapped point. The same menu can reload this tutorial.");

  // a habit branches off the roadside: a repeating task never finishes —
  // it logs each occurrence. Two logs (yesterday and the day before) leave
  // it due today, so the pin badge and the Log done button demo live
  const DAY = 86400000;
  const habit = free("task", "Habits repeat — log me once a day", "", cx + 110, ry(5) - 10);
  steps.push(
    setNodeRecurrence(habit, { freq: "daily", interval: 1, anchor: Date.now() - 2 * DAY }),
    transitionNodeStatus(habit, "complete", Date.now() - 2 * DAY),
    transitionNodeStatus(habit, "complete", Date.now() - DAY),
  );
  note(habit, "Tap my card's Repeat row to change the rhythm. Miss a day and I ask again — the streak keeps count.");

  const sLayers = lesson("Roads have layers — pinch to peek inside", cx, ry(6));
  note(
    sLayers,
    "The road into me hides two steps. Pinch spread — or tap the segment and Zoom in — to reveal them; squeeze folds back.",
  );

  const gYours = goal(
    "Make this map yours",
    "Rename me, drag me, delete me — then double-tap the canvas and start your own road. Undo is top-right, always.",
    cx,
    ry(7),
  );

  road(sTap, sNotes);
  road(sNotes, sDrag);
  road(sDrag, sConnect);
  road(sConnect, gMilestone);
  road(gMilestone, sCreate);
  road(sCreate, habit);
  // the last stretch is layered: two micro-lessons hide inside the segment
  // (pinch or Zoom in on it to see them)
  const intoLayers = road(sCreate, sLayers);
  const z1 = expandEdge(intoLayers);
  steps.push(z1.recipe, renameNode(z1.midNodeId, "Spread to zoom into a road"));
  const z2 = expandEdge(z1.childEdgeIds[1]);
  steps.push(z2.recipe, renameNode(z2.midNodeId, "Squeeze to fold it back"));
  road(sLayers, gYours);

  // stray thoughts park off the road until they earn one — isolated on purpose
  goal("Ideas", "Park stray thoughts here — no road until one is earned.", cx + 110, cy + 270);

  let doc = emptyDoc();
  for (const recipe of steps) {
    doc = produce(doc, recipe);
  }
  return doc;
}
