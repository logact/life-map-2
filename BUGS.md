# Bug list — life-map-2

Generated from a full codebase review (2026-09-15). Ordered by severity. IDs are stable — reference them as e.g. "fix B3". Each item: what's wrong, where, the fix, and how to verify.

## P0 — Critical: broken features / data risk

### B1 — Bend-drag never commits fixed

`src/app/map.tsx:1443` (handler at `:1524–1540`)

The once-created `useRef(PanResponder.create(...))` captures the _first render's_ `layerView` and `run`, which belong to the empty pre-load map. `layerView.edges.find(...)` at `:1530` always misses → bend is silently discarded on release. Latent worse case: if it ever hit, the stale `run` would `scheduleSave` the detached empty map and wipe the DB.

- **Fix:** inside the responder, read `layerViewRef.current` / `mapRef.current`, and route the commit through a `runRef` (same pattern as `pinchRef`/`closeOverlaysRef`).
- **Verify:** long-press edge → drag → release → bend persists after app restart.

### B2 — Failed DB load = permanent blank screen

`src/app/map.tsx:1128`, gate at `:2142`; `src/data/lifeMapStore.ts:102`

`.catch` only logs, so `setMapLoaded(true)` never runs. Compounded by unguarded `JSON.parse(row.data)` — one corrupt row bricks every launch.

- **Fix:** in the catch, seed demo/empty map + `setMapLoaded(true)`; wrap row deserialization in try/catch (skip bad rows, log count).
- **Verify:** corrupt a `nodes.data` value → app still opens.

### B3 — Node inspector unreachable (no way to rename/edit nodes) — fixed

Fixed 2026-09-17 by the mutation-menu redesign (DESIGN_MUTATIONS.md): the
double-tap node menu has an "Edit details" row that seeds `inspectorDraft`
from the node and opens the inspector; Save now persists title **and**
description/note as one undo step (`renameNode` + the new `setNodeDetail`
command).

- **Verify:** double-tap node → Edit details → change title → visible on canvas after Save.

### B4 — Note search unreachable

`src/app/map.tsx:1197` (`enterNoteSearchMode` never called; ESLint flags it unused)

- **Fix (recommended):** add an entry point — e.g. a second toolbar button or long-press on 🔍 — calling `enterNoteSearchMode`. Alternative: delete `NoteSearchPanel`, `focusNoteNode`, `noteResults`, `noteSearchMode`/`noteQuery` state, and `LifeMap.searchNotes`.
- **Verify:** search finds a note on a node hidden in a collapsed layer; tapping it reveals and centers the node.

### B5 — Records can become parents

`src/app/map.tsx:2611` (picker) → `:1959–1962` (save)

"Be added to" offers Record for the parent direction, violating "records are leaves" (`src/domain/lifeMap.ts:319`) which the child direction enforces (`:2466`).

- **Fix:** in the kind picker (`:2618–2622`), filter out Record when `direction === "parent"`.
- **Verify:** "Be added to" on any node shows only Goal/Task.

### B6 — Summarize accepts invalid selections

`src/app/map.tsx:2055–2064`; `src/domain/lifeMap.ts:348`

Only `boundary.length < 2` is rejected; a star or disjoint selection (3+ boundary nodes) silently creates an edge between two arbitrary nodes.

- **Fix:** require `boundary.length === 2` and that the selection forms one connected directed chain (walk from the boundary source; every selected edge visited, each interior node has exactly one selected in- and out-edge). Alert and abort otherwise.
- **Verify:** selecting two disjoint chains → alert, no mutation; a clean chain still summarizes.

## P1 — State integrity around gestures & undo

### B7 — Undo/redo keeps stale interaction state

`src/app/map.tsx:937–949`, `closeOverlays` at `:1005–1016`

`applySnapshot` doesn't reset `routes`/`pickedRoutes`/`routeMode`/`routeFromId`/`routeToId`/`summarizeMode`/`selectedEdgeIds`/`bendDrag`/`connectSourceId`/`connectTargetId`/`freeSpacePicker`/`createTarget`/`selectionLocked` — all may reference the detached pre-undo graph.

- **Fix:** extend `applySnapshot` (or `closeOverlays`) to clear all of the above (reuse `clearRouteState()`).
- **Verify:** arm a bend drag or open route mode, press undo → no stuck banner, no phantom route highlight.

### B8 — Stolen node drags commit a position

`src/app/map.tsx:809–812`

`onPanResponderTerminate` calls `onDragEnd` → partial drag persisted + spurious undo entry.

- **Fix:** add `onDragCancel` that just does `setDrag(null); setDragArmedId(null)`; call it from Terminate.
- **Verify:** start a node drag, trigger a system interruption (e.g. Control Center swipe) → node snaps back, no undo entry.

### B9 — Pan/pinch can't start on a node or edge

`src/app/map.tsx:1445`

