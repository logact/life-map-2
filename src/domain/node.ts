import { Edge } from "./edge";

export interface Node{
    x:number,
    y:number,
    id:string,
    title:string,
    startEdges:Edge[],
    endEdges:Edge[],

}

export function createEmptyNode():Node {
    return {
        x: 0,
        y: 0,
        id: "",
        title: "",
        startEdges: [],
        endEdges: []
    }
}


