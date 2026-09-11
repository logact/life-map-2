import { Edge } from "./edge";
import type Goal from "./goal";
import type { Note } from "./note";
import type { Task } from "./task";
import type { Record as RecordNode } from "./record";

export type NodeKind = "goal" | "task" | "record";

export interface Node {
    x: number,
    y: number,
    id: string,
    title: string,
    kind: NodeKind,
    color: string | undefined,
    notes: Note[],
    startEdges: Edge[],
    endEdges: Edge[],
}

export function isGoalNode(n: Node): n is Goal {
    return n.kind === "goal";
}

export function isTaskNode(n: Node): n is Task {
    return n.kind === "task";
}

export function isRecordNode(n: Node): n is RecordNode {
    return n.kind === "record";
}

export function createEmptyNode(kind: NodeKind = "goal"): Node {
    return {
        x: 0,
        y: 0,
        id: "",
        title: "",
        kind,
        color: undefined,
        notes: [],
        startEdges: [],
        endEdges: []
    }
}
