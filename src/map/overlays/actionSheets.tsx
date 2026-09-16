import { Recipe, StatusAction, transitionNodeStatus } from "@/domain/commands";
import { EdgeData, isGoal, isRecord, isTask, LifeMapDoc, NodeData } from "@/domain/doc";
import { nodeStatus } from "@/domain/status";
import { PALETTE } from "@/app/palette";
import { ActionSheet, SheetAction } from "../components/sheets";

// double-tap node sheet: everything that mutates this node
export function NodeActionSheet(props: {
  node: NodeData;
  onAddTo: () => void;
  onBeAddedTo: () => void;
  onConnectTo: () => void;
  onBeConnectedTo: () => void;
  onCopy: () => void;
  onNotes: () => void;
  onStatus: () => void;
  onColor: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { node } = props;
  const actions: SheetAction[] = [];
  // records are leaves: nothing can be added under them
  if (!isRecord(node)) {
    actions.push({ label: "Add to", icon: "➕", onPress: props.onAddTo });
  }
  actions.push({ label: "Be added to", icon: "⤴️", onPress: props.onBeAddedTo });
  actions.push({ label: "Connect to", icon: "→", onPress: props.onConnectTo });
  actions.push({ label: "Be connected to", icon: "←", onPress: props.onBeConnectedTo });
  // copy a trimmed snapshot: payload only, never the node's edges
  actions.push({ label: "Copy", icon: "⧉", onPress: props.onCopy });
  // every node kind can carry notes
  actions.push({ label: "Notes", icon: "📝", onPress: props.onNotes });
  // records carry no status, so the change-status step is skipped
  if (!isRecord(node)) {
    actions.push({ label: "Status", icon: "◐", onPress: props.onStatus });
  }
  actions.push({ label: "Color", icon: "●", color: node.color, onPress: props.onColor });
  actions.push({ label: "Remove", icon: "🗑", destructive: true, onPress: props.onRemove });
  return (
    <ActionSheet
      title={node.title}
      subtitle={node.kind}
      actions={actions}
      onClose={props.onClose}
    />
  );
}

// double-tap edge sheet: expand / summarize / copy / straighten / remove
export function EdgeActionSheet(props: {
  edge: EdgeData;
  fromTitle: string;
  toTitle: string;
  layer: number;
  onExpand: () => void;
  onSummarize: () => void;
  onCopy: () => void;
  onStraighten: () => void;
  onColor: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { edge } = props;
  const actions: SheetAction[] = [
    { label: "Expand", icon: "⤢", onPress: props.onExpand },
    { label: "Summarize with…", icon: "🧩", onPress: props.onSummarize },
    // deep copy: endpoints and the whole hidden subtree come along
    { label: "Copy", icon: "⧉", onPress: props.onCopy },
  ];
  if (edge.bend) {
    actions.push({ label: "Straighten", icon: "📏", onPress: props.onStraighten });
  }
  actions.push({ label: "Color", icon: "●", color: edge.color, onPress: props.onColor });
  actions.push({ label: "Remove edge", icon: "🗑", destructive: true, onPress: props.onRemove });
  return (
    <ActionSheet
      title={`${props.fromTitle} → ${props.toTitle}`}
      subtitle={`Layer ${props.layer}`}
      actions={actions}
      onClose={props.onClose}
    />
  );
}

// kind picker: second step of "Add to" / "Be added to" — pick the
// kind of the new node, then the create form opens
export function KindPickerSheet(props: {
  anchor: NodeData;
  direction: "child" | "parent";
  onPick: (mode: "goal" | "task" | "record") => void;
  onClose: () => void;
}) {
  return (
    <ActionSheet
      title={props.anchor.title}
      subtitle={props.direction === "child" ? "Add to" : "Be added to"}
      actions={[
        { label: "Goal", icon: "◎", onPress: () => props.onPick("goal") },
        { label: "Task", icon: "☑", onPress: () => props.onPick("task") },
        // records are leaves: never offered as a new parent
        ...(props.direction === "child"
          ? [{ label: "Record", icon: "✎", onPress: () => props.onPick("record") }]
          : []),
      ]}
      onClose={props.onClose}
    />
  );
}

// status picker: second step of the node sheet's "Status" action —
// offers only the statuses the state machine allows from the current
// one; picking one applies the transition immediately
export function StatusPickerSheet(props: {
  node: NodeData;
  doc: LifeMapDoc;
  run: (recipe: Recipe) => void;
  onClose: () => void;
}) {
  const { node } = props;
  // the command's status machine throws on an illegal transition;
  // only legal ones are offered, so (as before) no catch here
  const change = (label: string, action: StatusAction): SheetAction => ({
    label,
    icon: "◐",
    onPress: () => {
      props.run(transitionNodeStatus(node.id, action));
      props.onClose();
    },
  });
  const actions: SheetAction[] = [];
  if (isTask(node)) {
    const status = node.status ?? "todo";
    if (status === "todo") {
      actions.push(change("In progress", "start"));
      actions.push(change("Done", "complete"));
    } else if (status === "in-progress") {
      actions.push(change("Todo", "pause"));
      actions.push(change("Done", "complete"));
    } else {
      actions.push(change("Todo", "reopen"));
    }
  } else if (isGoal(node)) {
    // a goal's status is derived from its tasks; the only stored
    // override is the manual completion flag
    if (node.completedAt) {
      actions.push(change("Reopen", "reopen"));
    } else {
      actions.push(change("Done", "complete"));
    }
  }
  if (actions.length === 0) return null;
  return (
    <ActionSheet
      title={node.title}
      subtitle={`Status: ${nodeStatus(props.doc, node.id)}`}
      actions={actions}
      onClose={props.onClose}
    />
  );
}

// color picker: second step of the node/edge sheet's "Color" action — a
// palette of swatches plus Default (clear); picking one applies it
// through run() and closes the sheet
export function ColorPickerSheet(props: {
  title: string;
  onPick: (color?: string) => void;
  onClose: () => void;
}) {
  return (
    <ActionSheet
      title={props.title}
      subtitle="Color"
      actions={[
        { label: "Default", icon: "∅", onPress: () => props.onPick(undefined) },
        ...PALETTE.map((c) => ({
          label: c.label,
          icon: "●",
          color: c.color,
          onPress: () => props.onPick(c.color),
        })),
      ]}
      onClose={props.onClose}
    />
  );
}

// selection-bar long-press on a road: copy the whole road (every selected
// edge deep-copied with its subtree and endpoints) or edit the route
// query that produced it
export function RoadSheet(props: {
  title: string;
  steps: number;
  onCopyRoad: () => void;
  onEditRouteQuery: () => void;
  onClose: () => void;
}) {
  return (
    <ActionSheet
      title={props.title}
      subtitle={`${props.steps} steps`}
      actions={[
        { label: "Copy road", icon: "⧉", onPress: props.onCopyRoad },
        { label: "Edit route query", icon: "🔍", onPress: props.onEditRouteQuery },
      ]}
      onClose={props.onClose}
    />
  );
}

// free-space kind picker: first step of a double tap on empty canvas —
// pick the kind of the new node, then the create form opens at the
// tapped position. With a non-empty clipboard a Paste tile joins,
// recreating the snapshot at the tapped point
export function FreeSpacePicker(props: {
  hasClipboard: boolean;
  onPickKind: (mode: "goal" | "task" | "record") => void;
  onPaste: () => void;
  onClose: () => void;
}) {
  return (
    <ActionSheet
      title="Create"
      subtitle="Free space"
      actions={[
        { label: "Goal", icon: "◎", onPress: () => props.onPickKind("goal") },
        { label: "Task", icon: "☑", onPress: () => props.onPickKind("task") },
        { label: "Record", icon: "✎", onPress: () => props.onPickKind("record") },
        ...(props.hasClipboard
          ? [{ label: "Paste", icon: "📋", onPress: props.onPaste }]
          : []),
      ]}
      onClose={props.onClose}
    />
  );
}
