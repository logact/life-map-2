
import { v4 } from "uuid";
import { Edge } from "./edge";
import { Node } from "./node";

export class LayerView {
    map: LifeMap;
    forwardSteps: number = 0;
    isolatedNodes: Node[];
    edges: Edge[];


    constructor(map: LifeMap) {
        this.map = map;
        this.edges = this.map.rootEdges;
        this.isolatedNodes = this.map.rootNodes;
    }
    refresh(layer: number) {
        this.edges = this.map.rootEdges;
        this.isolatedNodes = this.map.rootNodes;
        this.forwardSteps = 0;
        while (this.forwardSteps < layer && this.nextLayer()) {
            // keep stepping until the target layer or the bottom
        }

    }

    /**
     * Inverse method for nextLayer(), inferred from the current edges:
     * nextLayer() expands every expandable visible edge, so the edges
     * revealed by the last step are exactly those with
     * layer === forwardSteps. Collapse just them back to their parents;
     * shallower edges were expanded in earlier steps and stay untouched.
     * @returns return false when already at the top layer.
     */

    prevLayer(): boolean {
        if (this.forwardSteps <= 0) { return false }

        const result: Edge[] = [];
        const collapsedParents = new Set<string>();
        for (const e of this.edges) {
            const parent = e.parentEdge;
            if (parent && e.layer === this.forwardSteps) {
                if (!collapsedParents.has(parent.id)) {
                    collapsedParents.add(parent.id);
                    result.push(parent);
                }
            } else {
                result.push(e);
            }
        }
        this.edges = result;
        this.forwardSteps--;
        return true
    }
    // go one layer deeper: replace each expanded edge with its children.
    // An edge without children has nothing deeper to show, so it stays.
    /**
     * 
     * @returns return true when not reach the bottom, return false when reach to the bottom.
     */
    nextLayer(): boolean {
        let expandedAny = false;
        const result: Edge[] = [];
        for (const e of this.edges) {
            if (e.childrenEdges.length > 0) {
                result.push(...e.childrenEdges);
                expandedAny = true;
            } else {
                result.push(e);
            }
        }
        if (!expandedAny) {
            return false
        }
        this.edges = result;
        this.forwardSteps++;
        return true
    }


}
export class LifeMap {
    rootNodes: Node[]
    rootEdges: Edge[]


    constructor(nodes: Node[] = [], edges: Edge[] = []) {
        this.rootNodes = nodes
        this.rootEdges = edges
    }
    save() {
        //TODO persist db/cloud
    }
    load() {
        //TODO load from db/cloud
    }
    removeNode(node: Node) {
        // removeEdge re-adds an isolated node to rootNodes, so the node
        // itself must be spliced out only after its edges are gone
        const edges = [...node.startEdges, ...node.endEdges];
        edges.forEach(e => this.removeEdge(e))
        const index = this.rootNodes.indexOf(node);
        if (index !== -1) {
            this.rootNodes.splice(index, 1);
        }
    }

    updateEdgeLayer(rootEdge: Edge, change: number) {
        rootEdge.layer = rootEdge.layer + change
        const children = rootEdge.childrenEdges
        if (!children || children.length <= 0) {
            return
        }

        for (let childEdge of children) {
            this.updateEdgeLayer(childEdge, change)
        }


    }


