import { v4 } from "uuid";
import { Edge } from "./edge";
import { Node, NodeKind } from "./node";
import { Note } from "./note";

export class Record implements Node {
    x: number;
    y: number;
    id: string;
    title: string;
    kind: NodeKind = "record";
    color: string | undefined;
    notes: Note[] = [];
    createdAt: Date;
    note: string;
    startEdges: Edge[];
    endEdges: Edge[];
    occuredAt: Date;
    constructor(x: number, y: number, title: string, startEdges: Edge[], endEdges: Edge[], note: string = "",occuredAt:Date) {
        this.x = x;
        this.y = y;
        this.title = title
        this.id = v4()
        this.createdAt = new Date()
        this.note = note
        this.startEdges = startEdges
        this.endEdges = endEdges
        this.occuredAt = occuredAt
    }
}
