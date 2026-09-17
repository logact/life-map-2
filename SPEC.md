# Life Map 2 — Product & Technical Specification

A visual life-planning app: your goals, tasks, and records live as nodes on an
infinite 2D map, connected by directed edges ("roads") that can be expanded
into sub-roads layer by layer. The whole app is a single full-screen canvas.

- **Platforms:** iOS, Android, Web (Expo, portrait only)
- **Stack:** Expo SDK 57 · React Native 0.86 · React 19 · expo-router (typed
  routes) · expo-sqlite · react-native-svg · react-native-reanimated
- **Entry:** `src/app/_layout.tsx` (header-less Stack) → `src/app/index.tsx` →
  `src/app/map.tsx` (the one and only screen)
- **Code layout:** `src/domain/` pure model & rules · `src/data/` persistence ·
  `src/app/` screen, camera, theme

---

## 1. Domain model (`src/domain/`)

### 1.1 Nodes — three kinds

All nodes share: `id` (uuid), `x/y` (world coordinates), `title`, `kind`,
optional `color`, `notes[]`, and adjacency lists `startEdges` / `endEdges`.

| Kind   | Class    | Shape on map            | Extra fields |
|--------|----------|-------------------------|--------------|
| Goal   | `Goal`   | Large circle (72)       | `description?`, `targetDate?`, `completedAt?` |
| Task   | `Task`   | Rounded square (56)     | `status` (stored), `startedAt?`, `completedAt?` |
| Record | `Record` | Small dot (30)          | `note`, `createdAt`, `occuredAt` — a leaf; nothing attaches under it |

### 1.2 Edges — directed roads with layers

`Edge(node1 → node2)` is **directed** (arrowhead into `node2`). Each edge has
`layer` (0 = root), optional `color`, optional `bend` point (renders as two
segments), and `childrenEdges` forming a tree:

- **Expand** (`LifeMap.expand`): splits an edge by inserting a new Task
  mid-road — `A → B` becomes `A → sub → B`, both children at `layer + 1`.
  Expand is a **domain edit** (creates a sub-node); it never repeats on an
  already-expanded edge.
- **Summarize** (`LifeMap.summarize`): the inverse — folds ≥2 same-parent
  edges into one new parent edge whose endpoints are the selection's two
  open boundary nodes (nodes touched by exactly one selected edge).
- **Remove edge** (`removeEdge`): children survive — they are re-attached to
  the removed edge's parent (or become roots) and re-layered; endpoints that
  become isolated rejoin `rootNodes`. Removing a node removes all its edges.

### 1.3 Status

`Status = "todo" | "in-progress" | "done"`.

**Task state machine** (`src/domain/status.ts`):

```
todo --start--> in-progress --complete--> done
  ^ --pause----/        |                    |
  | --complete----------+                    |
  +----------------reopen-------------------+
```

- `start` records `startedAt` once (first start, never cleared).
- `complete` sets `completedAt`; `reopen` clears it.
- Illegal transitions throw (the UI only offers allowed ones).

**Goal status is derived, never stored**: manual `completedAt` wins ("done");
otherwise it rolls up child tasks — all done → done, any started →
in-progress, else todo. Nothing cascades: completing a goal doesn't touch
its tasks. Goals can be manually completed/reopened.

**Edge status has frontier semantics** (`edgeStatus`): walk the hidden child
chain in travel order, take the first non-done node status (skipping the
source node); all done → the road is done. Edges touching a Record carry no
status.

### 1.4 Notes

Timestamped free-text notes attach to any node kind (`addNote` newest-first,
`updateNote`, `removeNote`). `searchNotes` is a case-insensitive keyword
search over every note on the map, including nodes hidden in collapsed layers.

### 1.5 Layers & the LayerView

`LayerView` computes the **visible frontier**: walk the edge tree, descend
into zoomed-open edges (`zoomedEdgeIds`), keep everything else. Invariant: a
visible edge's children are never visible at the same time. Zoom is **pure
view state** — it never mutates the domain.

- `zoomIn(ids)` — reveal children of selected edges, one level at a time.
- `zoomOut(ids)` — fold the deepest selected frontier back into its parents
  (a whole sibling group folds together).
- `reveal(edge)` — open all ancestors so a hidden node becomes visible
  (used by note-search focus).
- `reset()` — fold everything back to layer 0.

### 1.6 Route finding (`src/domain/route.ts`)

