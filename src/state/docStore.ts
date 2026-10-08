import { applyPatches, enablePatches, Patch, produceWithPatches } from "immer";
import { create } from "zustand";

import { Recipe } from "@/domain/commands";
import { buildSeedDoc } from "@/domain/seedDoc";
import { emptyDoc, Id, LifeMapDoc } from "@/domain/doc";
import { getMeta, loadDoc, scheduleSave, setMeta } from "@/data/mapDb";
import {
  isSyncAvailable,
  loadSyncEnabled,
  localSavedAt,
  markAdoptedRemote,
  readRemoteEnvelope,
  scheduleCloudPush,
  syncNow as cloudSyncNow,
} from "@/data/cloudSync";
import { decideSync, SyncDecision } from "@/data/syncPolicy";

// records that the real-life seed has been applied: installs that predate
// the seed (they hold the old demo map) get it once, on their first launch
// after the seed shipped, and never again — later edits are the user's own
const SEED_APPLIED_KEY = "seed_applied";

enablePatches();

// ---------- the document store ----------
// The LifeMap document lives OUTSIDE React in this store. Components
// subscribe via useDocStore(selector); gesture handlers and timers read
// useDocStore.getState() so no closure can ever capture a stale document.
// Every edit goes through run(recipe): Immer produces the next immutable
// doc plus patches; the inverse patches are the undo history.

const HISTORY_LIMIT = 100;

interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
}

export interface DocStore {
  doc: LifeMapDoc;
  // false until the persisted map (or the seeded initial map) is in place,
  // so gestures never mutate a map that is about to be replaced
  loaded: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // cross-screen handoff: another page (the calendar) asks the map to focus
  // a node; the map consumes and clears it. Transient — never persisted
  pendingNodeFocusId: Id | null;
  requestNodeFocus: (id: Id) => void;
  clearNodeFocus: () => void;
  run: (recipe: Recipe) => void;
  undo: () => void;
  redo: () => void;
  load: (screen: { width: number; height: number }) => Promise<void>;
  // the menu's "Sync now": one immediate iCloud round — pulls and adopts a
  // newer remote snapshot, otherwise uploads local
  syncNow: () => Promise<void>;
}

export function createDocStore() {
  // the stacks are large and never rendered, so they live outside reactive
  // state; only their emptiness is observable (canUndo/canRedo)
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];

  return create<DocStore>((set, get) => {
    // load resolves once per session: every screen calls it on mount, so
    // concurrent callers (a cold start deep-linked past the map) ride the
    // same promise, and a later remount never reloads over in-memory edits
    let loadPromise: Promise<void> | null = null;
    return {
    doc: emptyDoc(),
    loaded: false,
    canUndo: false,
    canRedo: false,
    pendingNodeFocusId: null,
    requestNodeFocus(id) {
      set({ pendingNodeFocusId: id });
    },
    clearNodeFocus() {
      set({ pendingNodeFocusId: null });
    },

    run(recipe) {
      // invariant violations throw out of the recipe: nothing applies
      const [next, patches, inverse] = produceWithPatches(get().doc, recipe);
      if (patches.length === 0) return; // a no-op edit creates no history
      undoStack.push({ patches, inverse });
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      redoStack.length = 0;
      set({ doc: next, canUndo: true, canRedo: false });
      scheduleSave(next);
      scheduleCloudPush(next);
    },

    undo() {
      const entry = undoStack.pop();
      if (!entry) return;
      // LIFO discipline: the current doc is exactly the doc these inverse
      // patches were made from
      const next = applyPatches(get().doc, entry.inverse);
      redoStack.push(entry);
      set({ doc: next, canUndo: undoStack.length > 0, canRedo: true });
      scheduleSave(next);
      scheduleCloudPush(next);
    },

    redo() {
      const entry = redoStack.pop();
      if (!entry) return;
      const next = applyPatches(get().doc, entry.patches);
      undoStack.push(entry);
      set({ doc: next, canUndo: true, canRedo: redoStack.length > 0 });
      scheduleSave(next);
      scheduleCloudPush(next);
    },

    load(screen) {
      // load NEVER leaves the app on a blank screen: any failure (corrupt
      // rows, open failure, first launch) resolves to a valid seeded document
      if (!loadPromise) {
        loadPromise = (async () => {
          // iCloud first: a newer remote snapshot replaces whatever is local
          // (fresh install on a second device, a wiped phone). Sync failures
          // are swallowed inside cloudSync and must not affect loading.
          let cloud: SyncDecision = "none";
          try {
            if ((await loadSyncEnabled()) && (await isSyncAvailable())) {
              const remote = await readRemoteEnvelope();
              const decision = decideSync(await localSavedAt(), remote);
              if (decision === "pull" && remote) {
                set({ doc: remote.doc, loaded: true });
                scheduleSave(remote.doc);
                await markAdoptedRemote(remote.savedAt);
                // the remote doc wins: never (re)seed over it
                setMeta(SEED_APPLIED_KEY, "1").catch((err) =>
                  console.warn("[docStore] seed flag save failed", err),
                );
                return;
              }
              cloud = decision; // "push": upload local once it is established
            }
          } catch (err) {
            console.warn("[docStore] cloud check failed, loading local", err);
          }
          try {
            const [doc, seedApplied] = await Promise.all([loadDoc(), getMeta(SEED_APPLIED_KEY)]);
            if (doc && seedApplied !== null) {
              set({ doc, loaded: true });
              if (cloud === "push") scheduleCloudPush(doc);
              return;
            }
            console.log(
              doc
                ? "[docStore] replacing the pre-seed map with the initial seed (once)"
                : "[docStore] empty database, seeding the initial map",
            );
          } catch (err) {
            console.warn("[docStore] load failed, seeding initial map", err);
          }
          const doc = buildSeedDoc(screen.width / 2, screen.height / 3);
          set({ doc, loaded: true });
          scheduleSave(doc);
          if (cloud === "push") scheduleCloudPush(doc);
          setMeta(SEED_APPLIED_KEY, "1").catch((err) =>
            console.warn("[docStore] seed flag save failed", err),
          );
        })();
      }
      return loadPromise;
    },

    async syncNow() {
      const remote = await cloudSyncNow(get().doc);
      if (!remote) return;
      // adopting the remote replaces the document wholesale, so the undo
      // history (patches against the old doc) is no longer valid
      undoStack.length = 0;
      redoStack.length = 0;
      set({ doc: remote.doc, canUndo: false, canRedo: false });
      scheduleSave(remote.doc);
      await markAdoptedRemote(remote.savedAt);
    },
  };
  });
}

export const useDocStore = createDocStore();
