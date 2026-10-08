import { Platform } from "react-native";
import { v4 as uuidv4 } from "uuid";

import { LifeMapDoc } from "@/domain/doc";
import { getMeta, setMeta } from "@/data/mapDb";
import { buildEnvelope, CloudEnvelope, decideSync, parseEnvelope } from "@/data/syncPolicy";
import { useSyncStore } from "@/state/syncStore";

// iCloud Drive snapshot sync (issue #29). One whole-document JSON envelope
// at /lifemap/lifemap.json in the user-facing iCloud Drive container; before
// every overwrite the previous remote file is rotated into
// /lifemap/backups (newest 5 kept) so a bad push or pull can never destroy
// data. The native module is require-guarded: an OTA update landing on a
// binary without it degrades to "unavailable" instead of crashing. Every
// public function swallows its errors — sync must never block local saves.

const CLOUD_DIR = "/lifemap";
const CLOUD_FILE = `${CLOUD_DIR}/lifemap.json`;
const BACKUP_DIR = `${CLOUD_DIR}/backups`;
const BACKUP_KEEP = 5;

const DEVICE_ID_KEY = "device_id";
const LAST_SAVED_KEY = "last_local_saved_at";
export const EDITS_PENDING_KEY = "local_edits_pending";
const SYNC_ENABLED_KEY = "sync_enabled";

type CloudModule = typeof import("react-native-cloud-storage");

let cachedModule: CloudModule | null | undefined;

function cloudModule(): CloudModule | null {
  if (cachedModule !== undefined) return cachedModule ?? null;
  if (Platform.OS !== "ios") {
    cachedModule = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("react-native-cloud-storage");
  } catch (err) {
    console.warn("[cloudSync] native module missing (old binary?)", err);
    cachedModule = null;
  }
  return cachedModule ?? null;
}

// the "documents" scope is the user-facing iCloud Drive folder
function docScope() {
  return cloudModule()?.CloudStorageScope.Documents;
}

// ---------- the user's on/off choice (settings screen) ----------
// persisted in the meta table; default ON — the feature exists to sync

export function syncEnabled(): boolean {
  return useSyncStore.getState().enabled;
}

// read once at app load (docStore.load) before any cloud decision
export async function loadSyncEnabled(): Promise<boolean> {
  const raw = await getMeta(SYNC_ENABLED_KEY);
  const enabled = raw !== "0";
  useSyncStore.getState().setEnabled(enabled);
  return enabled;
}

export async function setSyncEnabled(enabled: boolean): Promise<void> {
  useSyncStore.getState().setEnabled(enabled);
  await setMeta(SYNC_ENABLED_KEY, enabled ? "1" : "0").catch((err) =>
    console.warn("[cloudSync] enabled flag save failed", err),
  );
  if (!enabled) {
    // turning sync off drops any queued upload
    pendingDoc = null;
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
  }
}

export async function isSyncAvailable(): Promise<boolean> {
  const mod = cloudModule();
  if (!mod) return false;
  try {
    return await mod.CloudStorage.isCloudAvailable();
  } catch (err) {
    console.warn("[cloudSync] availability check failed", err);
    return false;
  }
}

// false when the running binary lacks the native module (an OTA update on
// an old build, or Expo Go) — the settings screen uses this to tell
// "rebuild the app" apart from "sign into iCloud"
export function nativeModulePresent(): boolean {
  return cloudModule() !== null;
}

