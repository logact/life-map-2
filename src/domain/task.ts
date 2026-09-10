import { v4 } from "uuid";
import { Edge } from "./edge";
import { Node, NodeKind } from "./node";
import { Status } from "./status";

export class Task implements Node {
    x: number;
    y: number;
    id: string;
    title: string;
    kind: NodeKind = "task";
    status: Status = "todo";
    startedAt?: Date;
    completedAt?: Date;
    startEdges: Edge[];
    endEdges: Edge[];
    constructor(x: number, y: number, title: string, startEdges: Edge[], endEdges: Edge[]) {
        this.x = x;
        this.y = y;
        this.title = title
        this.id = v4()
        this.startEdges = startEdges
        this.endEdges = endEdges
    }
}
