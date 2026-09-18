# GAPS.md — What the app could not express

Honest record from encoding a real life (app development, gym, English;
June → September 2026) into the map via the app's own command API. That
encoding shipped as the first-launch seed until the tutorial map replaced it
on 2026-09-18 (see `src/domain/seedDoc.ts`); the gaps below remain open.
Each entry: what the real roadmap needed, what the model offers, and the
workaround used — if any.

## 1. Recurring habits have no home

"Gym 3x/week", "Anki: 20 new words/week", "Weekly journal" are *ongoing* —
they are never done, yet they aren't a single task either. The model has no
recurrence, no schedule, no streaks.

**Workaround:** one standing task, permanently `in-progress`, with records
attached per session. The title carries the frequency as text.

## 2. No metrics or numeric progress

"Squat 100 kg (currently 90×5)", "1,500 words in Anki" — targets and current
values are numbers, but the model has no metric fields. A goal has a
`targetDate` but no target *value*; progress toward 100 kg is invisible.

**Workaround:** numbers live in titles, notes, and record text.

## 3. Backdating is impossible in-app

Every command stamps `Date.now()`. A user who logs yesterday's workout
records it as today; a map with real history (like that seed) cannot be
produced through the UI at all — the seed patched `startedAt` /
`completedAt` / `occurredAt` / note times in a raw recipe after building.

**Consequence:** that map was not reproducible by in-app use alone, and any
late logging by hand will silently carry the wrong date.

## 4. Edges carry no meaning

A road can show *that* two nodes connect, never *why*. Edges have no title,
no notes, no description — so if a real relation ever appears (say, the app
becomes how gym weeks get scheduled), the reason for the road would live
only outside the app.

**Workaround:** none. The earlier draft of the seed shipped two cross-area
roads on invented justifications; they were removed, because unjustified
edges read as noise — but the underlying gap (no way to annotate a road)
remains.

## 5. Tasks have no description field

Goals have `description`, records have `note`; tasks have only a title. "Fix
bugs from BUGS.md" can't say which bugs without abusing the title.

**Workaround:** task detail goes into notes (e.g. squat form cues), which
are hidden one tap deeper.

## 6. No time-span nodes

"Weeks 1–6" and "Weeks 7–12" are *spans*, not points. The model's expand
midpoint is a point on the road, so a span can only be faked by putting the
date range in a node's title.

**Workaround:** phase midpoints named with their date ranges.

## 7. Goal rollup ignores incoming roads

`goalStatus` only rolls up *outgoing* child tasks. With the roadmap
topology — every area a chain INTO its main goal — a goal has no outgoing
tasks at all, so it derives **todo** even when the road into it is nearly
done. Progress *toward* a goal never reaches the goal node.

**Workaround:** read the road, not the goal glyph — each segment shows the
status of the step it leads to, and the goal is marked done manually when
reached.

## 8. Series are flattened

Four months of weekly gym sessions and journal entries would be ~50+
records; only a representative few are seeded, or the map drowns in dots.
There is no way to see a series as a series (no grouping, no timeline view).

## 9. No attachments

PR photos, the finished book cover, a screenshot of the first render — none
can be attached. Records are text only.

---

*Filed alongside the original seed on 2026-09-18 — the day the tutorial map
replaced it. Items 1–3 feel like the real product gaps for daily-use
tracking; 4–9 are acceptable constraints of a map metaphor.*
