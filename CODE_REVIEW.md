# Code Review — Bug List & Refactor Suggestions

Date: 2026-09-15 · Scope: whole codebase (`src/`, configs, repo hygiene) · `tsc --noEmit`: clean · ESLint: 28 errors, 1 warning

Severity legend: 🔴 user-visible breakage / data risk · 🟡 wrong behavior in edge cases · 🔵 hygiene

---

## Part 1 — Bug list

Ordered so early items unblock later ones.

### Phase 0 — one decision first

- [ ] **B0. Resolve the React Compiler conflict. 🔴(process)**
  28 `react-hooks/refs` lint errors; `app.json:44` has `reactCompiler: true` while the code reads/writes refs during render (`src/app/map.tsx:788, 895–898, 997, 1355–1358, 1387, 1615–1617, 2147`). The compiler's memoization assumes exactly what this pattern violates. Pick one: (a) refactor the mutable-domain bridge to `useSyncExternalStore` + effect-synced refs (recommended — same fix as R2 below); or (b) disable the experiment and the rule with a comment. Every other gesture/state fix depends on this call.

### Phase 1 — critical bugs

- [ ] **B1. Bend-drag never commits. 🔴** `src/app/map.tsx:1443–1570` (`:1530`).
  The once-created `PanResponder` captures the *first render's* `layerView` (the pre-load empty map's) and `run`; the release handler's `edges.find` always misses and the bend is silently dropped. If it ever hit, the stale `run` would save the detached empty map over the database. Fix: read `mapRef.current`/`layerViewRef.current` and a `runRef` inside handlers, like the existing `pinchRef` pattern. Verify: long-press edge → drag → release → bend persists after app restart.

- [ ] **B2. Failed load = permanent blank screen. 🔴** `src/app/map.tsx:1128` + `:2142`; `src/data/lifeMapStore.ts:102`.
  `.catch` never calls `setMapLoaded(true)`; the unguarded `JSON.parse` makes one corrupt row the most likely trigger. Fix: catch → seed empty/demo map and set loaded (or render an error state); wrap row deserialization in try/catch with per-row skip.

- [ ] **B3. Record can become a parent. 🔴** `src/app/map.tsx:2611` → `:1959`; contradicts `src/domain/lifeMap.ts:319` ("records are leaves").
  Filter `record` out of the kind picker when `direction === "parent"`.

- [ ] **B4. Summarize creates arbitrary edges. 🔴** `src/app/map.tsx:2055–2064`.
  A star or disjoint selection (3+ boundary nodes) passes the `< 2` guard and links two random nodes. Fix: require exactly 2 boundary nodes and verify the selection forms one directed chain; add the same validation inside `LifeMap.summarize` (`src/domain/lifeMap.ts:348`).

- [ ] **B5. Dead features: inspector + note search. 🔴(feature-shaped hole)**
  `setInspectorNodeId` is only ever called with `null` → nodes can never be renamed (`src/app/map.tsx:3049–3193`, `:1683`). `enterNoteSearchMode` is never called (`:1197`) → note search is unreachable. Decide per feature: wire an entry point (inspector: "Edit" in the node sheet seeding `inspectorDraft`; note search: a button or long-press on 🔍) or delete the ~250 lines, `focusNoteNode`, and `searchNotes`.

### Phase 2 — state consistency (the undo/mode bug family)

- [ ] **B6. Undo/redo doesn't reset interaction state. 🟡** `src/app/map.tsx:937–949`.
  `closeOverlays` omits `routes`, `pickedRoutes`, `routeFromId/ToId`, `routeMode`, `summarizeMode`, `selectedEdgeIds`, `bendDrag`, `connectSourceId/TargetId`, `freeSpacePicker`, `createTarget`, `selectionLocked`. Fix: one `resetInteractionState()` called by `applySnapshot`. (Disappears entirely if R3 lands.)

- [ ] **B7. Tap timers survive mode changes and unmount. 🟡** `src/app/map.tsx:1781, 1824, 1551`.
  A pending node tap fires `onNodeSingleTap` up to 300 ms after entering route mode → info card over the route panel. Fix: cancel `nodeTapRef`/`edgeTapRef`/`canvasTapRef` in `enterRouteMode`/`enterNoteSearchMode` and in an unmount effect.

