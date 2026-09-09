import { useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { G, Line } from "react-native-svg";

import { Edge } from "@/domain/edge";
import Goal from "@/domain/goal";
import { LayerView, LifeMap } from "@/domain/lifeMap";
import { Node } from "@/domain/node";

// ---------- View models: plain data describing what to draw ----------
// The UI renders ONLY from these. It never renders domain objects directly.

interface NodeViewModel {
  id: string;
  x: number;
  y: number;
  title: string;
}

interface EdgeViewModel {
  id: string;
  fromId: string;
  toId: string;
  layer: number;
}

interface MapViewModel {
  nodes: NodeViewModel[];
  edges: EdgeViewModel[];
}

// domain -> view model: walk the edges visible at the current layer,
// then the isolated nodes. LayerView.edges is exactly the set of visible
// edges (expanded edges are replaced by their children), so do NOT
// recurse into childrenEdges here — they are not visible until revealed.
function mapDomainToViewModel(layerView: LayerView): MapViewModel {
  console.log("[FLOW]   render step 2: converting domain -> view models");
  const nodes = new Map<string, NodeViewModel>();
  const edges: EdgeViewModel[] = [];

  for (const e of layerView.edges) {
    edges.push({ id: e.id, fromId: e.node1.id, toId: e.node2.id, layer: e.layer });
    for (const n of [e.node1, e.node2]) {
      if (!nodes.has(n.id)) {
        nodes.set(n.id, { id: n.id, x: n.x, y: n.y, title: n.title });
      }
    }
  }

  for (const n of layerView.map.rootNodes) {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, { id: n.id, x: n.x, y: n.y, title: n.title });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// view models carry domain ids so a tap can find the real domain object again
function findDomainNode(map: LifeMap, id: string): Node | undefined {
  const stack: Edge[] = [...map.rootEdges];
  while (stack.length > 0) {
    const e = stack.pop()!;
    if (e.node1.id === id) return e.node1;
    if (e.node2.id === id) return e.node2;
    stack.push(...e.childrenEdges);
  }
  return map.rootNodes.find((n) => n.id === id);
}

// ---------- Demo data ----------

// place the sub node created by expand() between its two endpoints
function placeSubNode(edge: Edge, dx = 0, dy = 0): Node {
  const sub = edge.childrenEdges[0].node2;
  sub.x = (edge.node1.x + edge.node2.x) / 2 + dx;
  sub.y = (edge.node1.y + edge.node2.y) / 2 + dy;
  return sub;
}

function createDemoMap(cx: number, cy: number): LifeMap {
  const map = new LifeMap();

  // ---- root goals ----
  const health = new Goal(cx, cy - 160, "Health", [], []);
  const career = new Goal(cx - 140, cy + 80, "Career", [], []);
  const family = new Goal(cx + 140, cy + 80, "Family", [], []);
  const friends = new Goal(cx + 20, cy + 220, "Friends", [], []);
  // isolated node: no edges, only visible via rootNodes
  map.addNode(new Goal(cx - 180, cy + 200, "Learning", [], []));

  // ---- branch A: Health -> Career, the deep multi-branch one ----
  // layer 0 root edge, expanded into a chain (layer 1)
  const healthCareer = map.addEdge(health, career);
  map.expand(healthCareer); // health -> hc1 -> career
  const hc1 = placeSubNode(healthCareer, -40);

  // deeper: expand the first chain link again (layer 2)
  const link1 = healthCareer.childrenEdges[0]; // health -> hc1
  map.expand(link1); // health -> hc2 -> hc1
  const hc2 = placeSubNode(link1, -60);

  // deepest: expand once more (layer 3)
  const link2 = link1.childrenEdges[1]; // hc2 -> hc1
  map.expand(link2); // hc2 -> hc3 -> hc1
  placeSubNode(link2, 40);

  // multiple branches: extra child edges hanging off the same parents
  const sideA = new Goal(cx - 10, cy + 10, "Side A", [], []);
  map.addEdge(hc1, sideA, healthCareer); // layer 1 sibling of the chain
  const sideB = new Goal(cx - 190, cy - 60, "Side B", [], []);
  map.addEdge(hc2, sideB, link1); // layer 2 sibling

  // ---- branch B: Health -> Family, stops at layer 1 ----
  const healthFamily = map.addEdge(health, family);
  map.expand(healthFamily);
  placeSubNode(healthFamily, 40);

  // ---- branch C: Career -> Friends, stays at layer 0 ----
  map.addEdge(career, friends);

  return map;
}

// ---------- Screen ----------

const NODE_SIZE = 72;


/**
 * 
 * The map canvas 
 * UI composition method using the absolute position to layout the item in the container.
 * container: View
 *  edges: SVG 
 *  nodes: view
 *  control panle: view
 * 
 * 
 * @returns 
 * 
 * 
 */
export default function MapScreen() {
  const { width, height } = useWindowDimensions();
  console.log("[FLOW] render step 1: React is running MapScreen()");

  // The domain object and its layer view are created once and survive re-renders.
  const mapRef = useRef<LifeMap | null>(null);
  const layerViewRef = useRef<LayerView | null>(null);
  if (mapRef.current === null) {
    mapRef.current = createDemoMap(width / 2, height / 3);
    layerViewRef.current = new LayerView(mapRef.current);
  }
  const map = mapRef.current;
  const layerView = layerViewRef.current!;

  // Every domain change goes through run(): mutate, re-sync the layer
  // view, then bump state so React re-renders from fresh view models.
  const [, setVersion] = useState(0);
  const run = (mutate: (m: LifeMap) => void) => {
    console.log("[FLOW] event -> mutating domain now");
    mutate(map);
    layerView.refresh(layerView.forwardSteps);
    console.log("[FLOW] calling setVersion -> tells React to re-render");
    setVersion((v) => v + 1);
  };

  // Layer changes touch only the view, not the domain.
  const showMoreDetail = () => {
    layerView.nextLayer();
    setSelectedEdgeIds([]); // the selected edges may no longer be visible
    setVersion((v) => v + 1);
  };
  const showLessDetail = () => {
    layerView.prevLayer();
    setSelectedEdgeIds([]);
    setVersion((v) => v + 1);
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

  // domain -> UI: derive plain view models on every render
  const vm = mapDomainToViewModel(layerView);
  const posById = new Map(vm.nodes.map((n) => [n.id, n]));
  console.log(
    `[FLOW]   render step 3: drawing ${vm.nodes.length} nodes, ${vm.edges.length} edges, layer ${layerView.forwardSteps}`,
  );

  const onNodePress = (id: string) => {
    if (selectedId === null) {
      console.log("[FLOW] tap -> select node (UI state only)");
      setSelectedId(id); // first tap: select
      return;
    }
    if (selectedId === id) {
      setSelectedId(null); // tap same node: deselect
      return;
    }
    // second tap on another node: connect them in the domain
    console.log("[FLOW] tap -> connect two nodes (goes through run())");
    const from = findDomainNode(map, selectedId);
    const to = findDomainNode(map, id);
    if (from && to) {
      run((m) => m.addEdge(from, to));
    }
    setSelectedId(null);
  };

  const addGoal = () => {
    console.log("[FLOW] tap -> add goal (goes through run())");
    run((m) =>
      m.addNode(
        new Goal(
          width / 2 + (Math.random() - 0.5) * 160,
          height / 2 + (Math.random() - 0.5) * 160,
          `Goal ${vm.nodes.length + 1}`,
          [],
          [],
        ),
      ),
    );
  };

  // edge tap toggles selection (UI state only); the domain mutation
  // happens later via the Expand / Summarize buttons
  const onEdgePress = (id: string) => {
    setSelectedEdgeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const expandSelected = () => {
    const edge = layerView.edges.find((e) => e.id === selectedEdgeIds[0]);
    if (!edge) return;
    console.log("[FLOW] tap -> expand edge (goes through run())");
    // expand = drill into this edge: navigate the view to the layer
    // where the new children live (edge.layer + 1). A visible edge can
    // be shallower than the view's bottom (e.g. a layer-0 edge shown at
    // the layer-3 view), in which case the view comes back UP to the
    // children's layer — that is the navigation.
    const targetLayer = edge.layer + 1;
    run((m) => {
      m.expand(edge);
      placeSubNode(edge, -40); // offset so the bend is visible
    });
    layerView.refresh(targetLayer);
    setVersion((v) => v + 1);
    setSelectedEdgeIds([]);
  };

  const summarizeSelected = () => {
    const edges = layerView.edges.filter((e) => selectedEdgeIds.includes(e.id));
    if (edges.length < 2) return;

    const parentId = (e: Edge) => e.parentEdge?.id ?? "";
    if (edges.some((e) => parentId(e) !== parentId(edges[0]))) {
      Alert.alert("Cannot summarize", "Selected edges must share the same parent.");
      return;
    }

    // endpoints of the summarized edge: the boundary nodes of the
    // selection, i.e. the nodes touched by exactly one selected edge
    const touched = new Map<string, { node: Node; count: number }>();
    for (const e of edges) {
      for (const n of [e.node1, e.node2]) {
        const entry = touched.get(n.id);
        touched.set(n.id, { node: n, count: (entry?.count ?? 0) + 1 });
      }
    }
    const boundary = [...touched.values()]
      .filter((t) => t.count === 1)
      .map((t) => t.node);
    if (boundary.length < 2) {
      Alert.alert("Cannot summarize", "Selected edges need two open end nodes.");
      return;
    }

    console.log("[FLOW] tap -> summarize edges (goes through run())");
    run((m) => m.summarize(boundary[0], boundary[1], edges));
    setSelectedEdgeIds([]);
  };

  return (
    <View style={styles.container}>
      <Svg style={StyleSheet.absoluteFill}>
        {vm.edges.map((e) => {
          const a = posById.get(e.fromId);
          const b = posById.get(e.toId);
          if (!a || !b) return null;
          const selected = selectedEdgeIds.includes(e.id);
          return (
            <G key={e.id}>
              <Line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={selected ? "#f59e0b" : "#9aa5b1"}
                strokeWidth={selected ? 4 : Math.max(1.5, 3 - e.layer)}
              />
              {/* wide invisible hit area so thin lines are tappable */}
              <Line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={24}
                onPress={() => onEdgePress(e.id)}
              />
            </G>
          );
        })}
      </Svg>

      {vm.nodes.map((n) => (
        <Pressable
          key={n.id}
          onPress={() => onNodePress(n.id)}
          style={[
            styles.node,
            { left: n.x - NODE_SIZE / 2, top: n.y - NODE_SIZE / 2 },
            n.id === selectedId && styles.nodeSelected,
          ]}
        >
          <Text style={styles.nodeTitle}>{n.title}</Text>
        </Pressable>
      ))}

      <View style={styles.layerControls}>
        <Pressable style={styles.layerButton} onPress={showLessDetail}>
          <Text style={styles.layerButtonText}>-</Text>
        </Pressable>
        <Text style={styles.layerLabel}>Layer {layerView.forwardSteps}</Text>
        <Pressable style={styles.layerButton} onPress={showMoreDetail}>
          <Text style={styles.layerButtonText}>+</Text>
        </Pressable>
      </View>

      {selectedEdgeIds.length > 0 && (
        <View style={styles.edgeControls} pointerEvents="box-none">
          <Pressable
            style={[
              styles.edgeButton,
              selectedEdgeIds.length !== 1 && styles.edgeButtonDisabled,
            ]}
            disabled={selectedEdgeIds.length !== 1}
            onPress={expandSelected}
          >
            <Text style={styles.edgeButtonText}>Expand</Text>
          </Pressable>
          <Pressable
            style={[
              styles.edgeButton,
              selectedEdgeIds.length < 2 && styles.edgeButtonDisabled,
            ]}
            disabled={selectedEdgeIds.length < 2}
            onPress={summarizeSelected}
          >
            <Text style={styles.edgeButtonText}>Summarize</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={styles.addButton} onPress={addGoal}>
        <Text style={styles.addButtonText}>+ Add goal</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },
  node: {
    position: "absolute",
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#208AEF",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  nodeSelected: {
    borderColor: "#f59e0b",
    backgroundColor: "#fef3c7",
  },
  nodeTitle: {
    fontSize: 12,
    textAlign: "center",
  },
  layerControls: {
    position: "absolute",
    left: 20,
    bottom: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#d0d7de",
  },
  layerButton: {
    paddingHorizontal: 8,
  },
  layerButtonText: {
    fontSize: 20,
    color: "#208AEF",
    fontWeight: "600",
  },
  layerLabel: {
    fontSize: 13,
    color: "#333333",
  },
  addButton: {
    position: "absolute",
    right: 20,
    bottom: 40,
    backgroundColor: "#208AEF",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
  },
  edgeControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 100, // sits above the bottom row (layer controls / add button)
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  edgeButton: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#208AEF",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  edgeButtonDisabled: {
    opacity: 0.4,
  },
  edgeButtonText: {
    color: "#208AEF",
    fontWeight: "600",
  },
  addButtonText: {
    color: "#ffffff",
    fontWeight: "600",
  },
});