`findRoutes(visibleEdges, fromId, toId, max)` enumerates distinct **directed
simple paths** via DFS (no repeated nodes, direction respected, hop cap 15),
ranks them by on-screen length, dedupes identical node sequences, and returns
up to `max` candidates (UI caps at 8).

### 1.7 Clipboard (`src/domain/clipboard.ts`)

Copy/paste works on **plain-data snapshots**, never live references — paste
still works after the original is edited or deleted, and can repeat.

- **Node copy**: payload only (kind/title/color/notes/kind data), no edges.
- **Edge copy**: deep — endpoints + the whole `childrenEdges` subtree;
  endpoint copies are trimmed of outside edges.
- **Road copy**: every selected edge with its subtree; shared nodes/edges
  are captured once via an id→key memo (a diamond stays a diamond).
- **Paste**: recreates everything with fresh ids at the tapped point,
  centered on the snapshot's bounding-box center; pasted edges become layer-0
  roots with re-layered subtrees; statuses and timestamps copy verbatim.

---

## 2. Persistence (`src/data/lifeMapStore.ts`)

Local **SQLite** (`lifemap.db`, WAL mode) — no server, no account.

- `nodes(id, kind, title, x, y, color, data)` — kind-specific fields live in
  the `data` JSON blob.
- `notes(id, node_id → nodes ON DELETE CASCADE, text, created_at,
  updated_at, position)`.
- `edges(id, node1_id, node2_id, parent_edge_id, position, layer, color,
  bend_x, bend_y)` — stores the whole edge tree.
- **Save** = full rewrite inside one transaction, debounced through a
  serialized save queue (`scheduleSave`) so rapid mutations stay ordered.
- **Load** on app start; an empty database seeds the built-in demo map.
- Snapshots (`snapshotLifeMap` / `restoreLifeMap`) use the same row shape as
  the DB and double as the **undo/redo memento**: every edit snapshots the
  pre-edit state (100-step stacks; view state like zoom/camera is excluded).
- Zoom/selection are in-memory only — never persisted.

---

## 3. The map screen (`src/app/map.tsx`)

### 3.1 Rendering architecture

UI renders only from plain **view models** (`mapDomainToViewModel`), never
from domain objects directly. Flow: gesture → `run(mutate)` → mutate domain →
`layerView.refresh()` → `scheduleSave()` → `setVersion` re-render.

**Camera**: `screen = world × cam.scale + cam offset + viewport pan`.

- *Fit-zoom* (`fitZoom.ts`): recomputed each render from visible nodes; only
  zooms **out** (≤ 1, floor 0.25) so a growing map always fits.
- *Pinch zoom* multiplies the fit-zoom (0.5×–4×), anchored at the pinch
  midpoint. Nodes are **pins**: pinch spreads the ground but never inflates
  them past fit size; titles shrink with fit-zoom and drop out under 18px.
- *Pan* = one-finger drag on empty canvas.
- A world-anchored dot grid (spacing 28, doubling as needed) keeps a constant
  look at any zoom.

### 3.2 Visual language

Grayscale theme (`theme.ts`: INK scale, `ACCENT` blue reserved for route
highlights). User colors come from the 10-color Okabe-Ito palette
(`palette.ts`) — colorblind-safe; node = colored border over faint fill,
edge = colored stroke.

| Status      | Node outline                        | Edge line                    |
|-------------|-------------------------------------|------------------------------|
| todo        | dashed, tertiary gray               | dashed `6 6`                 |
| in-progress | dotted, breathing ring (0.4↔1 opacity) | dotted `2 8`, dashes march toward target |
| done        | solid; title struck through & faded | solid                        |

A **collapsed edge** (hidden children) splits into one equal-length segment
per hidden child, each segment taking its child's color and status, with gap
markers at the breakpoints. Edge width thins with layer (`max(1.5, 3−layer)`);
every directed edge ends in an arrowhead. All strokes and markers use
non-scaling rendering so they keep a constant screen size at any zoom.
Reduce-motion OS setting replaces pulse/march with static outlines.

### 3.3 Gestures

