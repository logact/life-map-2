import { create } from "zustand";

import { addFocusSegment } from "@/domain/commands";
import { Id } from "@/domain/doc";
import { getMeta, setMeta } from "@/data/mapDb";
import { childPosition } from "@/map/utils";
import { useDocStore } from "./docStore";

// ---------- the focus session store ----------
// "I am working on this task right now." The session lives OUTSIDE the
// document (it is not map content): the active segment is persisted to the
// meta key-value store on every change, so killing the app mid-session
// resumes the timer on relaunch. Only an ENDED segment touches the doc —
// it writes one record under the focused task via addFocusSegment, one
// undoable command like any other edit.
//
// Manual stop only: a segment ends when the user presses Stop, or switches
// tasks (which ends the current segment and starts a new one). The session
// clock (sessionStartedAt) keeps running across switches; the session as a
// whole ends only at Stop.

const META_KEY = "focus_session";

export interface FocusSession {
  // segments always attach to a task; a goal-focused session keeps the
  // goal as context (the focus screen picked one of its tasks)
  taskId: Id;
  goalId: Id | null;
  // the current segment's start; resets on every task switch
  segmentStartedAt: number;
  // the whole session's start; survives switches, ends at Stop
  sessionStartedAt: number;
  // pomodoro target in minutes (15/25/45/60); null = free-running
  // stopwatch. Reaching the target is a visual cue only — no auto-stop
  targetMin: number | null;
}

interface FocusStore {
  session: FocusSession | null;
  // false until the persisted session (or its absence) has been read
  loaded: boolean;
  load: () => Promise<void>;
  start: (taskId: Id, goalId?: Id | null) => void;
  switchTask: (taskId: Id) => void;
  setTargetMin: (targetMin: number | null) => void;
  stop: () => void;
}

function persist(session: FocusSession | null) {
  setMeta(META_KEY, session ? JSON.stringify(session) : "").catch((err) =>
    console.warn("[focusStore] session save failed", err),
  );
}

function parseSession(raw: string | null): FocusSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (
      typeof v.taskId === "string" &&
      typeof v.segmentStartedAt === "number" &&
      typeof v.sessionStartedAt === "number"
    ) {
      return {
        taskId: v.taskId,
        goalId: typeof v.goalId === "string" ? v.goalId : null,
        segmentStartedAt: v.segmentStartedAt,
        sessionStartedAt: v.sessionStartedAt,
        targetMin: typeof v.targetMin === "number" ? v.targetMin : null,
      };
    }
  } catch (err) {
    console.warn("[focusStore] ignoring corrupt persisted session", err);
  }
  return null;
}

// close out the current segment: one focus record under its task. A task
// deleted mid-session simply drops the segment — the undo history is the
// user's safety net, not a half-written record under a ghost node
function endSegment(session: FocusSession, endedAt: number) {
  if (endedAt <= session.segmentStartedAt) return; // a zero-length segment leaves no record
  const store = useDocStore.getState();
  const task = store.doc.nodes[session.taskId];
  if (!task) return;
  const outDegree = Object.values(store.doc.edges).filter((e) => e.fromId === task.id).length;
  const seg = addFocusSegment(
    task.id,
    session.segmentStartedAt,
    endedAt,
    childPosition(task, outDegree, "successor"),
  );
  store.run(seg.recipe);
}

export const useFocusStore = create<FocusStore>((set, get) => {
  // load resolves once per session; concurrent callers ride the same
  // promise (same pattern as the doc store)
  let loadPromise: Promise<void> | null = null;
  return {
    session: null,
    loaded: false,

    load() {
      if (!loadPromise) {
        loadPromise = (async () => {
          let session: FocusSession | null = null;
          try {
            session = parseSession(await getMeta(META_KEY));
          } catch (err) {
            console.warn("[focusStore] session load failed", err);
          }
          if (session) {
            // the task may be gone (deleted before the crash); validating
            // needs the doc, which the map screen loads — wait for it
            if (!useDocStore.getState().loaded) {
              await new Promise<void>((resolve) => {
                const unsub = useDocStore.subscribe((s) => {
                  if (s.loaded) {
                    unsub();
                    resolve();
                  }
                });
              });
            }
            if (useDocStore.getState().doc.nodes[session.taskId]) {
              set({ session, loaded: true });
              return;
            }
            persist(null); // stale session: the task is gone
          }
          set({ session: null, loaded: true });
        })();
      }
      return loadPromise;
    },

    start(taskId, goalId = null) {
      // starting on the already-focused task is a no-op; on another task it
      // is a switch (the current segment closes first)
      const cur = get().session;
      if (cur) {
        if (cur.taskId !== taskId) get().switchTask(taskId);
        return;
      }
      const now = Date.now();
      const session: FocusSession = {
        taskId,
        goalId,
        segmentStartedAt: now,
        sessionStartedAt: now,
        targetMin: null,
      };
      set({ session });
      persist(session);
    },

    switchTask(taskId) {
      const cur = get().session;
      if (!cur || cur.taskId === taskId) return;
      endSegment(cur, Date.now());
      const session: FocusSession = { ...cur, taskId, segmentStartedAt: Date.now() };
      set({ session });
      persist(session);
    },

    setTargetMin(targetMin) {
      const cur = get().session;
      if (!cur) return;
      const session: FocusSession = { ...cur, targetMin };
      set({ session });
      persist(session);
    },

    stop() {
      const cur = get().session;
      if (!cur) return;
      endSegment(cur, Date.now());
      set({ session: null });
      persist(null);
    },
  };
});
