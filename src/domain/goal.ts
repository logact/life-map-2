import { v4 } from "uuid";
import { Edge } from "./edge";
import { Node, NodeKind } from "./node";
import { Note } from "./note";

export default class Goal implements Node {
    x: number;
    y: number;
    id: string;
    title: string;
    kind: NodeKind = "goal";
    color: string | undefined;
    notes: Note[] = [];
    description?: string;
    targetDate?: Date;
    completedAt?: Date;
    startEdges: Edge[];
    endEdges: Edge[];
    constructor(x: number, y: number, title: string, startEdges: Edge[], endEdges: Edge[], description?: string, targetDate?: Date) {
        this.x = x;
        this.y = y;
        this.title = title
        this.id = v4()
        this.startEdges = startEdges
        this.endEdges = endEdges
        this.description = description
        this.targetDate = targetDate
    }

}