Container responder has no `onMoveShouldSetPanResponder`; node Pressables/SVG hit areas own their touches, so the camera can't move when the gesture starts on content — most of a dense map.

- **Fix:** add `onMoveShouldSetPanResponder: (_e, g) => !dragArmedIdRef.current && !bendDragRef.current && (|dx|>4 || |dy|>4)` (mirror the armed-state into refs). Node drags still win because the armed node's responder is deeper.
- **Verify:** drag starting on an unarmed node pans the canvas instead of tapping.

### B10 — Stale `selectionLocked` in node-tap timer

`src/app/map.tsx:1716`

Reads state inside a ≤300 ms `setTimeout` closure; `selectionLockedRef` (`:1035`) exists but is only used by the canvas-tap path (`:1557`).

- **Fix:** read `selectionLockedRef.current` in `onNodeSingleTap`.
- **Verify:** tap node, lock selection within 300 ms → selection survives.

### B11 — Tap timers survive mode changes and unmount

`src/app/map.tsx:1781`, `:1824`, `:1551`

A pending single-tap fires during route/note-search mode, opening an info card over the panel.

- **Fix:** cancel `nodeTapRef`/`edgeTapRef`/`canvasTapRef` in `enterRouteMode`/`enterNoteSearchMode`; clear all three in an unmount effect.
- **Verify:** tap node, immediately open route mode → no info card appears.

### B12 — Arrowheads float when pinch-zoomed in

`src/app/map.tsx:2191` vs `:1621`, `:2296`

Tip offset uses world `nodeSize/2`, but at ≥ 1× zoom nodes render at a fixed screen size, so their world footprint is `nodeSize / cam.scale` and shrinks as the camera zooms in.

- **Fix:** divide the offset by `cam.scale` (compute per-edge from the composed camera).
- **Verify:** pinch to max zoom → arrowheads still touch node borders.

### B13 — `expand` pollutes goal status rollup

`src/domain/status.ts:51` + `src/domain/lifeMap.ts:329`

`expand()` inserts a synthetic `Task` midpoint; `goalStatus` counts it as a child task, flipping the derived status.

- **Fix:** mark synthetic nodes (e.g. `synthetic: true` on the node) and exclude them in `goalStatus`/`nodeStatus` — or make the midpoint a status-less kind. Pick one convention and persist it (schema blob field).
- **Verify:** expand a done goal→task edge → goal still shows done.

### B14 — New children overlap after a deletion

`src/app/map.tsx:321`, `:1953`, `:1980`

Golden-angle index derives from current edge count; after removing a child, the next add reuses an angle and stacks exactly on a sibling.

- **Fix:** derive the angle from surviving children's actual positions (first free slot), or keep a per-parent monotonically increasing counter.
- **Verify:** add 3 children, delete one, add another → no overlap.

## P2 — Data layer & domain robustness

### B15 — No schema versioning / FK pragma / open-failure caching

`src/data/lifeMapStore.ts:16–58`

(a) `PRAGMA foreign_keys = ON` missing → `ON DELETE CASCADE` inert; (b) no `PRAGMA user_version` → first schema change strands existing installs; (c) a rejected `openDatabaseAsync` is cached forever in `dbPromise`.

- **Fix:** add both pragmas to SCHEMA, add a migration block keyed on `user_version`, reset `dbPromise = null` on open failure.
- **Verify:** fresh install and an existing DB both load; forced open failure → next `scheduleSave` retries.

### B16 — Duplicated node lookup

`src/app/map.tsx:128` vs `src/domain/lifeMap.ts:123`

- **Fix:** make `LifeMap.findNode` public, delete `findDomainNode`, update call sites.
- **Verify:** `tsc --noEmit` clean; tap/drag/route-pick still resolve nodes.

### B17 — `removeNode` silently keeps the whole subtree

`src/domain/lifeMap.ts:112` (TODO at `:174`)

Deleting a node re-parents descendants to roots — surprising data retention.

- **Fix:** decide semantics (keep vs recursive delete), implement the chosen one, and make the confirm alert say what will happen (`src/app/map.tsx:1896`).
- **Verify:** delete a node with expanded children → alert text matches actual outcome.

### B18 — Route search has no early exit; length ignores bends

`src/domain/route.ts:47`, `:69`

DFS enumerates all simple paths (exponential on dense graphs) before the top-8 cut; ranking uses straight-line distance while rendering includes bends.

- **Fix:** stop the walk once `found.length` reaches a safety cap (e.g. 10× `maxRoutes`); include bend segments in the length sum.
- **Verify:** route results unchanged on the demo map; no hang on a dense test map.

### B19 — Naming hazards

`src/domain/record.ts:6`, `occuredAt` in `record.ts` / `lifeMapStore.ts`

`class Record` shadows the global `Record` utility type; the `occuredAt` typo is baked into the persisted JSON blob.

- **Fix:** rename the class to `RecordNode` (keep alias imports working), and either keep `occuredAt` forever or add a store migration that rewrites the key (do with B15b).
- **Verify:** `tsc` clean; old DBs still load.

