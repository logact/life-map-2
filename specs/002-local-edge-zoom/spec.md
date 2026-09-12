# Feature Specification: Local Edge Zoom (Selection-Scoped Detail)

**Feature Branch**: `002-local-edge-zoom`
**Created**: 2026-09-12
**Status**: Draft
**Input**: User description: "Change the zoom and layer workflow: we don't always scale or zoom the whole map — we can also expand the specified edge. Single tap selects the edge and shows a closable info card; the route query can select a whole road (multiple edges). Zoom (reveal) is a pure view operation, distinct from domain 'expand'. Pinch changes the camera AND shows more detail. Selection is hereditary: edges revealed by zooming a selected edge/road inherit the selection, and collapse operates on the selected edges/roads."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zoom into one branch without disturbing the map (Priority: P1)

The user is looking at the whole map and wants to see the hidden sub-structure of one particular connection. They tap the edge once to select it (an info card appears and can be dismissed), then spread two fingers over it. The camera zooms in toward that edge AND the edge reveals its hidden children one level at a time. Every other part of the map stays exactly as it was — no unrelated branches pop open.

**Why this priority**: This is the core value of the feature. Today, showing more detail is all-or-nothing: stepping a layer reveals the depth of the entire map at once, burying the branch the user actually cares about under noise from every other branch.

**Independent Test**: On a map with multiple expanded branches, select one collapsed edge that has hidden children, pinch-spread over it, and verify only that edge's children appear; repeat on a second branch and verify the first branch's revealed state persists.

**Acceptance Scenarios**:

1. **Given** a collapsed edge with hidden children is visible, **When** the user single-taps it, **Then** the edge is visually marked selected and a closable info card describes it.
2. **Given** a selected edge with hidden children, **When** the user pinch-spreads over it, **Then** the camera zooms toward the pinch point and the edge is replaced by its children, one level per pinch step.
3. **Given** a selected edge with hidden children, **When** the user zooms it open, **Then** all revealed child edges become selected (selection is hereditary).
4. **Given** a selected edge and unselected collapsed edges elsewhere, **When** the user pinch-spreads, **Then** only selected edges reveal children; unselected edges are unaffected.
5. **Given** no selection, **When** the user pinch-spreads or squeezes, **Then** only the camera zoom changes; no edges reveal or hide children.

---

### User Story 2 - Collapse back out along the selection (Priority: P1)

After zooming into a branch, the user wants to roll the detail back up. They pinch-squeeze: the camera zooms out and the deepest selected edges collapse back into their parents, one level per pinch step, until the selection is back at the top level. The selection follows the collapse upward, so the user never loses track of what they are looking at.

**Why this priority**: Zoom without a way back is a dead end; collapse must be as fluid as reveal or the feature cannot ship.

**Independent Test**: Zoom a selected edge open two levels, then pinch-squeeze twice and verify each squeeze collapses exactly one level of the selected frontier and the parent edges become selected.

**Acceptance Scenarios**:

1. **Given** selected edges that were revealed by zooming, **When** the user pinch-squeezes, **Then** the deepest selected visible edges are replaced by their parent edges, which become selected.
2. **Given** a selected edge whose siblings are unselected, **When** the user collapses it, **Then** the entire sibling group collapses into the shared parent (a parent and its children are never visible at the same time).
3. **Given** a selection containing edges at different depths, **When** the user pinch-squeezes, **Then** only the deepest selected edges collapse on that step.
4. **Given** selected edges with no expandable parents visible (top level reached), **When** the user pinch-squeezes further, **Then** only the camera zooms out.

---

### User Story 3 - Zoom a whole road at once (Priority: P2)

The user runs the route query, picks a road (a path of several edges), and that road becomes the selection. Pinch-spreading then reveals the next level of detail along the entire road at once — every selected edge with hidden children opens — so the user can study the full journey, not just one hop. Squeezing rolls the whole road back up.

**Why this priority**: Roads are how users think about the map ("how do I get from Health to Career?"). Per-edge zoom alone would force repetitive edge-by-edge work along a path.

**Independent Test**: Select a 3-edge route via the query where each edge has hidden children, pinch-spread once, and verify all three edges reveal their children simultaneously; squeeze once and verify the whole road collapses back.

**Acceptance Scenarios**:

1. **Given** a confirmed route whose edges include collapsed edges with hidden children, **When** the user pinch-spreads, **Then** every selected edge reveals its children and the new child edges join the selection.
2. **Given** a road zoomed open along its full length, **When** the user pinch-squeezes, **Then** the deepest selected level along the whole road collapses in one step.

---

### User Story 4 - Non-gesture zoom controls (Priority: P3)

Users who find pinch imprecise (or use assistive input) can zoom and collapse from the selection's info/action UI: explicit "Zoom in" and "Collapse" actions that perform exactly one level of the same operations.

**Why this priority**: Accessibility and precision fallback; the gesture path already delivers the core value.

**Independent Test**: Select an edge, trigger "Zoom in" from its info UI, and verify the same result as one pinch-spread step; trigger "Collapse" on a revealed child and verify the same result as one pinch-squeeze step.

**Acceptance Scenarios**:

