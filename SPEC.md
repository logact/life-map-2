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
`notes[]`, and adjacency lists `startEdges` / `endEdges`.

| Kind   | Class    | Shape on map            | Extra fields |
|--------|----------|-------------------------|--------------|
| Goal   | `Goal`   | Large circle (52)       | `description?`, `targetDate?`, `completedAt?` |
| Task   | `Task`   | Rounded square (40)     | `status` (stored), `startedAt?`, `completedAt?`, `dueDate?`, `recur?` + occurrence `log?` (§1.3) |
| Record | `Record` | Small dot (20)          | `note`, `createdAt`, `occuredAt` — a leaf; nothing attaches under it |

### 1.2 Edges — directed roads with layers

`Edge(node1 → node2)` is **directed** (arrowhead into `node2`). Each edge has
`layer` (0 = root), an optional `bend` point (renders as two
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

**Recurring tasks step out of the machine** (`src/domain/recur.ts`): a task
with a `recur` rule (every N days, every N weeks on picked weekdays, or
every N months, from an anchor day) is never permanently done — `complete`
appends to its occurrence `log` instead (backdatable like every stamp;
`reopen` un-logs the latest; `start`/`pause` don't apply). Its status is
derived from rule + log with attention semantics: due today or overdue →
todo (the road into it asks with it); current or done today → done. Goal
rollups skip recurring tasks entirely — an ongoing habit never blocks its
goal's "done". A streak counts consecutive scheduled days with a log.

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

- **Node copy**: payload only (kind/title/notes/kind data), no edges.
- **Edge copy**: deep — endpoints + the whole `childrenEdges` subtree;
  endpoint copies are trimmed of outside edges.
- **Road copy**: every selected edge with its subtree; shared nodes/edges
  are captured once via an id→key memo (a diamond stays a diamond).
- **Paste**: recreates everything with fresh ids at the tapped point,
  centered on the snapshot's bounding-box center; pasted edges become layer-0
  roots with re-layered subtrees; statuses and timestamps copy verbatim.

### 1.8 Tags

Tags are named, colored labels that cut across the node tree (Health,
English, App …). The doc holds a **registry** (`doc.tags`, id →
`{ id, name, color }`); nodes reference tags by id (`tagIds?`), so a
rename or recolor happens in one place, not per node.

- **Names are unique** after trim + case-fold: adding a duplicate name is a
  no-op (the UI selects the existing tag instead of creating a twin).
- **Color** is one of the 10-color Okabe-Ito palette (`src/ui/palette.ts`),
  defaulting to the next palette entry by registry size; `setTagColor`
  recolors in place.
- **Commands**: `addTag` / `renameTag` / `setTagColor` / `deleteTag`
  (removes the registry entry and every reference to it in one undoable
  edit) / `setNodeTags` (replaces a node's list, dropping unknown ids).
  Copy/paste carries `tagIds` verbatim; pasted ids missing from the
  registry are kept but simply never render.
- Tags are **edited from the node info card** (chip row + picker sheet).
  Canvas markers and filtering by tag are future layers on top of this
  model.

### 1.9 The calendar read model (`src/domain/calendar.ts`)

`calendarMonth(doc, year, month0, now)` derives, for one month and keyed by
day-of-month, everything the document pins to a day: records (`occurredAt`),
goal target dates, task/goal `startedAt`/`completedAt` stamps, task due
dates, and a habit's whole month — every scheduled day classified against
`now` (**Missed** / **Due today** / **Scheduled**) plus every logged day (a
log on an unscheduled catch-up day still happened; a logged scheduled day
reads as done, never missed). A task's due date classifies too:
**Overdue** / **Due today** ask for attention, a future pin is a plain
deadline, a finished task's pin is history. Each item carries a **tone**
(attention / primary / done / neutral / future) that fixes both its dot
color and its row order inside a day. Pure like the recurrence
derivations: `now` is an explicit parameter, so the rules test without a
clock.

---

## 2. Persistence (`src/data/lifeMapStore.ts`)

Local **SQLite** (`lifemap.db`, WAL mode) — no server, no account.

- `nodes(id, kind, title, x, y, data)` — kind-specific fields live in
  the `data` JSON blob.
- `notes(id, node_id → nodes ON DELETE CASCADE, text, created_at,
  updated_at, position)`.
- `edges(id, node1_id, node2_id, parent_edge_id, position, layer,
  bend_x, bend_y)` — stores the whole edge tree.
- `tags(id, name, color)` — the tag registry; a node's `tagIds` live in its
  `data` blob.
- `meta(key, value)` — app-level flags that are not map content (currently
  just `seed_applied`).
- **Save** = full rewrite inside one transaction, debounced through a
  serialized save queue (`scheduleSave`) so rapid mutations stay ordered.
- **Load** on app start; an empty database — or, exactly once, a database
  from before the seed existed — seeds the tutorial map (§3.5). The
  `seed_applied` meta flag records that the seed has fired; every launch
  after that loads the user's own edits.
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

- *Base camera*: identity (natural size) by default — on first content the
  camera just centers on it. A computed fit (`fitZoom.ts`: zoom-**out**
  only, ≤ 1, floor 0.25) applies only when the **fit button** (one-tap
  overview) is pressed.
- *Pinch zoom* multiplies the base camera (0.25×–4×), anchored at the pinch
  midpoint. Nodes render at natural size (52/40/20) at ≥ 1×; below 1× pins
  and titles shrink with the camera (titles drop out under 18px pins), so
  proportions — and no-overlap — hold at every zoom. Edges trim rim-to-rim
  against the RENDERED pin size (`rimOffset`: the plain world radius at
  ≤ 1×, shrinking with the camera past 1×), so roads stay glued to their
  pins at any zoom. Lens steps reveal/collapse children in place — a spread
  that lands too cramped zooms the camera in toward the revealed group (a
  roomy camera is left alone): deliberate actions (the Zoom-in button, menu
  Expand) center the group on screen, while a spread fired mid-pinch pivots
  the extra zoom on the pinch midpoint, so the camera never jumps away from
  the fingers.
- *Pan* = one-finger drag on empty canvas.
- A world-anchored dot grid (spacing 28, doubling as needed) keeps a constant
  look at any zoom.

### 3.2 Visual language

Grayscale theme (`theme.ts`: INK scale, `ACCENT` blue reserved for route
highlights). **Status rides on color** (`STATUS_COLOR`): Okabe-Ito hues,
colorblind-safe, none of them blue so the route highlight stays
unambiguous. Objects with no status (records, and roads touching records)
use neutral grays. Tag colors come from the 10-color Okabe-Ito palette
(`palette.ts`).

| Status      | Node outline & edge stroke                          |
|-------------|-----------------------------------------------------|
| todo        | gray `#8e8e94`                                      |
| in-progress | orange `#E69F00`                                    |
| done        | green `#009E73`; node title also struck through & faded |

Selection, route-preview and spotlight overrides (near-black, `ACCENT`
blue, secondary gray) always win over status colors. A recurring task's
pin carries a small ↻ badge at its corner — fading out with the title
under 18px pins — that turns full ink while the habit is due. A
**collapsed edge**
(hidden children) splits into one equal-length segment per hidden child,
each segment taking its child's status color, with solid markers at the
breakpoints. Edge width thins with layer (`max(1.5, 3−layer)`); every
directed edge ends in an arrowhead. All strokes and markers use
non-scaling rendering so they keep a constant screen size at any zoom.

### 3.3 Gestures

| Gesture | Target | Action |
|---|---|---|
| Single tap | node | Focus: info card in the bottom panel (kind · dates, a status row with the legal transition buttons, plus a peek of the newest note — the full list opens in a notes sheet). The title and the goal's description / record's note edit in place (tap the text; saves on submit, blur, or tap-away) + the node itself highlights (no edge spotlight) + connect handle on the node |
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
cancels the tween. Submenus (kind picker) open one level
down inside the same panel. Destructive rows confirm in place: first tap
arms ("tap again"), second fires. Sheets survive only for text work (create
form, notes, route query, note search).

- **Node menu**: New successor (creates a node this one points to:
  goal/task/record), New predecessor (creates a node pointing here:
  goal/task — records are leaves, so neither a record node nor a record
  predecessor can point at anything), Copy
  (trimmed payload snapshot), Remove. When exactly one **visible** road
  touches the anchor in the requested direction, the new node is inserted
  mid-road instead: `A → B` becomes `A → N → B` at the layer on screen
  (N at the old midpoint, both halves become the
  selection; a collapsed sub-road rides with the `N → B` half).
  Otherwise — no road, a fork, or a record successor — a fresh branch
  lands along the road direction: successors directly above the anchor,
  predecessors directly below, fanning out within 45 degrees of that line
  (radius 120).
- **Edge menu**: Expand (leaf edges only; the revealed child edges become
  the zoom selection, as after a pinch spread), Summarize with… (multi-select
  same-parent edges, then confirm), Copy (deep), Straighten (only when
  bent), Remove edge.
- **Create menu** (double-tap empty canvas): Goal / Task / Record at the
  tapped point, plus Paste when the clipboard is non-empty, plus **Load the
  tutorial** — a separated destructive row (two-tap confirm) that replaces
  the whole map with the tutorial seed via one `replaceDoc` edit, so undo
  restores the old map; lens and camera reset to a folded, centered view.
- **Inline editing**: on the node's single-tap info card, tapping the
  title or the description/note row turns it into a text field in place
  (the panel rides above the keyboard); the edit commits on submit, on
  blur, or when the card dismisses. The card also carries the status row:
  current status plus one button per legal transition (tasks Start /
  Pause / Mark done / Reopen — a recurring task instead logs: Log done /
  Undo last log, and the row shows its due state with a "N logged ·
  streak K" line underneath; goals only Mark done / Reopen, toggling the
  manual completion flag; records none), acting immediately. Tappable
  date rows (a record's Occurred, a task's Due/Started/Done, a goal's
  Target — the two planned dates with a live countdown) open a small
  calendar and rewrite the stamp in
  one undoable command; a task's Repeat row opens the recurrence rule
  editor (frequency, interval, weekdays, Starts day; Clear stops it), and
  a goal's target date can also be set right in the create form. A task's
  due date is a one-off planning pin — display only, never a status — and
  setting a recurrence rule clears it (the rule owns the schedule).
- **Notes**: the node's single-tap info card shows only a peek of the
  newest note; tapping it opens the modal notes sheet — full list
  (newest first), add, edit, delete (in-place two-tap). Text entry opens
  the modal note editor on top.
- **Undo/redo** buttons top-right, plus a **fit button** below them (one-tap
  overview: the camera fits every visible node; pinch spread walks back to
  natural size); **route query** button opens the
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

### 3.5 First-launch seed

First launch (empty DB) seeds the tutorial map (`src/domain/seedDoc.ts`): ONE
directed road of lessons that teaches the whole gesture language by example —
tap (the info card), notes, long-press drag, the connect handle, goals as
destinations (a mid-road milestone goal marked done), double-tap create, and
road layers (the last stretch is expanded, hiding two zoom micro-lessons) —
ending at the "Make this map yours" goal. A record dots the roadside and a
daily habit branches off it — logged twice, due today, so the recurrence
badge and the Log done button demo live; the
first lessons are pre-done and one is in-progress, so all three status styles
show on first launch; an isolated "Ideas" node floats unconnected. A tutorial
has no history, so every timestamp stamps honestly at build time. The same
tutorial loads on demand from the create menu's "Load the tutorial" row
(§3.4) — no reinstall needed. The earlier real-life seed it replaced is
recorded in `LIFE_PLAN.md`, and what that encoding could not express lives on
in `GAPS.md`.

---

## 4. The calendar page (`src/app/calendar.tsx`)

The document's dated side as a separate screen, pushed from the map's 📅
button (below the fit button; the route is `/calendar`).

- A **month grid** (weeks start Sunday, like the date picker and the
  recurrence rules): today is outlined, the selected day is filled, and each
  day carries up to three tone dots from `calendarMonth` (§1.9) with a
  legend underneath.
- The **selected day's list** shows every item — tone dot, node title,
  caption (Due today / Missed / Overdue / Due date / Logged / Scheduled /
  Target date / Completed / Started / Record). Month nav moves the view
  (selecting the 1st); **Today** jumps back to the current month and day.
- **Tapping an item hands the node to the map**: the page sets
  `pendingNodeFocusId` on the doc store (transient, never persisted) and
  pops back; the map consumes the id with the note search's reveal — zoom
  open the node's layer, center it, open its info card.
- **+ Schedule** (the day card's header) opens the schedule sheet
  (`src/calendar/scheduleSheet.tsx`): every schedulable node — goals and
  plain tasks (habits schedule themselves by rule; synthetic midpoints are
  structure) — with the day it's pinned to, if any. Tapping a row pins the
  node to the selected day (the goal's `targetDate`, the task's
  `dueDate`); tapping a row already on the day unpins it. Each toggle is
  one undoable `setNodeTimes` command, and the grid behind the sheet
  updates live.

---

## 5. App configuration

`app.json`: scheme `lifemap2`, iOS bundle `com.logact.lifemap`, portrait,
automatic light/dark UI style, splash `#208AEF`, EAS project
`69607ff4-…`, experiments: typed routes + React Compiler.
Path alias `@/*` → `src/*`. Scripts: `npm start` / `ios` / `android` /
`web` / `lint` (eslint-config-expo).