## P3 — Performance

### B20 — `[FLOW]` console.log in render/gesture paths

`src/app/map.tsx:94, 886, 918, 931, 1426, 1545, 1629`, plus ~15 event logs

Logs every render (every drag frame), ships in release.

- **Fix:** delete them all, or gate behind a single `if (__DEV__ && DEBUG_FLOW)` flag.
- **Verify:** `grep -c "FLOW" src/app/map.tsx` → 0 (or only gated).

### B21 — Full React re-render per gesture frame

`src/app/map.tsx:1512/1584/1500`, grid at `:2131–2138`, `:2151`

Every pan/drag move rebuilds view models, the SVG edge tree, and ~400 index-keyed grid circles.

- **Fix (staged):** (a) cheap — memoize the grid (rebuild only when the quantized origin/scale changes) and `mapDomainToViewModel` on `[version]`; (b) real fix — move camera (`cam`, `viewport`) into Reanimated shared values driving an animated `G` transform so pan/pinch never re-render React.
- **Verify:** pan a 100-node map on a physical device without frame drops (RN perf monitor).

### B22 — One infinite animation per in-progress segment/node

`src/app/map.tsx:409–464`, used at `:2226`, `:2313`

A collapsed in-progress edge with N children = N independent UI-thread loops.

- **Fix:** hoist a single shared "clock" shared value to `MapScreen` and pass it to all `MarchingPolyline`/`PulsingRing` instances.
- **Verify:** many in-progress items → one running animation driver; visuals unchanged (phases may sync — acceptable).

## P4 — Hygiene & platform polish

### B23 — ESLint red: 28× `react-hooks/refs`

`src/app/map.tsx` (`:788`, `:895–898`, `:997`, `:1019`, `:1355–1358`, `:1387`, `:1615–1617`, `:2147`, …)

The write-refs-during-render pattern conflicts with `reactCompiler: true` (`app.json:44`) — the compiler assumes refs aren't read/written in render.

- **Fix:** decide direction: (a) keep the compiler → move ref syncing into effects / event handlers (or `useEffectEvent`), and read `mapRef.current` via a state version bump only; (b) keep the pattern → disable the rule for this file with a justification comment and turn `reactCompiler` off. Then `npm run lint` must exit clean in CI.
- **Verify:** `npx eslint .` → 0 errors.

### B24 — Leftover template directory `example/`

Repo root; `tsconfig.json:14–19`

~1,100 lines of create-expo-app starter still type-checked by `**/*.ts`.

- **Fix:** delete `example/` (or exclude it in tsconfig if you want to keep it).
- **Verify:** `tsc --noEmit` and lint still pass.

### B25 — Broken `reset-project` script

`package.json:43`

Points to `./scripts/reset-project.js`, which lives at `example/scripts/`.

- **Fix:** remove the script (recommended — the project is past the template stage) or fix the path.
- **Verify:** `npm run` shows only working scripts.

### B26 — README is the Expo template

`README.md`

- **Fix:** replace with: what the app is, gestures (tap/double-tap/long-press/pinch), data model (goal/task/record, layers), persistence note, dev/build commands.
- **Verify:** a newcomer can run the app from the README alone.

### B27 — No safe-area insets

`src/app/map.tsx` styles (`top: 56/108/160` at `:3330–3370`, `bottom: 100` at `:3671`, sheet `padding: 24`)

- **Fix:** use `useSafeAreaInsets()` (already a dependency) for top button offsets and bottom-sheet `paddingBottom`.
- **Verify:** on a notched device/simulator, buttons clear the status bar and sheets clear the home indicator.

### B28 — Icon-only buttons lack accessibility labels

`src/app/map.tsx:2360, 2368, 2375, 596, 491, 681–691, 743`

- **Fix:** add `accessibilityRole="button"` + `accessibilityLabel` ("Find route", "Undo", "Redo", "Lock selection", "Close", "Swap", "Show routes").
- **Verify:** VoiceOver announces each control meaningfully.

### B29 — Stale comments & useless dep

`src/app/map.tsx:3671` (references deleted "add button"), `:466` (SheetButton comment says "inspector"), `package.json` `@types/uuid`

- **Fix:** update both comments; `npm uninstall @types/uuid` (uuid ships its own types).
- **Verify:** install + `tsc` still clean.

---

## Suggested execution order

1. **B1–B6** — broken features (small, independent; one PR).
2. **B7–B12** — gesture/undo integrity.
3. **B20** — trivial; unlocks clean profiling.
4. **B13, B14** — domain semantics.
5. **B15–B19** — data layer; bundle the migration work (B15b + B19).
6. **B21, B22** — perf; needs on-device testing.
7. **B23–B29** — hygiene sweep last (B23 touches the same lines as many earlier fixes).

B15/B19 and B21b are the only items needing a design decision first (migration strategy; reanimated camera). Everything else is mechanical.