| Gesture | Target | Action |
|---|---|---|
| Single tap | node | Focus: info card in the bottom panel (kind · status · dates, plus a peek of the newest note — the full list opens in a notes sheet) + spotlight (connected edges light up, rest dims) + connect handle on the node |
| Single tap | edge | Info card in the bottom panel (layer, status, hidden sub-edges, Zoom in/Collapse buttons) + edge becomes the zoom **selection** |
| Single tap | empty canvas | Dismiss the panel; clear selection (unless locked) |
| Double tap (300ms) | node | Node menu in the bottom panel |
| Double tap | edge | Edge menu in the bottom panel |
| Double tap | empty canvas | Create menu in the bottom panel (Goal/Task/Record, + Paste if clipboard non-empty) |
| Long press (500ms) | node | Arm for drag → following movement repositions the node |
| Long press | edge | Arm bend-drag → next canvas drag places the bend point; release commits |
| Drag from connect handle | focused node → node | Connect: a tentative edge follows the finger and snaps to the node under it; dropping creates the edge (drag direction = edge direction); dropping anywhere else cancels |
| Pinch | canvas | Camera zoom continuously; with a selection, every accumulated ×1.3 spread/squeeze also steps detail one level (reveal/collapse) — anchored at the pinch midpoint. Selection-less squeeze pops zoom history to undo the last spread |

### 3.4 Menus & flows

All object UI — info card, node/edge/create/road menus — lives in one
**bottom panel** (see DESIGN_MUTATIONS.md): a card docked at the bottom of
the screen, never modal — no backdrop, no dimming; a tap elsewhere dismisses
and retargets in one motion. When a panel opens or grows, the **camera eases
the graph up** just enough that the panel's object stays visible above the
panel area; an already-visible object never moves, and any user gesture
cancels the tween. Submenus (kind picker, color swatches) open one level
down inside the same panel. Destructive rows confirm in place: first tap
arms ("tap again"), second fires. Sheets survive only for text work (create
form, inspector, notes, route query, note search).

- **Node menu**: New successor (creates a node this one points to:
  goal/task/record), New predecessor (creates a node pointing here:
  goal/task — records are leaves, so neither a record node nor a record
  predecessor can point at anything), Edit details (inspector),
  one row per legal status transition labeled by target state
  (Start / Pause / Mark done / Reopen; goals only Mark done / Reopen;
  records none), Color (palette + Default), Copy (trimmed payload
  snapshot), Remove. New nodes fan out around the anchor at the golden
  angle (radius 120).
- **Edge menu**: Expand (leaf edges only), Summarize with… (multi-select
  same-parent edges, then confirm), Copy (deep), Straighten (only when
  bent), Color, Remove edge.
- **Create menu** (double-tap empty canvas): Goal / Task / Record at the
  tapped point, plus Paste when the clipboard is non-empty.
- **Inspector** (edit title/description/note + status actions): text saves
  on Save; status buttons act immediately.
- **Notes**: the node's single-tap info card shows only a peek of the
  newest note; tapping it opens the modal notes sheet — full list
  (newest first), add, edit, delete (in-place two-tap). Text entry opens
  the modal note editor on top.
- **Undo/redo** buttons top-right; **route query** button opens the
  From/To panel (type with autocomplete or tap nodes on canvas, swap ⇅);
  results list up to 8 candidate roads (steps + length), preview in blue,
  tick one/some/all → confirm: chosen edges become the zoom selection and
  everything else dims.
- **Selection bar** (top, replaces the query button): shows From → To and
  step count of the selection; tap re-opens the route query prefilled,
  🔒 pins the selection against stray taps, long-press opens the
  bottom-panel menu (edge menu for a single edge, or for a road: Copy road /
  Edit route query).
- **Note search** panel: keyword over all notes (hidden layers included);
  tapping a result reveals its node through collapsed layers, centers it,
  and opens its info card.
- Mode banners (dark pill) announce only genuinely multi-step modes:
  summarize and bend-drag — each with Cancel.

### 3.5 Demo seed

First launch (empty DB) seeds a demo map: Health/Career/Family/Friends goals,
a 3-layer expanded Health→Career road with side branches, tasks in every
status, a manual goal completion, a record, an isolated node, and a
route-test subgraph (5 valid directed paths RT Start→RT End plus a dead end
and a wrong-direction back-road).

---

## 4. App configuration

`app.json`: scheme `lifemap2`, iOS bundle `com.logact.lifemap`, portrait,
automatic light/dark UI style, splash `#208AEF`, EAS project
`69607ff4-…`, experiments: typed routes + React Compiler.
Path alias `@/*` → `src/*`. Scripts: `npm start` / `ios` / `android` /
`web` / `lint` (eslint-config-expo).
