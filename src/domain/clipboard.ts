import { v4 as uuidv4 } from "uuid";

import { Edge } from "./edge";
import Goal from "./goal";
import { LifeMap } from "./lifeMap";
import { isGoalNode, isRecordNode, isTaskNode, Node, NodeKind } from "./node";
import { Record as RecordNode } from "./record";
import { Status } from "./status";
import { Task } from "./task";

// ---------- clipboard: copy/paste as plain-data snapshots ----------
// Copy captures a JSON-able snapshot (never live domain references), so a
// paste still works after the original is edited or deleted, and the same
// snapshot can be pasted any number of times. Node, edge, and road copies
// all produce the same payload — a mini-graph of node records plus an edge
// tree — so there is exactly one paste path.
//
// Copy rules (issue #13):
// - node: payload only (title/kind/color/notes/kind data), no adjacency
// - edge/road: deep copy — endpoints and the whole childrenEdges subtree
//   come along; endpoint copies are trimmed (their outside edges are not)
// - shared nodes/edges are captured once via an id -> key memo, so a
//   diamond in the original stays a diamond in the copy
// - every pasted node/edge/note gets a fresh id; statuses and timestamps
//   copy verbatim (exact duplicate)

export interface ClipboardNodeData {
    key: string;
    kind: NodeKind;
    title: string;
    color?: string;
    // kind-specific fields, same shape as the store's node `data` blob
    data: Record<string, unknown>;
    notes: { text: string; createdAt: number; updatedAt: number }[];
    // position relative to the payload anchor (bounding-box center)
    rx: number;
    ry: number;
}

export interface ClipboardEdgeData {
    fromKey: string;
    toKey: string;
    color?: string;
    bend?: { rx: number; ry: number };
    children: ClipboardEdgeData[];
}

export interface ClipboardPayload {
    kind: "node" | "edge" | "road";
    nodes: ClipboardNodeData[];
    rootEdges: ClipboardEdgeData[];
}

// ---------- snapshot ----------

interface Capture {
    nodes: ClipboardNodeData[]; // rx/ry hold absolute coords until buildPayload
    nodeKeyById: Map<string, string>;
    seenEdgeIds: Set<string>;
    nextKey: number;
}

function newCapture(): Capture {
    return { nodes: [], nodeKeyById: new Map(), seenEdgeIds: new Set(), nextKey: 0 };
}

function captureKindData(node: Node): Record<string, unknown> {
    if (isGoalNode(node)) {
        return {
            description: node.description ?? null,
            targetDate: node.targetDate?.getTime() ?? null,
            completedAt: node.completedAt?.getTime() ?? null,
        };
    }
    if (isTaskNode(node)) {
        return {
            status: node.status,
            startedAt: node.startedAt?.getTime() ?? null,
            completedAt: node.completedAt?.getTime() ?? null,
        };
    }
    if (isRecordNode(node)) {
        return {
            note: node.note,
            createdAt: node.createdAt.getTime(),
            occuredAt: node.occuredAt.getTime(),
        };
    }
    return {};
}

function captureNode(cap: Capture, node: Node): string {
    const existing = cap.nodeKeyById.get(node.id);
    if (existing) {
        return existing;
    }
    const key = `n${++cap.nextKey}`;
    cap.nodeKeyById.set(node.id, key);
    cap.nodes.push({
        key,
        kind: node.kind,
        title: node.title,
        color: node.color,
        data: captureKindData(node),
        notes: node.notes.map((n) => ({
            text: n.text,
            createdAt: n.createdAt.getTime(),
            updatedAt: n.updatedAt.getTime(),
        })),
        rx: node.x,
        ry: node.y,
    });
    return key;
}

function captureEdge(cap: Capture, edge: Edge): ClipboardEdgeData {
    return {
        fromKey: captureNode(cap, edge.node1),
        toKey: captureNode(cap, edge.node2),
        color: edge.color,
        bend: edge.bend ? { rx: edge.bend.x, ry: edge.bend.y } : undefined,
        children: edge.childrenEdges.map((c) => captureEdge(cap, c)),
    };
}

// recenter every captured position on the bounding-box center, so a paste
// lands with the whole structure centered on the target point
function buildPayload(kind: ClipboardPayload["kind"], cap: Capture, rootEdges: ClipboardEdgeData[]): ClipboardPayload {
    if (cap.nodes.length === 0) {
        return { kind, nodes: [], rootEdges: [] };
    }
    const xs = cap.nodes.map((n) => n.rx);
    const ys = cap.nodes.map((n) => n.ry);
    const ax = (Math.min(...xs) + Math.max(...xs)) / 2;
    const ay = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const n of cap.nodes) {
        n.rx -= ax;
        n.ry -= ay;
    }
    const normalizeEdge = (e: ClipboardEdgeData) => {
        if (e.bend) {
            e.bend = { rx: e.bend.rx - ax, ry: e.bend.ry - ay };
        }
        e.children.forEach(normalizeEdge);
    };
    rootEdges.forEach(normalizeEdge);
    return { kind, nodes: cap.nodes, rootEdges };
}

