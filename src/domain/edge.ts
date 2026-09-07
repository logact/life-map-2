import { v4 as uuidv4 } from 'uuid';
import { Node } from "./node";

export class Edge {
    node1: Node
    node2: Node
    parentEdge: Edge | undefined
    childrenEdges: Edge[] = [] 
    id: string = ""
    layer: number = 0

    constructor(node1:Node,node2:Node,parentEdge:Edge | undefined,childrenEdges:Edge[]){
        this.node1 = node1
        this.node2  = node2
        this.parentEdge = parentEdge
        this.childrenEdges = childrenEdges
        this.id = uuidv4();
        this.node1.startEdges.push(this)
        this.node2.endEdges.push(this)
    }
    
}