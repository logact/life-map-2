import { useState } from "react";

import { EdgeData, isRecord, NodeData, NodeKind } from "@/domain/doc";
import { MenuCard, MenuEntry } from "../components/bottomPanel";

// The object menus that replaced the mutation sheets (see
// DESIGN_MUTATIONS.md): grouped rows docked in the bottom panel, never
// more than a handful of choices at once; the map shifts the camera so
// the object stays clear of the panel. Submenus (the kind picker) open
// one level down inside the same panel. Every leaf action closes the
// menu; there is no backdrop — a tap outside falls through to the canvas
// and dismisses it.
//
// Entries are built inline (no helper functions taking callbacks): the
// react-hooks/refs rule flags ref-capturing callbacks passed as plain
// function arguments during render, so every callback stays inside its
// own onPress closure.

const KIND_GLYPHS: Record<NodeKind, string> = { goal: "◎", task: "☑", record: "✎" };

const kindLabel = (kind: NodeKind) => kind[0].toUpperCase() + kind.slice(1);

// double-tap node menu: everything that mutates this node, grouped —
// Create (directed: successor = this → new, predecessor = new → this),
// Copy, and a separated destructive row that confirms in place.
// Not here: text info (title, description/note) edits in place on the
// single-tap info card, and status transitions live there too
export function NodeMenu(props: {
  node: NodeData;
  onPickKind: (direction: "successor" | "predecessor", kind: NodeKind) => void;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const { node } = props;
  const [step, setStep] = useState<"root" | "successor" | "predecessor">("root");

  if (step === "successor" || step === "predecessor") {
    // records are leaves: a record can never point at a created node, so
    // the predecessor submenu never offers Record
    const kinds: NodeKind[] =
      step === "successor" ? ["goal", "task", "record"] : ["goal", "task"];
    const entries: MenuEntry[] = [
      { key: "back", label: "Back", glyph: "‹", onPress: () => setStep("root") },
      "sep",
      ...kinds.map(
        (kind): MenuEntry => ({
          key: kind,
          label: kindLabel(kind),
          glyph: KIND_GLYPHS[kind],
          onPress: () => props.onPickKind(step, kind),
        }),
      ),
    ];
    return (
      <MenuCard
        title={step === "successor" ? "New successor" : "New predecessor"}
        entries={entries}
      />
    );
  }

  const entries: MenuEntry[] = [];
  // records are leaves: a record can never point at a created node
  if (!isRecord(node)) {
    entries.push({
      key: "successor",
      label: "New successor",
      glyph: "●→○",
      onPress: () => setStep("successor"),
    });
  }
  entries.push({
    key: "predecessor",
    label: "New predecessor",
    glyph: "○→●",
    onPress: () => setStep("predecessor"),
  });
  entries.push(
    "sep",
    // a trimmed snapshot: payload only, never the node's edges
    { key: "copy", label: "Copy", onPress: () => props.onCopy() },
    "sep",
    { key: "remove", label: "Remove", destructive: true, onPress: () => props.onRemove() },
  );
  return <MenuCard title={node.title} entries={entries} />;
}

// double-tap edge menu: expand / summarize / copy / straighten / remove
export function EdgeMenu(props: {
  edge: EdgeData;
  title: string;
  onExpand: () => void;
  onSummarize: () => void;
  onCopy: () => void;
  onStraighten: () => void;
  onRemove: () => void;
}) {
  const { edge } = props;

  const entries: MenuEntry[] = [];
  // expand inserts the synthetic midpoint into a LEAF edge; an edge with
  // children is already expanded
  if (edge.childEdgeIds.length === 0) {
    entries.push({ key: "expand", label: "Expand", onPress: () => props.onExpand() });
  }
  entries.push({ key: "summarize", label: "Summarize with…", onPress: () => props.onSummarize() });
  // deep copy: endpoints and the whole hidden subtree come along
  entries.push({ key: "copy", label: "Copy", onPress: () => props.onCopy() });
  if (edge.bend) {
    entries.push({ key: "straighten", label: "Straighten", onPress: () => props.onStraighten() });
  }
  entries.push(
    "sep",
    { key: "remove", label: "Remove edge", destructive: true, onPress: () => props.onRemove() },
  );
  return <MenuCard title={props.title} entries={entries} />;
}

// double-tap empty canvas: create a node at the tapped point (the create
// form opens next), or paste the clipboard snapshot there. The last row
// replaces the whole map with the tutorial seed (destructive; it
// confirms in place and undo restores the old map)
export function CreateMenu(props: {
  hasClipboard: boolean;
  onPickKind: (kind: NodeKind) => void;
  onPaste: () => void;
  onLoadSeed: () => void;
}) {
  const entries: MenuEntry[] = (["goal", "task", "record"] as NodeKind[]).map((kind) => ({
    key: kind,
    label: kindLabel(kind),
    glyph: KIND_GLYPHS[kind],
    onPress: () => props.onPickKind(kind),
  }));
  if (props.hasClipboard) {
    entries.push("sep", {
      key: "paste",
      label: "Paste",
      glyph: "📋",
      onPress: () => props.onPaste(),
    });
  }
  entries.push("sep", {
    key: "seed",
    label: "Load the tutorial",
    glyph: "🎓",
    onPress: () => props.onLoadSeed(),
    destructive: true,
  });
  return <MenuCard title="Create" entries={entries} />;
}

// selection-bar long-press on a road: copy the whole road (every selected
// edge deep-copied with its subtree and endpoints) or edit the route query
// that produced it
export function RoadMenu(props: {
  title: string;
  onCopyRoad: () => void;
  onEditRouteQuery: () => void;
}) {
  return (
    <MenuCard
      title={props.title}
      entries={[
        { key: "copy", label: "Copy road", onPress: () => props.onCopyRoad() },
        { key: "edit", label: "Edit route query", onPress: () => props.onEditRouteQuery() },
      ]}
    />
  );
}
