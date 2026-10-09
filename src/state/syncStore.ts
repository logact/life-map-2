import { create } from "zustand";

// observable iCloud sync status for the settings screen and the map menu
// (src/data/cloudSync.ts does the work and owns persistence; this store is
// only the read-out). `enabled` is the user's on/off choice — when false
// every sync operation is a no-op. `lastError` is the detail of the most
// recent failure (native error code/message) so a TestFlight screenshot can
// carry the real cause.
export type SyncState = "idle" | "syncing" | "unavailable" | "error";

interface SyncStore {
  state: SyncState;
  lastSyncedAt: number | null;
  lastError: string | null;
  enabled: boolean;
  // store-only updates; persistence lives in cloudSync (setSyncEnabled)
  setEnabled: (enabled: boolean) => void;
  markSyncing: () => void;
  markSynced: (at: number) => void;
  markUnavailable: (detail?: string) => void;
  markError: (detail?: string) => void;
}

export const useSyncStore = create<SyncStore>((set) => ({
  state: "idle",
  lastSyncedAt: null,
  lastError: null,
  enabled: true,
  setEnabled: (enabled) => set({ enabled }),
  markSyncing: () => set({ state: "syncing" }),
  markSynced: (at) => set({ state: "idle", lastSyncedAt: at, lastError: null }),
  // a call without detail keeps the previous one — several layers report the
  // same failure and only the lowest has the native error
  markUnavailable: (detail) => set((s) => ({ state: "unavailable", lastError: detail ?? s.lastError })),
  markError: (detail) => set((s) => ({ state: "error", lastError: detail ?? s.lastError })),
}));
