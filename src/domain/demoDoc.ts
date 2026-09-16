import { produce } from "immer";

import {
  addChildNode,
  addFreeNode,
  connectNodes,
  expandEdge,
  Recipe,
  transitionNodeStatus,
} from "./commands";
import { emptyDoc, Id, LifeMapDoc, NodeKind } from "./doc";

// the first-launch demo map, built entirely through commands so the seeded
// document obeys the same invariants as a user-built one
export function buildDemoDoc(cx: number, cy: number): LifeMapDoc {
  const steps: Recipe[] = [];

  const free = (kind: NodeKind, title: string, x: number, y: number): Id => {
    const c = addFreeNode(kind, title, "", { x, y });
    steps.push(c.recipe);
    return c.nodeId;
  };
  const goal = (title: string, x: number, y: number) => free("goal", title, x, y);
  const task = (title: string, x: number, y: number) => free("task", title, x, y);
  const child = (parentId: Id, kind: NodeKind, title: string, detail: string, x: number, y: number): Id => {
    const c = addChildNode(parentId, kind, title, detail, { x, y });
    steps.push(c.recipe);
    return c.nodeId;
  };
  const connect = (fromId: Id, toId: Id): Id => {
    const c = connectNodes(fromId, toId);
    steps.push(c.recipe);
    return c.edgeId;
  };
  const status = (id: Id, action: "start" | "pause" | "complete" | "reopen") =>
    steps.push(transitionNodeStatus(id, action));

  // ---- root goals ----
  const health = goal("Health", cx, cy - 160);
  const career = goal("Career", cx - 140, cy + 80);
  const family = goal("Family", cx + 140, cy + 80);
  const friends = goal("Friends", cx + 20, cy + 220);
  goal("Learning", cx - 180, cy + 200); // isolated: no edges, only rootNodeIds

  // ---- branch A: Health -> Career, the deep multi-branch one ----
  const healthCareer = connect(health, career);
  const hcX = expandEdge(healthCareer, { dx: -40, dy: 0 }); // health -> hc1 -> career
  steps.push(hcX.recipe);
  const hc1 = hcX.midNodeId;

  const link1 = hcX.childEdgeIds[0]; // health -> hc1
  const hc2X = expandEdge(link1, { dx: -60, dy: 0 }); // health -> hc2 -> hc1
  steps.push(hc2X.recipe);
  const hc2 = hc2X.midNodeId;

  const link2 = hc2X.childEdgeIds[1]; // hc2 -> hc1
  const hc3X = expandEdge(link2, { dx: 40, dy: 0 }); // hc2 -> hc3 -> hc1
  steps.push(hc3X.recipe);

  // a road partially traveled: hc2 done, hc3 in progress (the frontier)
  status(hc2, "complete");
  status(hc3X.midNodeId, "start");

  // multiple branches: extra child edges hanging off the same parents
  const sideA = goal("Side A", cx - 10, cy + 10);
  const sideAEdge = connectNodes(hc1, sideA, healthCareer); // layer-1 sibling of the chain
  steps.push(sideAEdge.recipe);
  const sideB = goal("Side B", cx - 190, cy - 60);
  const sideBEdge = connectNodes(hc2, sideB, link1); // layer-2 sibling
  steps.push(sideBEdge.recipe);

  // ---- branch B: Health -> Family, stops at layer 1 ----
  const healthFamily = connect(health, family);
  steps.push(expandEdge(healthFamily, { dx: 40, dy: 0 }).recipe);

  // ---- branch C: Career -> Friends, stays at layer 0 ----
  connect(career, friends);

  // ---- tasks and a record under Health ----
  // one task per status; Health is completed MANUALLY, so the goal shows
  // done while Sleep is still in progress (manual completion wins)
  const runTask = child(health, "task", "Run 5km", "", cx - 80, cy - 280);
  const sleepTask = child(health, "task", "Sleep 8h", "", cx + 80, cy - 280);
  child(health, "task", "Gym 3x/week", "", cx + 160, cy - 240); // stays todo
  status(runTask, "complete");
  status(sleepTask, "start");
  status(health, "complete");
  child(runTask, "record", "Ran 4.8km", "felt good", cx - 80, cy - 370);

  // ---- tasks under Family: one done, one todo -> Family derives in-progress ----
  const callMom = child(family, "task", "Call mom", "", cx + 250, cy + 20);
  child(family, "task", "Plan trip", "", cx + 250, cy + 170);
  status(callMom, "complete");

  // ---- route query test: many parallel roads between two nodes ----
  // Five distinct directed paths of different lengths (some sharing
  // segments), a dead end that must NOT appear in the results, and a
  // back-road whose wrong direction must NOT be traversable. Querying
  // "RT Start" -> "RT End" should list 5 candidate routes.
  const rtStart = goal("RT Start", cx - 160, cy + 360);
  const rtEnd = goal("RT End", cx + 160, cy + 360);

  connect(rtStart, rtEnd); // path 1: direct

  const rtA = task("RT A1", cx, cy + 310); // path 2: 2 steps
  connect(rtStart, rtA);
  connect(rtA, rtEnd);

  const rtB1 = task("RT B1", cx - 70, cy + 430); // path 3: 3 steps
  const rtB2 = task("RT B2", cx + 70, cy + 450);
  connect(rtStart, rtB1);
  connect(rtB1, rtB2);
  connect(rtB2, rtEnd);

  const rtC1 = task("RT C1", cx - 30, cy + 530); // path 4: merges into path 3 at RT B2
  connect(rtStart, rtC1);
  connect(rtC1, rtB2);

  const rtD1 = task("RT D1", cx - 110, cy + 290); // path 5: merges into path 2 at RT A1
  connect(rtStart, rtD1);
  connect(rtD1, rtA);

  const rtX = task("RT X", cx - 270, cy + 430); // dead end: never reaches RT End
  const rtY = task("RT Y", cx - 330, cy + 500);
  connect(rtStart, rtX);
  connect(rtX, rtY);

  const rtZ = task("RT Z", cx + 270, cy + 430); // back-road: directed End -> Z -> Start
  connect(rtEnd, rtZ);
  connect(rtZ, rtStart);

  let doc = emptyDoc();
  for (const step of steps) {
    doc = produce(doc, step);
  }
  return doc;
}
