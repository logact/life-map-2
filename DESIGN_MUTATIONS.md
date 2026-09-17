# Mutation Interaction Model — design proposal

Status: implemented (issue #14). This document specifies **behavior only**:
gestures, states, feedback, and flows. No visuals, components, or
implementation choices. SPEC.md §3.3–3.4 matches it.

## 1. Problem

Every node/edge mutation today lives in one bottom-sheet modal (the "mutation
sheet"): up to nine equally-weighted tiles, detached from the object they act
on. Two costs follow:

- **Choice overload.** One decision point holds creation, relation, metadata,
  and destructive verbs with near-identical labels ("Add to" / "Be added to" /
  "Connect to" / "Be connected to"). Every visit costs a full re-scan.
- **Context eviction.** The modal dims the map and covers the node being
  mutated. Some actions (connect) then close the sheet and drop the user into
  a tap-targeting *mode* — one intent bounced through three UI states, with
  the user holding "which node, and why" in working memory throughout.

## 2. Principles

1. **Actions live with the object.** All object UI (menus, info card) docks
   in one bottom panel; the camera eases the graph up so the object the panel
   is about stays visible above it. The object is never covered, and its
   identity never leaves the screen.
2. **Progressive disclosure by intent.** Never more than ~4 choices at once.
   Primary verbs first; configuration and destruction one level down.
3. **Spatial verbs are gestures, not menu items.** Connecting two nodes is
   dragging between them. Moving a node is dragging it. Menus serve only what
   cannot be a gesture.
4. **Non-modal by default.** No backdrop, no dimming, no mode lock-in for
   object-level actions. The canvas stays live; one tap elsewhere dismisses
   and retargets in a single motion.
5. **Modals are for text.** Sheets survive only where the task is reading or
   writing prose: forms, notes, search.
6. **Every mutation is undoable.** Undo/redo is the mistake-recovery backbone,
   which is what makes lightweight, confirm-free interactions safe. Truly
   destructive actions still confirm — but in place, not via alert dialogs.

## 3. Vocabulary

### 3.1 Object states

| State | Meaning |
|---|---|
| idle | Default. No selection, no focus. |
| focused | The tapped object: spotlight on (its edges/endpoints lit, rest dimmed), info card in the bottom panel, connect handle visible. |
| menu-open | The object's action menu is showing in the bottom panel. Focus/spotlight persist. |
| dragging | Node is being repositioned (long-press arm). |
| connecting | A connect-drag is in flight from a focused node. |

### 3.2 UI surfaces

| Surface | Used for | Behavior |
|---|---|---|
| Bottom panel | All object UI: info card (single tap), action menus (double tap), create menu | One card docked at the bottom of the screen; grouped rows; one level of submenu where needed. Tap elsewhere dismisses and retargets at once — no close button, no backdrop. The node info card carries only a peek of the newest note; the full notes list with add/edit/delete lives in a notes sheet. |
| Camera accommodation | Keeping the object visible | When a panel opens or grows, the camera eases up just enough that the panel's object stays clear of the panel area; an already-visible object never moves. Any user gesture cancels the tween. |
| Form sheet | Text entry / list reading | Bottom sheet, modal, keyboard-aware. The only modal surface that remains. |
| Mode banner | Genuinely multi-step selection (summarize) | Unchanged from today. |

## 4. Gesture map (matches SPEC §3.3)

| Gesture | Target | Result |
|---|---|---|
| Single tap | node | **Focus**: info card in the bottom panel + spotlight + connect handle appears |
| Single tap | focused node's menu item | Run the item |
| Single tap | edge | Info card in the bottom panel (layer, status, hidden sub-edges, zoom controls) + edge becomes zoom selection |
| Single tap | empty canvas | Dismiss any panel; clear selection (unless locked); unfocus |
| Double tap | node | Open the **node menu** in the bottom panel |
| Double tap | edge | Open the **edge menu** in the bottom panel |
| Double tap | empty canvas | **Create menu** in the bottom panel for the tapped point |
| Long press | node | Arm drag; following movement repositions the node (unchanged) |
| Long press | edge | Arm bend-drag; next canvas drag places the bend point (unchanged) |
| Drag from connect handle | node → node | **Connect** (§6) |
| Pinch | canvas | Camera zoom + detail stepping (unchanged) |

Deliberate removals: the "Connect to / Be connected to" tap-targeting mode and
its banner; all five mutation bottom sheets (node, edge, kind picker, status
picker, color picker).

## 5. Node mutations

### 5.1 The node menu

Double-tap a node → menu in the bottom panel. Content adapts to node kind
(progressive disclosure); items that can never apply are not shown, never
disabled-grayed.

| Group | Item | Kinds | Behavior |
|---|---|---|---|
| Create | **New successor** | goal, task | Opens kind submenu (Goal / Task / Record) in the same panel → picking a kind opens the create form sheet → on save, the new node fans out around this one (golden-angle, as today) with the edge pointing this → new. |
| Create | **New predecessor** | all | Same flow with the edge pointing new → this; kind submenu offers Goal / Task only (records are leaves: a new record cannot point here). |
| Edit | **Edit details** | all | Opens the inspector form sheet (title + kind-appropriate fields). *Restored a flow that was unreachable before this redesign.* |
| Edit | **Status: ‹verb›** | goal, task | One menu item per *legal* transition from the current state, labeled by its target state — see §5.2. Acts immediately, no follow-up UI. Records show none. |
| Edit | **Color** | all | Opens a swatch submenu in the same panel (palette + Default). Pick applies at once. |
| Clipboard | **Copy** | all | Copies the trimmed snapshot (payload only, never edges). Silent confirmation; clipboard enables Paste in the create menu. |
| — | **Remove** | all | Separated at the bottom, visually destructive. First tap arms it in place ("tap again to remove"); second tap removes. Arming resets when the menu closes. |

The Create pair names the **direction of the new edge, not a hierarchy**:
*successor* = the node this one points to; *predecessor* = the node that
points here. They replace "Add to" / "Be added to" and align with the app's
existing From/To vocabulary (route panel, edge endpoints). In the menu each
row carries a direction icon (● = this node, ○ = new node: ●→○ successor,
○→● predecessor) so the glyph reinforces the words.

### 5.2 Status items (labels by target state)

| Kind | Current | Menu items |
|---|---|---|
| task | todo | **Start** · **Mark done** |
| task | in-progress | **Pause** · **Mark done** |
| task | done | **Reopen** |
| goal | open | **Mark done** |
| goal | done | **Reopen** |
| record | — | (no status items) |

A goal's derived status stays derived; the items toggle only the manual
completion flag (unchanged semantics).

### 5.3 Remove semantics (unchanged)

Removing a node removes its incident edges; their children rise one level;
endpoints left edgeless become isolated root nodes. Two-tap in-place confirm
(§5.1), then undo is available.

## 6. Connect by drag (replaces connect mode)

1. A focused node shows a **connect handle** on its body.
2. Dragging from the handle starts a connect-drag: a live tentative edge
   follows the finger, drawn from the source toward the touch point.
3. Nodes the finger passes over are evaluated as targets; the current
   candidate highlights. The tentative edge snaps to it.
4. **Drop on a node** → create the edge, source = drag origin, target = drop
   node. Direction *is* the drag direction — one gesture replaces both
   "Connect to" and "Be connected to". The new edge appears immediately,
   undoable.
5. **Drop on the source node itself, or on empty canvas** → cancel. Nothing
   changes, no error UI; the tentative edge animates away.
6. The command layer remains the only guard of structural invariants (e.g.
   records-as-leaves); the gesture itself imposes no extra rules.
7. Discoverability: the handle exists only on the focused node, and focusing
   is one tap — so the capability surfaces exactly when the user is already
   attending to that node.

Open question for review: should dropping on empty canvas offer "create a node
here and connect"? Proposal: **no** in v1 — cancel only. Revisit after the
base gesture beds in.

## 7. Edge mutations

Double-tap an edge → edge menu in the bottom panel:

| Item | Shown when | Behavior |
|---|---|---|
| **Expand** | edge has no hidden children | Inserts the synthetic midpoint task as two child edges (as today). |
| **Summarize with…** | always | Enters summarize mode (banner + tap same-parent edges + confirm) — the one surviving mode, since it is genuinely a multi-target selection. Illegal selections are rejected by the domain, surfaced as a plain message, nothing applied. |
| **Copy** | always | Deep copy: endpoints and the whole hidden subtree come along (as today). |
| **Straighten** | edge has a bend | Clears the bend point. |
| **Color** | always | Swatch submenu in the same panel (palette + Default). |
| **Remove edge** | always | Two-tap in-place confirm; children rise one level (as today). |

Single-tap edge behavior (info card + zoom selection, Zoom in / Collapse
controls) is unchanged. Long-press bend-drag is unchanged.

Road-level mutation (selection bar long-press: Copy road / Edit route query)
uses the same bottom panel; the camera does not move for it (the selection
bar lives at the top of the screen).

## 8. Creation & clipboard

- Double-tap empty canvas → **create menu** in the bottom panel:
  Goal / Task / Record, plus **Paste** when the clipboard is non-empty. The
  camera keeps the tapped point visible above the panel.
- Picking a kind opens the create form sheet; on save the node appears at the
  tapped point (as today).
- Paste recreates the snapshot centered at the tapped point with fresh ids
  (as today), undoable.

## 9. What stays a sheet — and why

Create-node form, inspector, notes sheet, note editor, route query panel,
note search. These are reading/writing tasks where a keyboard is up and the
canvas is background anyway; a modal sheet is the right container. Everything
that is a *verb on a visible object* never uses a sheet. Notes live in the
modal notes sheet (list + add/edit/delete), opened from a newest-note peek on
the node's single-tap info card; their text editor is a sheet stacked on top.

## 10. Attention rules (the concentration half of the fix)

1. **No backdrop, no dimming** for object UI. The map stays fully rendered
   and interactive behind the panel.
2. **One tap does one thing.** Tapping another object while a menu is open
   closes the menu *and* focuses that object — never a dead "close-only" tap.
3. **The object stays visible.** The panel never covers the graph: the camera
   eases the map up so the panel's object sits clear of the panel area (and
   an already-visible object never moves). Focus (spotlight) persists while
   the menu is open.
4. **No mode lock-in** except summarize. Every other flow is a gesture or a
   menu pick that completes in place.
5. **Confirmation is in place and two-step** (destructive items arm, then
   confirm), never a blocking alert.
6. **Undo/redo everywhere** — unchanged, and load-bearing: it is what allows
   rules 1–5 to stay lightweight.
7. Reduce-motion and the status visual language (§3.2 of SPEC) are untouched.

## 11. Edge cases & decisions

| Case | Decision |
|---|---|
| Synthetic midpoint nodes (from Expand) | Treated as regular tasks: full node menu. They are structure the user may legitimately want to edit or remove. |
| Object under the panel area | The camera eases up so the object clears the panel (§10.3); if the user pans the object back under, their gesture wins — no re-accommodation until the next panel open. |
| Connect-drop on an already-connected pair | Allowed (the map permits parallel edges); undo covers regret. |
| Locked zoom selection | Unchanged; opening a panel does not clear a locked selection. |
| Records | No New successor, no status items; New predecessor offers Goal / Task only — enforced by omission in the menu, matching the domain invariants (records are leaves: a record never points at another node). |
| Clipboard empty | No Paste item in the create menu (omission, not disabled). |

## 12. What changes vs. today

| Today | Proposed |
|---|---|
| Node sheet: 9 tiles in a modal | Node menu in the bottom panel, grouped, per-kind (§5) |
| Edge sheet modal | Edge menu in the bottom panel (§7) |
| Kind picker sheet | Kind submenu in the same panel (§5.1) |
| Status picker sheet | Legal transitions listed directly in the menu (§5.2) |
| Color picker sheet | Swatch submenu in the same panel |
| Connect to / Be connected to + mode banner | Drag from connect handle (§6) |
| Remove confirmed via sheet | Two-tap in-place confirm |
| Info card pinned to bottom of screen | Info card in the bottom panel + camera accommodation |
| Inspector unreachable (no entry point) | "Edit details" menu item restores it |
| Summarize mode | Kept as the only mode |
| Undo/redo, zoom lens, route query, notes | Unchanged |

## 13. Non-goals

- Visual styling (icon set, tile geometry, typography) — downstream of this
  model; the issues behind #14's screenshot are revisited once behavior lands.
- Changes to the domain invariants, command set, or persistence.
- Changes to the zoom lens, route query, or note search internals.
