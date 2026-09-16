import { applyPatches, enablePatches, Patch, produceWithPatches } from "immer";
import { create } from "zustand";

import { Recipe } from "@/domain/commands";
import { buildDemoDoc } from "@/domain/demoDoc";
import { emptyDoc, LifeMapDoc } from "@/domain/doc";
import { loadDoc, scheduleSave } from "@/data/mapDb";

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
  // false until the persisted map (or the seeded demo map) is in place, so
  // gestures never mutate a map that is about to be replaced
  loaded: boolean;
  canUndo: boolean;
  canRedo: boolean;
  run: (recipe: Recipe) => void;
  undo: () => void;
  redo: () => void;
  load: (screen: { width: number; height: number }) => Promise<void>;
}

export function createDocStore() {
  // the stacks are large and never rendered, so they live outside reactive
  // state; only their emptiness is observable (canUndo/canRedo)
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];

  return create<DocStore>((set, get) => ({
    doc: emptyDoc(),
    loaded: false,
    canUndo: false,
    canRedo: false,

    run(recipe) {
      // invariant violations throw out of the recipe: nothing applies
      const [next, patches, inverse] = produceWithPatches(get().doc, recipe);
      if (patches.length === 0) return; // a no-op edit creates no history
      undoStack.push({ patches, inverse });
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      redoStack.length = 0;
      set({ doc: next, canUndo: true, canRedo: false });
      scheduleSave(next);
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
    },

    redo() {
      const entry = redoStack.pop();
      if (!entry) return;
      const next = applyPatches(get().doc, entry.patches);
      undoStack.push(entry);
      set({ doc: next, canUndo: true, canRedo: redoStack.length > 0 });
      scheduleSave(next);
    },

    async load(screen) {
      // load NEVER leaves the app on a blank screen: any failure (corrupt
      // rows, open failure, first launch) resolves to a valid seeded document
      try {
        const doc = await loadDoc();
        if (doc) {
          set({ doc, loaded: true });
          return;
        }
      } catch (err) {
        console.warn("[docStore] load failed, seeding demo map", err);
      }
      const doc = buildDemoDoc(screen.width / 2, screen.height / 3);
      set({ doc, loaded: true });
      scheduleSave(doc);
    },
  }));
}

export const useDocStore = createDocStore();
