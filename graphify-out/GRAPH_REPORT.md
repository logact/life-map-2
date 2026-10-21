# Graph Report - .  (2026-10-17)

## Corpus Check
- 112 files · ~129,201 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 548 nodes · 1569 edges · 45 communities (17 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Calendar Focus Tracking
- Map Canvas Interaction
- Domain Queries Visibility
- Document Commands Editing
- Scheduling Recurrence Forms
- Settings Cloud Sync
- Expo App Configuration
- Runtime Dependencies
- SQLite Document Persistence
- Product Goals and Gaps
- Package Metadata
- Development Dependencies
- NPM Scripts
- TypeScript Configuration
- UI Theme System
- ESLint Configuration
- Code Review Quality
- UI Theme Prototypes
- iOS Release Workflow
- Expo Symbol Asset
- Grid Background Asset
- Android Icon Background
- Android Icon Foreground
- Android Monochrome Icon
- Expo Badge Black
- Expo Badge White
- Expo Logo Asset
- Expo Favicon Asset
- Expo App Icon
- Blue Glow Asset
- React Logo 2x
- React Logo 3x
- React Logo Asset
- Expo Splash Icon
- Explore Icon 2x
- Explore Icon 3x
- Explore Tab Icon
- Home Icon 2x
- Home Icon 3x
- Home Tab Icon
- Expo Tutorial Screenshot
- iCloud Setup Guide
- Expo Starter README

## God Nodes (most connected - your core abstractions)
1. `MapScreen()` - 36 edges
2. `LifeMapDoc` - 32 edges
3. `Id` - 24 edges
4. `NodeInfoCard()` - 22 edges
5. `fmtDate()` - 22 edges
6. `NodeData` - 20 edges
7. `emptyDoc()` - 19 edges
8. `addFreeNode()` - 18 edges
9. `addChildNode()` - 18 edges
10. `Recipe` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Mutation Interaction Model` --references--> `Life Map 2 Product and Technical Specification`  [EXTRACTED]
  DESIGN_MUTATIONS.md → SPEC.md
- `persist()` --calls--> `setMeta()`  [EXTRACTED]
  src/state/focusStore.ts → src/data/mapDb.ts
- `docWith()` --calls--> `emptyDoc()`  [EXTRACTED]
  src/domain/__tests__/calendar.test.ts → src/domain/doc.ts
- `habitItems()` --indirect_call--> `dayStart()`  [INFERRED]
  src/domain/calendar.ts → src/domain/recur.ts
- `DocIndexes` --references--> `Id`  [EXTRACTED]
  src/domain/indexes.ts → src/domain/doc.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Goal Planning and Behavior Review Loop** — spec_goal_task_record_model, life_plan_progressive_goal_chains, life_plan_records_are_evidence, life_plan_weekly_review [INFERRED 0.85]

## Communities (45 total, 28 thin omitted)

### Community 0 - "Calendar Focus Tracking"
Cohesion: 0.06
Nodes (53): CalendarScreen(), cs, DOW, freeSpot(), KIND_CHIPS, LEGEND, MONTHS, STATE_CHIPS (+45 more)

### Community 1 - "Map Canvas Interaction"
Cohesion: 0.06
Nodes (48): ClipboardNodeData, removeNote(), NodeKind, Status, BottomPanel(), MenuCard(), MenuEntry, MenuItem (+40 more)

### Community 2 - "Domain Queries Visibility"
Cohesion: 0.08
Nodes (50): buildPayload(), captureEdge(), captureKindData(), captureNode(), ClipboardEdgeData, ClipboardPayload, newCapture(), snapshotEdge() (+42 more)

### Community 3 - "Document Commands Editing"
Cohesion: 0.10
Nodes (55): MapScreen(), sampleDoc(), addChildNode(), addFocusSegment(), addFreeNode(), addNote(), addParentNode(), addTag() (+47 more)

### Community 4 - "Scheduling Recurrence Forms"
Cohesion: 0.10
Nodes (48): cs, pinnedDay(), pinnedLabel(), ScheduleSheet(), setNodeDetail(), setNodeTimes(), StatusAction, isGoal() (+40 more)

### Community 5 - "Settings Cloud Sync"
Cohesion: 0.13
Nodes (36): cs, SettingsScreen(), CloudModule, diagnoseSync(), docScope(), errorCode(), errorDetail(), flushCloudPush() (+28 more)

### Community 6 - "Expo App Configuration"
Cohesion: 0.06
Nodes (32): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, predictiveBackGestureEnabled, projectId, reactCompiler (+24 more)

### Community 7 - "Runtime Dependencies"
Cohesion: 0.06
Nodes (31): dependencies, expo, expo-constants, expo-device, expo-font, expo-glass-effect, expo-image, expo-linking (+23 more)

### Community 8 - "SQLite Document Persistence"
Cohesion: 0.13
Nodes (20): DayOrderRow, docToRows(), EdgeRow, flushPendingSave(), getDb(), loadDoc(), migrate(), MIGRATIONS (+12 more)

### Community 9 - "Product Goals and Gaps"
Cohesion: 0.13
Nodes (16): Mutation Interaction Model, Object Local Progressive Actions, Missing Record Attachments, What the App Could Not Express, Missing Numeric Metrics and Progress, Missing Dedicated Series Timeline, Missing Task Descriptions, Life Plan Autumn 2026 (+8 more)

### Community 10 - "Package Metadata"
Cohesion: 0.25
Nodes (7): jest, preset, transformIgnorePatterns, main, name, private, version

### Community 11 - "Development Dependencies"
Cohesion: 0.25
Nodes (8): devDependencies, eslint, eslint-config-expo, jest, jest-expo, @types/jest, @types/react, typescript

### Community 12 - "NPM Scripts"
Cohesion: 0.25
Nodes (8): scripts, android, ios, lint, reset-project, start, test, web

### Community 13 - "TypeScript Configuration"
Cohesion: 0.25
Nodes (7): compilerOptions, paths, strict, extends, include, @/*, @/assets/*

### Community 14 - "UI Theme System"
Cohesion: 0.48
Nodes (4): cartographer, themes, ShadowPreset, Theme

## Knowledge Gaps
- **170 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+165 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LifeMapDoc` connect `Settings Cloud Sync` to `Calendar Focus Tracking`, `Domain Queries Visibility`, `Document Commands Editing`, `Scheduling Recurrence Forms`, `SQLite Document Persistence`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `Id` connect `Calendar Focus Tracking` to `Domain Queries Visibility`, `Document Commands Editing`, `Scheduling Recurrence Forms`, `Settings Cloud Sync`, `SQLite Document Persistence`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `NodeData` connect `Domain Queries Visibility` to `Calendar Focus Tracking`, `Map Canvas Interaction`, `Document Commands Editing`, `Scheduling Recurrence Forms`, `SQLite Document Persistence`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _178 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Calendar Focus Tracking` be split into smaller, more focused modules?**
  _Cohesion score 0.060362173038229376 - nodes in this community are weakly interconnected._
- **Should `Map Canvas Interaction` be split into smaller, more focused modules?**
  _Cohesion score 0.06436487638533675 - nodes in this community are weakly interconnected._
- **Should `Domain Queries Visibility` be split into smaller, more focused modules?**
  _Cohesion score 0.07832167832167833 - nodes in this community are weakly interconnected._