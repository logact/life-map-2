# GAPS.md — What the app could not express

Honest record from encoding a real life (app development, gym, English;
June → September 2026) into the map via the app's own command API. That
encoding shipped as the first-launch seed until the tutorial map replaced it
on 2026-09-18 (see `src/domain/seedDoc.ts`); the gaps below remain open.
Each entry: what the real roadmap needed, what the model offers, and the
workaround used — if any.

## 1. Recurring habits have no home — fixed

Fixed 2026-09-22: tasks can repeat. The task card's Repeat row opens the
rule editor (`src/map/overlays/recurSheet.tsx`): every N days, every N
weeks on picked weekdays, or every N months, from a Starts day
(`RecurRule` in `src/domain/doc.ts`, derivations in
`src/domain/recur.ts`). A repeating task never finishes — **Log done**
appends to its occurrence `log` (backdatable like every other stamp),
**Undo last log** removes one. The card shows the due state (Due today /
Overdue since … / Next … / Done today ✓) plus a running "N logged ·
streak K" line, and the pin carries a ↻ badge that turns full ink when
due. Attention semantics: due/overdue habits read as todo (their road
asks with them), a current habit reads as done, and goal rollups skip
habits entirely so an ongoing practice never blocks its goal. Occurrences
live in the compact log — no record dots, so the map stays clean at habit
scale (the missing series _view_ is #8). The goal's `targetDate` also
became first-class: settable in the create form, with a live countdown on
the card ("Sep 30 · in 8 days").

- **Verify:** make a task repeat Every day, Log done → Done today ✓ with
  streak 1; relaunch tomorrow → Due today, badge inked; Undo last log
  removes the entry; create a goal with a target date → the card counts
  down to it. Each edit undoes in one step.

## 2. No metrics or numeric progress

"Squat 100 kg (currently 90×5)", "1,500 words in Anki" — targets and current
values are numbers, but the model has no metric fields. A goal has a
`targetDate` but no target _value_; progress toward 100 kg is invisible.

**Workaround:** numbers live in titles, notes, and record text.

## 3. Backdating is impossible in-app — fixed

Fixed 2026-09-22: dates are user-settable everywhere a timestamp is
stamped. The create form's record mode has an "Occurred" date row (a small
in-sheet calendar, `src/map/overlays/datePicker.tsx`); the node info
card's date lines (Occurred / Started / Done / Target) are tappable and
rewrite the stamp through the new `setNodeTimes` command; the note
editor's date row sets the note's `createdAt`. Commands also accept the
time explicitly: `addFreeNode` / `addChildNode` / `addParentNode`
(`occurredAt`), `transitionNodeStatus` / `addNote` / `updateNote` (`at` /
`createdAt`). Notes are kept newest-first by date, so a backdated note
slots under newer ones. The status machine still owns WHICH fields exist —
`setNodeTimes` rewrites `startedAt`/`completedAt` only where set (start/
complete first, then move the date), while `occurredAt` and the goal's
`targetDate` (also newly settable/clearable in-app) are always writable.

- **Verify:** log a record, tap its "Occurred" line, pick last week → the
  card shows that date; Start → tap "Started" → backdate; add a note,
  change its date in the editor → it sorts below newer notes. All edits
  undo in one step each.

## 5. Tasks have no description field

Goals have `description`, records have `note`; tasks have only a title. "Fix
bugs from BUGS.md" can't say which bugs without abusing the title.

**Workaround:** task detail goes into notes (e.g. squat form cues), which
are hidden one tap deeper.

## 8. Series are flattened

Four months of weekly gym sessions and journal entries would be ~50+
records; only a representative few are seeded, or the map drowns in dots.
There is no way to see a series as a series (no grouping, no timeline view).

**Partially eased 2026-09-23:** the calendar page (SPEC §4) shows a series
day by day — a habit's logs, misses and upcoming schedule alongside records
and stamps on one month grid. A dedicated per-series timeline (one habit's
history as its own view) is still open.

## 9. No attachments

PR photos, the finished book cover, a screenshot of the first render — none
can be attached. Records are text only.

---

_Filed alongside the original seed on 2026-09-18 — the day the tutorial map
replaced it. Items 1–3 felt like the real product gaps for daily-use
tracking; 1 and 3 are now fixed, leaving 2 (metrics) as the open one.
4–9 are acceptable constraints of a map metaphor._