- [ ] **B8. Stale `selectionLocked` in node-tap timer. 🟡** `src/app/map.tsx:1716`.
  Reads state inside a `setTimeout` closure; the canvas path correctly uses `selectionLockedRef` (`:1557`). Use the ref in `onNodeSingleTap`.

- [ ] **B9. Stolen gestures commit. 🟡** `src/app/map.tsx:809–812`.
  `onPanResponderTerminate` → `onDragEnd` → `run()`: a system-stolen drag persists a partial position and pushes an undo entry. Add `onDragCancel` that resets `drag`/`dragArmedId` without committing.

- [ ] **B10. Child nodes overlap after a deletion. 🟡** `src/app/map.tsx:321` + `:1953`/`:1980`.
  Fan-slot index derives from the *current* edge count; after removing a child, the next add reuses its fan slot and lands exactly on a sibling. Track a monotonic per-parent child counter (needs B17's migration) or derive the slot from existing children's actual positions.

### Phase 3 — interaction & rendering correctness

- [ ] **B11. Pan/pinch can't start on a node or edge. 🟡(structural)** `src/app/map.tsx:1445`.
  Container has only `onStartShouldSetPanResponder`; node Pressables and SVG hit areas claim their touches and can't be stolen mid-gesture. Real fix: migrate to `react-native-gesture-handler` (installed but unused — R4). Interim: `onMoveShouldSetPanResponder` on the container, gated on nothing being armed.

- [ ] **B12. Arrowheads float when pinch-zoomed in. 🟡** `src/app/map.tsx:2191` vs `:1621`/`:2296`.
  Offset assumes node radius = `nodeSize/2` world units, but at ≥ 1× zoom nodes render at a fixed screen size, so their world footprint is `nodeSize / cam.scale`. Divide the offset by `cam.scale`.

- [ ] **B13. Expanding a goal→task edge pollutes the goal's status. 🟡(domain)** `src/domain/lifeMap.ts:329`, `src/domain/status.ts:51`.
  `expand` inserts a synthetic `Task` midpoint; `goalStatus` counts it as a child task, so an expand can flip a goal's derived status. Fix: mark expand-midpoints (a `synthetic` flag or distinct kind) and exclude them in `goalStatus`, or make `goalStatus` walk chains to the real leaves.

- [ ] **B14. Pinch anchor drift. 🔵** `src/app/map.tsx:1371–1377`.
  `pinchCameraZoom` computes the anchor from last render's `fitRef` while bumping `userScaleRef` synchronously. Set `fitRef.current = newCam` inside the function.

- [ ] **B15. No safe-area insets. 🟡** Styles `top: 56/108/160`, `bottom: 100`, sheet `padding: 24` (`src/app/map.tsx:3330+`).
  `react-native-safe-area-context` is installed; use `useSafeAreaInsets()` for top controls and bottom-sheet padding.

- [ ] **B16. Icon-only buttons have no accessibility labels. 🔵** `src/app/map.tsx:596, 681–691, 743, 2360–2381`.
  Add `accessibilityRole="button"` + `accessibilityLabel`.

### Phase 4 — data layer

- [ ] **B17. No schema versioning; FK pragma off. 🔴(future-proofing)** `src/data/lifeMapStore.ts:16–46`.
  Add `PRAGMA user_version` + a migration runner and `PRAGMA foreign_keys = ON` (the declared `ON DELETE CASCADE` is currently inert). Do this *before* the next schema-affecting change ships; existing installs are version 0.

- [ ] **B18. `occuredAt` typo is in the persisted blob. 🔵** `src/domain/record.ts:18`, `src/data/lifeMapStore.ts:81`, `src/domain/clipboard.ts:86`.
  Rename to `occurredAt` with a data migration reading the old key (bundle with B17).

- [ ] **B19. `getDb` caches a rejected promise forever. 🔵** `src/data/lifeMapStore.ts:50–58`.
  On open failure, reset `dbPromise` so the next `scheduleSave` retries.

- [ ] **B20. Full-rewrite save per mutation. 🔵(watch item)** `src/data/lifeMapStore.ts:276–311`.
  Correct at current scale (queue serializes, snapshot reflects latest state). Add a dev-mode size/time log so you notice when it stops being fine; no rewrite needed yet.

### Phase 5 — performance

- [ ] **B21. `[FLOW]` console.logs in render and gesture paths. 🔴(dev perf, prod noise)** `src/app/map.tsx:94, 886, 918, 931, 1629` + every handler.
  Delete or gate behind `__DEV__`. Zero-risk; do first.

- [ ] **B22. Per-frame full re-render during pan/pinch/drag. 🟡(scales badly)** `src/app/map.tsx:1512, 1584, 1500`.
  `setViewport`/`setDrag`/`setBendDrag` per move event → re-runs view-model mapping, the whole SVG edge tree, and ~400 index-keyed grid circles. Fix with reanimated shared values for the camera (R4); memoize the grid meanwhile.

- [ ] **B23. One infinite animation per in-progress segment. 🔵** `src/app/map.tsx:2226` (`MarchingPolyline`), `:409` (`PulsingRing`).
  Drive all marchers/pulsers from one shared clock value.

- [ ] **B24. `findRoutes` has no early exit; length ignores bends. 🔵** `src/domain/route.ts:47–86`.
  Stop DFS once enough candidates exist (iterative deepening or a `found.length` cap); include `bend` in segment length so ranking matches what's drawn.

### Phase 6 — repo hygiene

- [ ] **B25. Router pollution. 🟡** `.expo/types/router.d.ts` shows `/map`, `/palette`, `/theme`, `/fitZoom` are registered deep-linkable routes (the three without default exports error if navigated to).
  Move `palette.ts`, `theme.ts`, `fitZoom.ts` out of `src/app/` (e.g. `src/ui/`, `src/lib/`); make `map.tsx` a plain component imported by `index.tsx` from outside the router dir.

- [ ] **B26. Delete `example/`, fix `reset-project`, write a real README. 🔵**
  `example/` (~1,100 lines of template) is still type-checked via tsconfig's `**/*.ts`; `package.json:43` points at a nonexistent `./scripts/reset-project.js`; `README.md` is the Expo template.

- [ ] **B27. Small hygiene sweep. 🔵**
  Remove `@types/uuid` (uuid ships its own types); fix the stale `infoCard` comment referencing the deleted add button (`src/app/map.tsx:3671`); rename `src/domain/record.ts`'s `Record` class (shadows the global `Record` utility type); remove the `findDomainNode` duplication by making `LifeMap.findNode` public (`src/domain/lifeMap.ts:123`, `src/app/map.tsx:128`).

- [ ] **B28. No tests. 🟡(process)**
  The domain layer is pure and highly testable. Add jest-expo and cover: status machine transitions, `expand`/`summarize`/`removeEdge` invariants, clipboard snapshot→paste round-trip, `snapshotLifeMap`→`restoreLifeMap` round-trip, `findRoutes` on the demo-map fixture. This suite is the safety net for every fix above.

---

## Part 2 — Refactor suggestions (the "why", with references)

These are the architectural changes behind the bug fixes. Each one eliminates a *class* of bugs rather than a single instance.

### R1. Split the 2,400-line `MapScreen` god component

**What:** `src/app/map.tsx:884–3264` holds ~30 `useState` values, the gesture engine, mode routing, 6 sheets/modals, and the renderer in one function. Split in dependency order:
1. `useMapDocument()` — owns `mapRef`/`layerViewRef`/`run`/undo/save (the document store, see R2).
2. `useMapMode()` — the interaction state machine (see R3).
3. `MapCanvas` — camera + gestures (see R4), edge/node renderers.
4. Sheets (`NodeSheet`, `EdgeSheet`, `CreateForm`, `RoutePanel`…) as separate files taking explicit props.

**Why:** during the review, findings in one line range kept depending on state defined 1,500 lines away — that coupling is exactly how B1 (a closure capturing a stale `run`) went unnoticed. Small components also re-render less under React's reconciliation and are individually testable/reviewable.

**References:**
- Thinking in React (official) — https://react.dev/learn/thinking-in-react
- React docs: keeping components pure — https://react.dev/learn/keeping-components-pure

### R2. Bridge the mutable domain model to React with an external store

**What:** today the app keeps domain objects in refs, mutates them, then manually bumps a version counter (`setVersion(v => v + 1)`), with ~8 hand-rolled "mirror state into a ref during render" patterns (`latest.current = props`, `fitRef.current = cam`, …). Replace with a tiny store: the document lives outside React; the store exposes `subscribe`/`getSnapshot` (a monotonically increasing version + the snapshot); components consume it via `useSyncExternalStore`; gesture-time values sync into refs inside effects (or via `useEffectEvent` for gesture callbacks).

**Why:** reading/writing refs during render is explicitly against React's rules and incompatible with the React Compiler this project enables (`app.json:44`) — the compiler memoizes assuming render is pure, and this pattern breaks that assumption (hence the 28 `react-hooks/refs` lint errors). B1 is the same problem one level down: a once-created closure captured a stale `run`/`layerView`. With an external store, callbacks always read the *current* store, so stale-capture bugs become structurally impossible. It also keeps the codebase's genuinely good ideas (mutable domain, `run()` funnel, snapshot undo) — only the React boundary changes.

**References:**
- `useSyncExternalStore` (official, built for exactly this "external mutable store" case) — https://react.dev/reference/react/useSyncExternalStore
- `useRef` caveats: "Do not write or read `ref.current` during rendering" — https://react.dev/reference/react/useRef
- React Compiler (official docs; what it assumes about render purity) — https://react.dev/learn/react-compiler
- Kent C. Dodds: Application State Management with React — https://kentcdodds.com/blog/application-state-management-with-react

### R3. Replace scattered mode booleans with a discriminated-union state machine

**What:** replace `routeMode`, `noteSearchMode`, `connectSourceId`, `connectTargetId`, `summarizeMode`, `bendDrag`, `dragArmedId`, pickers, etc. with one union: `type Mode = {kind:"idle"} | {kind:"route",…} | {kind:"summarize",selection} | {kind:"bend",edgeId} | …`, plus a single `setMode()` that constructs the next state whole.

**Why:** today every handler re-implements the mode guard (`if (routeMode || noteSearchMode || …)`, `map.tsx:1741, 1805, 1836, 1852`) and every exit path resets a *different subset* of state (`enterRouteMode` vs `closeOverlays` vs `applySnapshot`) — which is precisely why undo leaves phantom mode state (B6), tap timers fire across mode changes (B7), and stale flags get read (B8). With the union, "reset" is `setMode({kind:"idle"})`, guards are `mode.kind === "route"`, and incomplete resets become unrepresentable at the type level. This is the "make impossible states impossible" principle.

**References:**
- Statecharts (what mode machines buy you, with UI examples) — https://statecharts.dev/
- Stately docs: state machines & statecharts (if you later want XState; the plain union needs no dependency) — https://stately.ai/docs/state-machines-and-statecharts
- TypeScript handbook: narrowing discriminated unions — https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions

### R4. Move gestures to react-native-gesture-handler and the camera to the UI thread

**What:** gestures currently use the legacy core `PanResponder`, while `react-native-gesture-handler` (RNGH) is a dependency that is **not imported anywhere**. Meanwhile reanimated — already imported — is used only for decorative dash loops, and the camera (the hot path) re-renders React on every move frame. Target: RNGH composed gestures (`Gesture.Pan`, `Gesture.Pinch`, `Gesture.Tap` with `simultaneousWith`/`requireToFail`), camera + live drag positions in reanimated shared values driving an animated `G` transform on the UI thread, and JS-thread domain commits only on gesture end.

**Why:**
- B11 (can't pan starting on a node) is a responder-negotiation limitation; RNGH's explicit gesture composition exists to solve exactly this.
- B22 (per-frame `setState` during gestures) is the classic RN jank pattern: every move frame crosses the bridge and re-renders the tree. The codebase already thinks in "commit on release" terms (`map.tsx:1572–1595`), so shared-value-at-gesture-time + commit-at-end extends its own model rather than fighting it.

**References:**
- React Native Performance overview (why per-frame JS work drops frames) — https://reactnative.dev/docs/performance
- RNGH docs (gesture composition: simultaneous/requireToFail) — https://docs.swmansion.com/react-native-gesture-handler/docs/
- Reanimated docs (shared values run on the UI thread) — https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/

### R5. Give the SQLite layer a floor: migrations, pragmas, row guards

**What:** add `PRAGMA user_version` with a versioned migration runner, `PRAGMA foreign_keys = ON`, per-row `JSON.parse` try/catch, and `getDb` retry-on-failure (B17–B19). Keep the full-rewrite save — just add a dev-mode timing log (B20).

**Why:** the schema is already persisted on user devices, so the *next* schema change without versioning strands existing installs. The declared `ON DELETE CASCADE` is currently inert because foreign keys default to off in SQLite. None of this changes the (sound) snapshot design — it's the missing floor under it.

**References:**
- SQLite `PRAGMA user_version` (official) — https://www.sqlite.org/pragma.html#pragma_user_version
- expo-sqlite docs (incl. migration helpers) — https://docs.expo.dev/versions/latest/sdk/sqlite/

### R6. Keep `src/app/` for routes only

**What:** move `palette.ts`, `theme.ts`, `fitZoom.ts` and the `MapScreen` component out of the router directory (B25); `app/` should contain only route files.

**Why:** expo-router registers every file in the app directory as a route — the generated types prove `/map`, `/palette`, `/theme`, `/fitZoom` are deep-linkable today, and the three without default exports error when navigated to. It's also what makes "app" read as "the UI layer", cleaning up the `src/app` vs `src/domain` naming.

**References:**
- expo-router introduction (file = route convention) — https://docs.expo.dev/router/introduction/

### R7. Add a domain test suite and enforce lint in CI

**What:** jest-expo + tests for the pure domain layer (B28), and a CI step running `npm run lint` and `tsc --noEmit`.

**Why:** the domain (`status` machine, `expand`/`summarize`/`removeEdge`, clipboard, snapshot round-trip, `findRoutes`) is pure and deterministic — the cheapest high-value tests in the project. A red lint baseline (28 errors) and shipped-but-unreachable features (B5) show nothing currently gates merges; this is the process fix that catches the next third of the bug list before review does.

**References:**
- Expo unit testing guide (jest-expo) — https://docs.expo.dev/develop/unit-testing/

### R8. Platform polish: safe areas and accessibility labels

**What:** `useSafeAreaInsets()` for top controls and bottom sheets (B15); `accessibilityRole`/`accessibilityLabel` on icon-only buttons (B16).

**Why:** hardcoded `top: 56` collides with notches and the home indicator on real devices; unlabeled icon buttons announce as raw glyphs ("🔍") to VoiceOver/TalkBack. Both libraries are already dependencies.

**References:**
- Expo safe-area-context docs — https://docs.expo.dev/versions/latest/sdk/safe-area-context/
- React Native accessibility docs — https://reactnative.dev/docs/accessibility

---

## Part 3 — Suggested sequencing

1. **B0** decision (R2 is the recommended answer).
2. **B21** (trivial, clears log noise) → **B1–B5** (critical).
3. **R2** store refactor (absorbs B6–B9 structurally) → **R3** mode machine.
4. **B11/B12/B14** gestures & rendering, with **R4** as the follow-up.
5. **B17–B19** data floor (**R5**) before any schema change ships.
6. **B25–B28** hygiene & tests (**R6, R7**), **B15/B16** polish (**R8**).

The refactor work is not separate from the bug list: R2/R3 are how roughly a third of the bugs get fixed permanently instead of patched locally.

## What breaks first as the map grows

1. Per-frame re-renders (B22/R4) — jank at a few hundred nodes.
2. Full-rewrite saves (B20) — write amplification on every edit.
3. `findRoutes` DFS (B24) — exponential on dense graphs.
4. `goalStatus`/`edgeStatus` chain walks — O(tree) per edge per render inside `mapDomainToViewModel`; fine now, memoizable later.