async function getDeviceId(): Promise<string> {
  const existing = await getMeta(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = uuidv4();
  await setMeta(DEVICE_ID_KEY, id);
  return id;
}

// the savedAt stamp of the local document's content: the last successful
// push/pull, or "right now" while local edits are still waiting to upload —
// a dirty local doc must never be overwritten by an older remote
export async function localSavedAt(): Promise<number | null> {
  const pending = await getMeta(EDITS_PENDING_KEY);
  if (pending === "1") return Date.now();
  const raw = await getMeta(LAST_SAVED_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export async function readRemoteEnvelope(): Promise<CloudEnvelope | null> {
  const mod = cloudModule();
  if (!mod) return null;
  try {
    if (!(await mod.CloudStorage.exists(CLOUD_FILE, docScope()))) return null;
    await mod.CloudStorage.triggerSync(CLOUD_FILE, docScope()).catch(() => {});
    const raw = await mod.CloudStorage.readFile(CLOUD_FILE, docScope());
    const envelope = parseEnvelope(JSON.parse(raw));
    if (!envelope) console.warn("[cloudSync] remote file is not a valid envelope");
    return envelope;
  } catch (err) {
    console.warn("[cloudSync] remote read failed", err);
    return null;
  }
}

async function rotateBackups(mod: CloudModule): Promise<void> {
  if (!(await mod.CloudStorage.exists(CLOUD_FILE, docScope()))) return;
  const stat = await mod.CloudStorage.stat(CLOUD_FILE, docScope());
  const raw = await mod.CloudStorage.readFile(CLOUD_FILE, docScope());
  await mod.CloudStorage.writeFile(`${BACKUP_DIR}/backup-${Math.round(stat.mtimeMs)}.json`, raw, docScope());
  const names = (await mod.CloudStorage.readdir(BACKUP_DIR, docScope()))
    .filter((n) => n.startsWith("backup-"))
    .sort()
    .reverse();
  for (const stale of names.slice(BACKUP_KEEP)) {
    await mod.CloudStorage.unlink(`${BACKUP_DIR}/${stale}`, docScope()).catch(() => {});
  }
}

async function writeRemoteEnvelope(doc: LifeMapDoc): Promise<number | null> {
  const mod = cloudModule();
  if (!mod) return null;
  try {
    if (!(await mod.CloudStorage.exists(CLOUD_DIR, docScope()))) {
      await mod.CloudStorage.mkdir(CLOUD_DIR, docScope());
    }
    if (!(await mod.CloudStorage.exists(BACKUP_DIR, docScope()))) {
      await mod.CloudStorage.mkdir(BACKUP_DIR, docScope());
    }
    await rotateBackups(mod);
    const savedAt = Date.now();
    const envelope = buildEnvelope(doc, await getDeviceId(), savedAt);
    await mod.CloudStorage.writeFile(CLOUD_FILE, JSON.stringify(envelope), docScope());
    await setMeta(LAST_SAVED_KEY, String(savedAt));
    await setMeta(EDITS_PENDING_KEY, "0");
    useSyncStore.getState().markSynced(savedAt);
    return savedAt;
  } catch (err) {
    console.warn("[cloudSync] remote write failed", err);
    useSyncStore.getState().markError();
    return null;
  }
}

// records the pull so a later launch doesn't pull the same snapshot again
export async function markAdoptedRemote(savedAt: number): Promise<void> {
  await setMeta(LAST_SAVED_KEY, String(savedAt));
  await setMeta(EDITS_PENDING_KEY, "0");
  useSyncStore.getState().markSynced(savedAt);
}

// ---------- push queue ----------
// mirrors mapDb's save queue: rapid edits coalesce into one upload of the
// latest document, chained so uploads stay ordered

let pushQueue: Promise<unknown> = Promise.resolve();
let pendingDoc: LifeMapDoc | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

const PUSH_DEBOUNCE_MS = 5000;

export function scheduleCloudPush(doc: LifeMapDoc): void {
  if (!cloudModule() || !syncEnabled()) return;
  pendingDoc = doc;
  setMeta(EDITS_PENDING_KEY, "1").catch((err) => console.warn("[cloudSync] dirty flag failed", err));
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flushCloudPush, PUSH_DEBOUNCE_MS);
}

// upload the pending document NOW (app going to background, "Sync now");
// resolves false when the debounce window was empty (a no-op)
export function flushCloudPush(): Promise<boolean> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const doc = syncEnabled() ? pendingDoc : null;
  pendingDoc = null;
  if (doc) {
    useSyncStore.getState().markSyncing();
    pushQueue = pushQueue.then(() => writeRemoteEnvelope(doc));
    return pushQueue.then(() => true);
  }
  return pushQueue.then(() => false);
}

// one immediate decide-sync round for the menu's "Sync now": pull a newer
// remote (its envelope is returned for the caller to adopt), otherwise make
// sure local is uploaded
export async function syncNow(doc: LifeMapDoc): Promise<CloudEnvelope | null> {
  if (!syncEnabled()) return null;
  if (!(await isSyncAvailable())) {
    useSyncStore.getState().markUnavailable();
    return null;
  }
  useSyncStore.getState().markSyncing();
  const [remote, localAt] = await Promise.all([readRemoteEnvelope(), localSavedAt()]);
  if (remote && decideSync(localAt, remote) === "pull") {
    return remote; // the caller adopts it (docStore swaps the doc + saves)
  }
  const flushed = await flushCloudPush();
  if (!flushed && decideSync(localAt, remote) === "push") {
    // a "push" decision with a clean queue still uploads: the remote is stale
    await writeRemoteEnvelope(doc);
  }
  return null;
}
