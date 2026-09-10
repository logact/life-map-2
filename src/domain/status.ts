import Goal from "./goal";
import { Task } from "./task";
import { Edge } from "./edge";
import { isGoalNode, isRecordNode, isTaskNode, Node } from "./node";

export type Status = "todo" | "in-progress" | "done";

// ---------- Task machine ----------
//
// todo --start--> in-progress --complete--> done
//  ^ ----pause----       |                    |
//  |                     |                    |
//  +--------complete-----+                    |
//  ^                                            |
//  +-----------------reopen--------------------+

export function startTask(task: Task): Task {
    if (task.status !== "todo") throw new Error(`cannot start a ${task.status} task`);
    task.status = "in-progress";
    task.startedAt ??= new Date(); // startedAt records the FIRST start, never cleared
    return task;
}

export function pauseTask(task: Task): Task {
    if (task.status !== "in-progress") throw new Error(`cannot pause a ${task.status} task`);
    task.status = "todo";
    return task;
}

export function completeTask(task: Task): Task {
    if (task.status === "done") throw new Error("task is already done");
    task.status = "done";
    task.completedAt = new Date();
    return task;
}

export function reopenTask(task: Task): Task {
    if (task.status !== "done") throw new Error(`cannot reopen a ${task.status} task`);
    task.status = "todo";
    task.completedAt = undefined;
    return task;
}

// ---------- Goal status: derived from tasks, never stored ----------
//
// manual completion (completedAt set) wins; otherwise roll up child tasks.
// Nothing cascades: completing a goal does not touch its tasks.

export function goalStatus(goal: Goal): Status {
    if (goal.completedAt) return "done";
    const tasks = goal.startEdges.map(e => e.node2).filter(isTaskNode);
    if (tasks.length === 0) return "todo";
    if (tasks.every(t => t.status === "done")) return "done";
    if (tasks.some(t => t.status !== "todo")) return "in-progress";
    return "todo";
}

export function completeGoal(goal: Goal): Goal {
    goal.completedAt = new Date();
    return goal;
}

export function reopenGoal(goal: Goal): Goal {
    goal.completedAt = undefined; // falls back to derivation
    return goal;
}

// ---------- Edge status: frontier semantics ----------
//
// An edge shows the status of the first unfinished step on the road it
// represents: walk the hidden child chain -> node2, take the first
// non-done status; if everything is done, the road is done. The source
// node's own status is skipped — it is already drawn on the node itself,
// and a goal's rollup would otherwise drown out every task behind it.
// Records have no status, so edges touching one stay plain (null).

export function nodeStatus(n: Node): Status | null {
    if (isTaskNode(n)) return n.status;
    if (isGoalNode(n)) return goalStatus(n);
    return null;
}

// the chain an edge stands for, in travel order: expand() children form
// node1 -> ... -> node2; side-branch children follow in insertion order
function flattenChain(edge: Edge): Node[] {
    if (edge.childrenEdges.length === 0) return [edge.node1, edge.node2];
    const seq: Node[] = [];
    for (const child of edge.childrenEdges) {
        const part = flattenChain(child);
        if (seq.length > 0 && seq[seq.length - 1].id === part[0].id) part.shift();
        seq.push(...part);
    }
    return seq;
}

export function edgeStatus(edge: Edge): Status | null {
    if (isRecordNode(edge.node1) || isRecordNode(edge.node2)) return null;
    for (const n of flattenChain(edge).slice(1)) {
        const s = nodeStatus(n);
        if (s !== null && s !== "done") return s;
    }
    return "done";
}