1. **Given** a selected edge with hidden children, **When** the user activates "Zoom in" from its info UI, **Then** the edge is replaced by its children exactly as a pinch step would do.
2. **Given** a selected revealed edge, **When** the user activates "Collapse", **Then** its sibling group collapses into the parent exactly as a pinch step would do.

---

### Edge Cases

- **Selected edge has no hidden children**: zoom-in steps do nothing to it (camera still zooms); no error is shown.
- **Domain "expand" (splitting an edge to add a sub-node) is unchanged**: it remains a separate editing action. Zooming an edge that was never expanded reveals nothing until the user expands it in the editing sense.
- **Selection cleared**: tapping empty canvas or removing a selected edge clears/prunes the selection; after clearing, pinch controls the camera only.
- **Camera coherence on collapse**: when collapsing hides the nodes the camera was zoomed into, the camera zooms out so the remaining selected content stays on screen (no "lost in empty space" moment).
- **Route/summarize/drag interactions**: existing features that read the visible edge set (route search, summarize selection, bend drag) continue to work on whatever edges are visible under the new mixed-depth view.
- **Reset**: a fit/reset action returns the view to the top layer and the fit-to-screen camera.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Single-tapping an edge MUST mark it selected (distinct visual state) and show a closable info card for it.
- **FR-002**: A route query result MUST be applicable as a multi-edge selection covering the whole road.
- **FR-003**: The system MUST maintain the visible edge set as a frontier of the edge tree: a visible edge's children are never visible at the same time.
- **FR-004**: Users MUST be able to reveal the hidden children of selected edges one level at a time ("zoom in"), as a pure view operation that does not modify map data.
- **FR-005**: Edges revealed by zooming a selected edge MUST inherit the selection.
- **FR-006**: Users MUST be able to collapse selected revealed edges one level at a time ("zoom out" of detail), replacing each affected sibling group with its parent; the parent MUST inherit the selection.
- **FR-007**: Collapse MUST operate on whole sibling groups so the frontier invariant (FR-003) is preserved.
- **FR-008**: With an active selection, pinch-spread MUST zoom the camera in AND zoom selected edges one level deeper per gesture step; pinch-squeeze MUST zoom the camera out AND collapse the deepest selected edges one level per step.
- **FR-009**: With no selection, pinch MUST affect the camera only.
- **FR-010**: Pinch camera changes MUST stay anchored at the pinch midpoint (the content under the fingers does not drift).
- **FR-011**: When a collapse hides content the camera was focused on, the camera MUST adjust so the remaining selected content stays visible.
- **FR-012**: The selection MUST survive zoom/collapse steps and MUST be cleared by tapping empty canvas or when its edges are removed.
- **FR-013**: Mixed-depth selections MUST resolve one level at a time, acting on the deepest selected edges first (for both zoom and collapse direction: zoom acts per-edge on any selected edge that has children; collapse acts on the deepest selected level).
- **FR-014**: The auto fit-to-screen zoom MUST serve as the initial view and reset target; user pinch zoom MUST compose on top of it rather than being overwritten by it.
- **FR-015**: The edge info UI MUST offer explicit one-level "Zoom in" / "Collapse" actions equivalent to the gesture steps.
- **FR-016**: Zooming an edge with no hidden children MUST be a no-op for detail (camera zoom still applies); no error.
- **FR-017**: Existing visible-edge consumers (route search, summarize, edge info, bend drag, status rendering) MUST keep working unchanged against the mixed-depth visible set.

### Key Entities

- **Selection**: the set of edges currently in scope for zoom/collapse; populated by edge tap or route query; hereditary across zoom (children inherit) and collapse (parent inherits); cleared by empty-canvas tap or edge removal.
- **Zoom state (view)**: which edges are currently revealed vs. collapsed — pure view state layered on the map, independent of the map's stored structure. Distinct from the domain "expand" edit, which creates sub-structure.
- **Camera**: fit-to-screen base zoom plus a user-controlled zoom/pan offset anchored at gesture midpoints.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can reveal the hidden detail of a chosen branch in at most 2 gestures (tap + pinch) without any other branch changing.
- **SC-002**: Zooming one edge open leaves 100% of unselected edges in their previous visible state.
- **SC-003**: Users can travel from fully zoomed-in detail back to the top-level overview using only pinch gestures, with the content under their fingers staying in place at every step.
- **SC-004**: A whole road can be zoomed one level in a single pinch, regardless of how many edges it contains.
- **SC-005**: All zoom/collapse interactions complete within one gesture step (no multi-screen navigation or mode switching required).

## Assumptions

- "Zoom" in this feature always means the view operation (reveal/hide existing children); the editing operation that creates sub-nodes keeps the name "expand" and is out of scope for changes.
- Pinch "spread" (fingers moving apart) means zoom in / more detail; "squeeze" means zoom out / less detail.
- Selection is single-purpose: the same selection drives zoom/collapse; summarize mode keeps its own separate selection behavior.
- One level per gesture step is the right granularity for both zoom and collapse.
- The demo-map presentation quality (labels, edge styles at mixed depths) is already acceptable and needs no redesign.
