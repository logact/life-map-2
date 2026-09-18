# Life Plan — Autumn 2026

*Written 2026-09-18. This document is the narrative version of the plan; the
Life Map app holds the same plan as a living map (`src/domain/seedDoc.ts`).
Three areas, all started around mid-year. Each area is written as a chain of
steps: do X to achieve sub-goal Y, then the next step, until the final goal.*

---

## 1. Life Map App

**Final goal:** Life Map 2 is my daily-driver planner — on my phone,
holding my real life, pleasant enough that I open it every day. No store
release, no users: a tool I trust because I built it.

**Why:** I think in maps, not lists. If the tool exists I will use it, and
then my plans stop living in my head.

**The steps:**

1. **Build the core canvas & gestures** — pan, pinch, drag; nodes and roads
   on an infinite map — to achieve *a map that works at all*.
   ✓ Done Jul 12.
2. **Then add persistence, undo, and layers** — SQLite storage, undo/redo,
   expand/collapse of roads — to achieve *a map that survives restarts and
   forgives mistakes*. ✓ Done Aug 28.
3. **Then polish: routes, notes, search** — the features that make it a
   daily tool instead of a demo — to achieve *an app worth opening every
   morning*. ◐ In progress since Sep 5.
4. **Then clear the trust blockers** — fix the remaining bugs from BUGS.md
   (started Sep 10), seed my real life data (started Sep 17), app icon &
   splash, backup/export so the map is never hostage to one phone — to
   achieve *a build I can trust with my real life*.
5. **Until:** the **daily build on my phone** — target **Oct 15, 2026**.

*Chain: working map → safe map → daily-worthy map → trustworthy map → daily
driver.*

**Milestones logged:** first render on canvas (Jun 14) · first run on my
phone via Expo Go (Jun 28) · undo/redo saved me from a mis-drag (Aug 22).

---

## 2. Get Stronger

**Final goal:** strength training is a fixed part of my week — gym 3×/week,
every week — with the big lifts at **squat 100 kg, bench 70 kg, deadlift
120 kg**.

**Why:** everything else in this plan runs on energy and sleep.

**The steps:**

1. **Gear up and learn the form** — shoes, technique, no excuses — to
   achieve *a safe start*. ✓ Done Jun 20.
2. **Then finish the 12-week beginner program** (Jun 22 → Sep 13) —
   weeks 1–6 to adapt, weeks 7–12 to load — to achieve *a base of strength
   and the habit of showing up*. ✓ Done — twelve weeks straight.
3. **Then push the squat to 100 kg** (currently 90×5; form: brace, knees
   out, hips back) — squat first, it drives everything — to achieve *the
   first lift target*. ◐ In progress since Sep 14.
4. **Then the bench to 70 kg** (currently 60×8) — to achieve *the second
   lift target*. ◐ In progress, lower priority.
5. **Then the deadlift to 120 kg** (currently 105×3) — deliberately not
   started; one push at a time — to achieve *the third lift target*. ○ Todo.
6. **Until:** all three targets met — *strong, and still training*.

Alongside the whole road, not as a gate on it: **gym 3×/week**, a standing
habit that never completes — each session is logged as a record.

*Chain: gear up → the program → squat → bench → deadlift → strong for good.*

**Honest log:** squat 90×5 PR (Sep 8) · bench 60×8 (Sep 11) · deadlift
105×3 (Sep 15) · skipped a week in mid-August for a work crunch — back on
it the week after. Lifting shoes (Jul 20): trivial purchase, last excuse
gone.

---

## 3. English

**Final goal:** general, usable English — vocabulary growing, listening
effortless, speaking no longer frightening. No exam; compounding daily
contact is the strategy.

**Why:** everything I read for the app — and most of what I want to read at
all — is in English. Listening has improved a lot since June; speaking is
the weakest link, so the chain ends there.

**The steps:**

1. **Start the daily-contact habits** — Anki: 20 new words/week and a
   weekly journal in English (both since Jun 21) — to achieve *a vocabulary
   base and the feeling of producing English weekly*. ◐ Running. First
   journal entry logged Jun 21; 1,500 words in Anki by Aug 2.
2. **Then add listening without subtitles** — YouTube daily (since Jul 6) —
   to achieve *effortless listening*. ◐ Running. Milestone: followed a whole
   podcast episode (Aug 25).
3. **Then read a full book in English** — *Atomic Habits*, Jun 25 → Aug 30 —
   to achieve *proof I can sustain long-form reading*. ✓ Done — two months,
   worth it.
4. **Then find a language partner** — the only todo in this area, and the
   scariest — to achieve *real speaking practice*. ○ Todo.
5. **Until:** speaking joins listening as something I don't think about —
   *general fluency, no certificate needed*.

*Chain: words & journal → listening → a whole book → a speaking partner →
fluency.*

---

## How the three relate

They don't — structurally. These are three parallel areas of one life, and
the map keeps them as separate islands, next to the floating **Ideas** node
(a parking lot for thoughts that haven't earned a place yet). The only
thing connecting the areas is this map itself: one place that holds all
three plans. A road between goals is earned by a real dependency — if the
app ever becomes how I schedule my gym weeks, that earns a road then, not
before.

## How I monitor

Records are the evidence: every workout, every finished book, every app
milestone is a dated dot on the map. A weekly review — Sunday evening, ten
minutes — walks the three chains: any habit with no new record this week
needs attention; any step stuck in-progress too long gets re-scoped or
honestly reopened to todo. Gaps between this plan and what the app can
express (recurrence, metrics, edge meanings) are written down in `GAPS.md`.