    // remove the edge and save its children edge
    // TODO add the paramter deletedRecrusivly to support delete recursivly 
    removeEdge(edge: Edge) {
        const index = this.rootEdges.indexOf(edge);
        if (index !== -1) {
            this.rootEdges.splice(index, 1);
        }
        if (edge.parentEdge) {
            edge.parentEdge.childrenEdges = edge.parentEdge.childrenEdges.filter(e => e.id !== edge.id)
        }

        const childrenEdges = edge.childrenEdges
        childrenEdges.forEach(e => {
            if (edge.parentEdge) {
                edge.parentEdge.childrenEdges.push(e)
                e.parentEdge = edge.parentEdge
            } else {
                e.parentEdge = undefined
                this.rootEdges.push(e)
            }
            this.updateEdgeLayer(e, -1)

        })



        // unlink the edge from its endpoints before the isolation check below
        const node1 = edge.node1
        const node2 = edge.node2
        const startIndex = node1.startEdges.indexOf(edge)
        if (startIndex !== -1) {
            node1.startEdges.splice(startIndex, 1)
        }
        const endIndex = node2.endEdges.indexOf(edge)
        if (endIndex !== -1) {
            node2.endEdges.splice(endIndex, 1)
        }

        // add the new isolated node cause by the edge delection to the rootNodes.
        if (node1.startEdges.length <= 0 && node1.endEdges.length <= 0 && !this.rootNodes.includes(node1)) {
            this.rootNodes.push(node1)
        }
        if (node2.startEdges.length <= 0 && node2.endEdges.length <= 0 && !this.rootNodes.includes(node2)) {
            this.rootNodes.push(node2)
        }
        edge.childrenEdges = []
    }

    addNode(node: Node): Node {
        // dupling

        for (let n of this.rootNodes) {
            if (n.id === node.id) {
                return n
            }
        }

        this.rootNodes.push(node)
        return node
    }
    addEdge(node1: Node, node2: Node, parentEdge?: Edge): Edge {
        const edge = new Edge(node1, node2, parentEdge, [])
        if (!parentEdge) {
            this.rootEdges.push(edge)
        } else {
            parentEdge.childrenEdges.push(edge)
            edge.layer = parentEdge.layer + 1
        }

        // connected nodes are no longer isolated
        this.removeRootNodeIfPresent(node1)
        this.removeRootNodeIfPresent(node2)
        return edge
    }

    private removeRootNodeIfPresent(node: Node) {
        const index = this.rootNodes.indexOf(node)
        if (index !== -1) {
            this.rootNodes.splice(index, 1)
        }
    }

    // expand a edge with only 2 points,generate 2 new edge whose parent is the edge
    expand(edge: Edge) {
        if (edge.childrenEdges.length > 0) {
            return
        }
        const newTitle = `${edge.node1.title}-${edge.node2.title}`
        const newSubNode: Node = {
            x: 0,
            y: 0,
            id: v4(),
            title: newTitle,
            startEdges: [],
            endEdges: []
        }
        this.addEdge(edge.node1, newSubNode, edge)
        this.addEdge(newSubNode, edge.node2, edge)

    }


    /**
     * 
     * @param node1 
     * @param node2 
     * @param edges the edges to be summarzied must belongs to a same parent
     * @returns 
     */
    summarize(node1: Node, node2: Node, edges: Edge[]): Edge | null {
        if (edges.length === 0) {
            return null
        }

        const parentEdge = edges[0].parentEdge
        const parentEdgeId = parentEdge ? parentEdge.id : ""
        edges.forEach(e => {
            let eParentEdgeId = e.parentEdge ? e.parentEdge.id : ""
            if (parentEdgeId !== eParentEdgeId) {
                throw new Error("Edges to be summarized should belong to the same parent")
            }
        })
        const summarizedIds = new Set<string>(edges.map(e => e.id))

        // detach the summarized edges from their old container
        if (parentEdge) {
            parentEdge.childrenEdges = parentEdge.childrenEdges.filter(e => !summarizedIds.has(e.id))
        } else {
            this.rootEdges = this.rootEdges.filter(e => !summarizedIds.has(e.id))
        }

        const newSummarizedEdge = new Edge(node1, node2, parentEdge, [])

        if (parentEdge) {
            newSummarizedEdge.layer = parentEdge.layer + 1
        }
        edges.forEach(edge => {
            edge.parentEdge = newSummarizedEdge

            newSummarizedEdge.childrenEdges.push(edge)
            this.updateEdgeLayer(edge, 1)

        })

        if (parentEdge) {
            parentEdge.childrenEdges.push(newSummarizedEdge)
        } else {
            this.rootEdges.push(newSummarizedEdge)
        }
        return newSummarizedEdge
    }
}