export function snapshotNode(node: Node): ClipboardPayload {
    const cap = newCapture();
    captureNode(cap, node);
    return buildPayload("node", cap, []);
}

export function snapshotEdge(edge: Edge): ClipboardPayload {
    const cap = newCapture();
    return buildPayload("edge", cap, [captureEdge(cap, edge)]);
}

// a road is a list of visible edges (a route or the current selection);
// edges shared between routes are captured once
export function snapshotRoad(edges: Edge[]): ClipboardPayload {
    const cap = newCapture();
    const roots: ClipboardEdgeData[] = [];
    for (const e of edges) {
        if (cap.seenEdgeIds.has(e.id)) {
            continue;
        }
        cap.seenEdgeIds.add(e.id);
        roots.push(captureEdge(cap, e));
    }
    return buildPayload("road", cap, roots);
}

// ---------- paste ----------

export interface PasteResult {
    nodeIds: string[];
    rootEdgeIds: string[];
}

function instantiateNode(data: ClipboardNodeData, at: { x: number; y: number }): Node {
    const x = at.x + data.rx;
    const y = at.y + data.ry;
    const d = data.data;
    let node: Node;
    if (data.kind === "task") {
        const task = new Task(x, y, data.title, [], []);
        if (typeof d.status === "string") task.status = d.status as Status;
        if (typeof d.startedAt === "number") task.startedAt = new Date(d.startedAt);
        if (typeof d.completedAt === "number") task.completedAt = new Date(d.completedAt);
        node = task;
    } else if (data.kind === "record") {
        const record = new RecordNode(
            x,
            y,
            data.title,
            [],
            [],
            typeof d.note === "string" ? d.note : "",
            typeof d.occuredAt === "number" ? new Date(d.occuredAt) : new Date(),
        );
        if (typeof d.createdAt === "number") record.createdAt = new Date(d.createdAt);
        node = record;
    } else {
        const goal = new Goal(x, y, data.title, [], []);
        if (typeof d.description === "string") goal.description = d.description;
        if (typeof d.targetDate === "number") goal.targetDate = new Date(d.targetDate);
        if (typeof d.completedAt === "number") goal.completedAt = new Date(d.completedAt);
        node = goal;
    }
    node.color = data.color;
    node.notes = data.notes.map((n) => ({
        id: uuidv4(),
        text: n.text,
        createdAt: new Date(n.createdAt),
        updatedAt: new Date(n.updatedAt),
    }));
    return node;
}

// recreate the snapshot centered on `at`. Pasted edges become new root
// edges (layer 0) with their subtree re-layered beneath them; pasted nodes
// untouched by any pasted edge become isolated root nodes.
export function pasteIntoMap(map: LifeMap, payload: ClipboardPayload, at: { x: number; y: number }): PasteResult {
    const byKey = new Map<string, Node>();
    for (const n of payload.nodes) {
        byKey.set(n.key, instantiateNode(n, at));
    }

    const rootEdgeIds: string[] = [];
    const connectedKeys = new Set<string>();
    const pasteEdge = (e: ClipboardEdgeData, parent?: Edge) => {
        const from = byKey.get(e.fromKey);
        const to = byKey.get(e.toKey);
        if (!from || !to) {
            return;
        }
        // addEdge links the endpoints, mints a fresh edge id, and re-layers
        const edge = map.addEdge(from, to, parent);
        connectedKeys.add(e.fromKey);
        connectedKeys.add(e.toKey);
        edge.color = e.color;
        if (e.bend) {
            edge.bend = { x: at.x + e.bend.rx, y: at.y + e.bend.ry };
        }
        if (!parent) {
            rootEdgeIds.push(edge.id);
        }
        e.children.forEach((c) => pasteEdge(c, edge));
    };
    payload.rootEdges.forEach((e) => pasteEdge(e));

    const nodeIds: string[] = [];
    for (const n of payload.nodes) {
        const node = byKey.get(n.key)!;
        nodeIds.push(node.id);
        if (!connectedKeys.has(n.key)) {
            map.addNode(node);
        }
    }
    return { nodeIds, rootEdgeIds };
}
