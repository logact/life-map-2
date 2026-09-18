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

// the first-launch seed: one real life — this app's development, gym, and
// English learning — built entirely through the same commands the UI drives,
// so the document obeys every invariant a user-built one does. Each area is
// ONE directed road: it starts at the first step and ends at the main goal
// as the destination, so progress reads as travel along the road (each
// segment takes the status of the step it leads to). Records dot the
// roadside; detail hides inside expanded segments.
//
// Only the timestamps cheat: commands stamp Date.now(), so the real history
// (June → September 2026) is patched in by the final recipe below.
// Colors are picks from the Okabe-Ito palette (src/ui/palette.ts).
// What the model could NOT express is recorded in GAPS.md.

const BLUE = "#0072B2";
const ORANGE = "#E69F00";
const GREEN = "#009E73";

const at = (month: number, day: number, hour = 10): number => new Date(2026, month - 1, day, hour).getTime();

interface Backdate {
  startedAt?: number;
  completedAt?: number;
  occurredAt?: number;
  createdAt?: number;
  targetDate?: number;
}

export function buildSeedDoc(cx: number, cy: number): LifeMapDoc {
  const steps: Recipe[] = [];
  const dates = new Map<Id, Backdate>();
  const noteDates = new Map<Id, { createdAt: number; updatedAt: number }>();

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
  // a step on a road: a free-standing task the road passes through
  const step = (title: string, x: number, y: number): Id => free("task", title, "", x, y);
  // a road segment from -> to, colored by its area
  const road = (fromId: Id, toId: Id, color: string): Id => {
    const c = connectNodes(fromId, toId);
    steps.push(c.recipe, setEdgeColor(c.edgeId, color));
    return c.edgeId;
  };
  // a record dots the roadside of the step it belongs to
  const record = (parentId: Id, title: string, noteText: string, x: number, y: number, when: number): Id => {
    const c = addChildNode(parentId, "record", title, noteText, { x, y });
    steps.push(c.recipe);
    dates.set(c.nodeId, { occurredAt: when, createdAt: when });
    return c.nodeId;
  };
  const done = (id: Id, startedAt: number, completedAt: number) => {
    steps.push(transitionNodeStatus(id, "start"), transitionNodeStatus(id, "complete"));
    dates.set(id, { startedAt, completedAt });
  };
  const started = (id: Id, since: number) => {
    steps.push(transitionNodeStatus(id, "start"));
    dates.set(id, { startedAt: since });
  };
  const note = (id: Id, text: string, createdAt: number, updatedAt = createdAt) => {
    const c = addNote(id, text);
    steps.push(c.recipe);
    noteDates.set(c.noteId, { createdAt, updatedAt });
  };

  // ---- road 1: this app, from a working canvas to a daily driver ----
  const appGoal = goal("Life Map App", "Make Life Map 2 my daily-driver planner", cx + 360, cy - 230, BLUE);
  dates.set(appGoal, { targetDate: at(10, 15) });
  note(appGoal, "North star: one infinite map, no lists.", at(6, 8));
  note(appGoal, "Backlog: habit recurrence? map export?", at(9, 16));

  const sCore = step("Core canvas & gestures", cx - 380, cy - 230);
  done(sCore, at(6, 15), at(7, 12));
  record(sCore, "First map rendered on canvas", "just dots and lines, but mine", cx - 420, cy - 320, at(6, 14));
  record(sCore, "Ran on my phone via Expo Go", "", cx - 330, cy - 330, at(6, 28));

  const sPersist = step("Persistence, undo, layers", cx - 190, cy - 230);
  done(sPersist, at(7, 20), at(8, 28));
  record(sPersist, "Undo/redo saved me from a mis-drag", "", cx - 190, cy - 330, at(8, 22));

  const sPolish = step("Polish: routes, notes, search", cx - 10, cy - 230);
  started(sPolish, at(9, 5));

  // the last stretch is a checklist, not a single step: the four tasks fan
  // out under it and the road continues when they are all done
  const sTrust = step("Trust blockers", cx + 160, cy - 230);
  started(sTrust, at(9, 10));
  const trustItems: [string, number, number, number?][] = [
    ["Fix bugs from BUGS.md", cx + 70, cy - 110, at(9, 10)],
    ["Seed my real life data", cx + 170, cy - 90, at(9, 17)],
  ];
  for (const [title, x, y, since] of trustItems) {
    const c = addChildNode(sTrust, "task", title, "", { x, y });
    steps.push(c.recipe);
    if (since) started(c.nodeId, since);
  }
  for (const [title, x, y] of [
    ["App icon & splash screen", cx + 250, cy - 120],
    ["Backup/export my map", cx + 320, cy - 70],
  ] as const) {
    steps.push(addChildNode(sTrust, "task", title, "", { x, y }).recipe);
  }

  road(sCore, sPersist, BLUE);
  road(sPersist, sPolish, BLUE);
  road(sPolish, sTrust, BLUE);
  road(sTrust, appGoal, BLUE);

  // ---- road 2: the gym, from gear to the big lifts ----
  const gymGoal = goal(
    "Get Stronger",
    "Consistent gym habit + progressive overload: squat 100 kg, bench 70 kg, deadlift 120 kg",
    cx + 440,
    cy + 40,
    ORANGE,
  );

  const sGear = step("Gear up & learn form", cx - 360, cy + 40);
  done(sGear, at(6, 15), at(6, 20));
  record(sGear, "Bought lifting shoes", "last excuse gone", cx - 420, cy + 120, at(6, 20));

  // the program milestone sits mid-road; the segment into it expands into
  // the two halves of the program (zoom the segment to see them)
  const sProgram = free("goal", "12-week beginner program", "", cx - 120, cy + 40);
  steps.push(transitionNodeStatus(sProgram, "complete"));
  dates.set(sProgram, { targetDate: at(9, 13), completedAt: at(9, 13) });
  record(sProgram, "Week 12 done — 12 weeks straight", "", cx - 120, cy - 50, at(9, 13));

  const gearToProgram = road(sGear, sProgram, ORANGE);
  const w1 = expandEdge(gearToProgram, { dx: 0, dy: -40 });
  steps.push(w1.recipe, renameNode(w1.midNodeId, "Weeks 1–6"));
  done(w1.midNodeId, at(6, 22), at(8, 2));
  const w2 = expandEdge(w1.childEdgeIds[1], { dx: 0, dy: -40 });
  steps.push(w2.recipe, renameNode(w2.midNodeId, "Weeks 7–12"));
  done(w2.midNodeId, at(8, 3), at(9, 13));

  // the habit is not a gate on the road — it runs alongside it, anchored at
  // the program that built it
  const habit = free("task", "Gym 3x/week", "", cx - 120, cy + 160);
  steps.push(connectNodes(sProgram, habit).recipe);
  started(habit, at(6, 22));
  record(habit, "Skipped a week — work crunch", "back on it the week after", cx - 220, cy + 220, at(8, 17));

  const sSquat = step("Squat 100 kg", cx + 40, cy + 40);
  started(sSquat, at(9, 14));
  note(sSquat, "Current: 90×5. Brace, knees out, hips back.", at(9, 14));
  record(sSquat, "Squat 90×5 — PR", "", cx + 40, cy + 130, at(9, 8));

  const sBench = step("Bench 70 kg", cx + 170, cy + 40);
  started(sBench, at(9, 14));
  record(sBench, "Bench 60×8", "", cx + 170, cy + 130, at(9, 11));

  const sDeadlift = step("Deadlift 120 kg", cx + 300, cy + 40);
  record(sDeadlift, "Deadlift 105×3 — current best", "", cx + 300, cy + 130, at(9, 15));

  road(sProgram, sSquat, ORANGE);
  road(sSquat, sBench, ORANGE);
  road(sBench, sDeadlift, ORANGE);
  road(sDeadlift, gymGoal, ORANGE);

  // ---- road 3: english, from daily contact to speaking ----
  const engGoal = goal(
    "English",
    "General improvement — steady daily contact, no exam",
    cx + 330,
    cy + 310,
    GREEN,
  );
  note(engGoal, "Weakest: speaking speed. Listening much better since June.", at(9, 12));

  const sWords = step("Anki & weekly journal", cx - 330, cy + 310);
  started(sWords, at(6, 21));
  record(sWords, "First journal entry", "", cx - 370, cy + 400, at(6, 21));
  record(sWords, "1,500 words in Anki", "", cx - 280, cy + 410, at(8, 2));

  const sListen = step("Listening without subtitles", cx - 170, cy + 310);
  started(sListen, at(7, 6));
  record(sListen, "Followed a whole podcast episode", "", cx - 170, cy + 400, at(8, 25));

  const sBook = step("Read a whole book", cx - 10, cy + 310);
  done(sBook, at(6, 25), at(8, 30));
  record(sBook, "Finished Atomic Habits", "took two months, worth it", cx - 10, cy + 410, at(8, 30));

  const sPartner = step("Find a language partner", cx + 150, cy + 310);

  road(sWords, sListen, GREEN);
  road(sListen, sBook, GREEN);
  road(sBook, sPartner, GREEN);
  road(sPartner, engGoal, GREEN);

  // the three areas are parallel — no invented cross-links: a road between
  // goals is earned by a real dependency, and there isn't one yet
  goal("Ideas", "Parking lot for unplaced thoughts", cx + 20, cy + 150, "#999933"); // isolated on purpose

  // real history: patch every timestamp the commands stamped as "now"
  steps.push((draft) => {
    for (const [id, d] of dates) {
      const n = draft.nodes[id];
      if (!n) continue;
      if (d.startedAt !== undefined) n.startedAt = d.startedAt;
      if (d.completedAt !== undefined) n.completedAt = d.completedAt;
      if (d.occurredAt !== undefined) n.occurredAt = d.occurredAt;
      if (d.createdAt !== undefined) n.createdAt = d.createdAt;
      if (d.targetDate !== undefined) n.targetDate = d.targetDate;
    }
    for (const node of Object.values(draft.nodes)) {
      for (const n of node.notes) {
        const t = noteDates.get(n.id);
        if (t) {
          n.createdAt = t.createdAt;
          n.updatedAt = t.updatedAt;
        }
      }
    }
  });

  let doc = emptyDoc();
  for (const recipe of steps) {
    doc = produce(doc, recipe);
  }
  return doc;
}
