import { create } from "zustand";

// observable iCloud sync status for the settings screen and the map menu
// (src/data/cloudSync.ts does the work and owns persistence; this store is
// only the read-out). `enabled` is the user's on/off choice — when false
// every sync operation is a no-op.
export type SyncState = "idle" | "syncing" | "unavailable" | "error";

interface SyncStore {
  state: SyncState;
  lastSyncedAt: number | null;
  enabled: boolean;
  // store-only updates; persistence lives in cloudSync (setSyncEnabled)
  setEnabled: (enabled: boolean) => void;
  markSyncing: () => void;
  markSynced: (at: number) => void;
  markUnavailable: () => void;
  markError: () => void;
}

export const useSyncStore = create<SyncStore>((set) => ({
  state: "idle",
  lastSyncedAt: null,
  enabled: true,
  setEnabled: (enabled) => set({ enabled }),
  markSyncing: () => set({ state: "syncing" }),
  markSynced: (at) => set({ state: "idle", lastSyncedAt: at }),
  markUnavailable: () => set({ state: "unavailable" }),
  markError: () => set({ state: "error" }),
}));
