# Feature Specification: Node Notes

**Feature Branch**: `001-node-notes`  
**Created**: 2026-09-11  
**Status**: Draft  
**Input**: User description: "For all nodes, the user can create a note for it. The user can also query the note."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach a note to any node (Priority: P1)

While browsing the life map, the user wants to capture a thought, reminder, or context on any node — a goal, a task, or a record. The user selects the node, writes free-text note content, and saves it. The note stays attached to that node and is visible whenever the node is inspected later.

**Why this priority**: This is the core value of the feature — without note creation there is nothing to query. It turns every node from a bare title into a place for personal context.

**Independent Test**: Open any node of each kind (goal, task, record), add a note, reopen the node, and confirm the note text is shown.

**Acceptance Scenarios**:

1. **Given** a goal node with no note, **When** the user adds the note "Call coach before Friday" and saves, **Then** the note is stored on that node and shown when the node is viewed again.
2. **Given** any node on the map (goal, task, or record, at any layer), **When** the user opens its details, **Then** an option to add a note is available.
3. **Given** the note entry field contains only whitespace or is empty, **When** the user attempts to save, **Then** no note is created and the user is prompted to enter text.
4. **Given** a node that already has notes, **When** the user saves a new note, **Then** the new note is added to the node's note list with its own timestamp, and the existing notes are kept unchanged.
5. **Given** a node with several notes, **When** the user views the node, **Then** the notes are listed newest first, each showing its creation date.

---

### User Story 2 - Query notes across the map (Priority: P1)

The user wants to find notes without remembering which node they belong to. The user enters a keyword and sees all matching notes, each identified by its owning node, and can jump from a result to the node on the map.

**Why this priority**: Querying is the second half of the user's request and the reason notes stay useful as the map grows — it is co-equal in priority with creation.

**Independent Test**: Create notes on several nodes with distinct keywords, search for one keyword, and confirm only the matching notes appear and each result links to its node.

**Acceptance Scenarios**:

1. **Given** notes exist on multiple nodes, **When** the user searches for a keyword contained in two of them, **Then** both notes are listed, each showing its owning node's title.
2. **Given** a search keyword with mixed letter casing, **When** the user searches, **Then** matching is case-insensitive.
3. **Given** a keyword that matches no note, **When** the user searches, **Then** a clear "no results" state is shown.
4. **Given** a list of search results, **When** the user selects one, **Then** the map focuses the owning node so the user can see it in context.
5. **Given** a note attached to a node in a deeper (currently hidden) layer, **When** the user searches for its text, **Then** the note still appears in the results.

---

### User Story 3 - Edit or remove a note (Priority: P3)

After a note exists, the user may want to correct a typo, update outdated content, or remove a note that is no longer relevant.

**Why this priority**: Notes remain useful without editing, but basic maintenance prevents stale or wrong content from accumulating. It depends on User Story 1.

**Independent Test**: Add a note, edit its text and confirm the change is shown, then delete it and confirm it no longer appears on the node or in search results.

**Acceptance Scenarios**:

1. **Given** a node with an existing note, **When** the user edits the text and saves, **Then** the updated text replaces the old content everywhere it is shown.
2. **Given** a node with an existing note, **When** the user deletes the note, **Then** the note no longer appears on the node or in any query result.

---

### Edge Cases

- When a node is removed from the map, its notes are removed with it (covered by the existing node-removal confirmation).
- Very long, multi-line notes must be supported for writing and viewing without truncation in the node's detail view; search results may show an excerpt.
- Notes on nodes in collapsed/hidden layers are still included in query results (see US2 scenario 5).
- Searching with an empty or whitespace-only keyword shows no results (or all notes) rather than failing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to create a free-text note attached to any node, regardless of node kind (goal, task, or record) or layer depth.
- **FR-002**: The system MUST store each note's text and its creation timestamp, associated with exactly one owning node.
- **FR-003**: Users MUST be able to view a node's note(s) when inspecting that node.
- **FR-004**: The system MUST reject saving a note whose text is empty or whitespace-only.
- **FR-005**: Users MUST be able to search across all notes on the map by a text keyword, with case-insensitive matching.
- **FR-006**: Query results MUST show the matching note content (or an excerpt) and identify the owning node by title.
- **FR-007**: Selecting a query result MUST navigate the user to the owning node on the map.
- **FR-008**: Users MUST be able to edit the text of an existing note and delete a note.
- **FR-009**: When a node is deleted, its notes MUST be deleted with it.
- **FR-010**: Notes MUST persist for the lifetime of the map data they belong to (i.e., notes are included wherever node data is saved and loaded).

### Key Entities

- **Note**: A piece of free-text user content attached to one node. Attributes: text content, creation timestamp, last-modified timestamp, owning node.
- **Node**: An existing map element of kind goal, task, or record; the owner of zero or more notes, listed newest first.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can attach a note to any node in no more than 3 interactions from the map view (select node → add note → save).
- **SC-002**: 95% of note searches return results in under 1 second on a map of 500 nodes with 1,000 notes.
- **SC-003**: 100% of notes created on nodes of any kind are retrievable both from the node's detail view and from keyword search.
- **SC-004**: Users can locate a specific note by keyword and reach its owning node in under 30 seconds without prior knowledge of where the node sits on the map.

## Assumptions

- The app is single-user; no sharing, permissions, or collaboration concerns apply to notes.
- Notes are plain text only; rich formatting, attachments, and images are out of scope.
- Query means keyword search over note text; advanced filters (by node kind, date range) are out of scope for this feature.
- Notes are a new capability uniform across all node kinds; the existing free-text field on record nodes remains as-is and is not migrated.
- Note persistence follows the map's overall save/load mechanism: notes are stored as part of the node data so they are covered automatically when map persistence is implemented.
