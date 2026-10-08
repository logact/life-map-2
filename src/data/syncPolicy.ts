import { LifeMapDoc } from "@/domain/doc";

// The cloud payload: one whole-document snapshot per write, wrapped in an
// envelope whose `savedAt` is the ONLY freshness signal (iCloud file mtimes
// are not reliable across devices).
export interface CloudEnvelope {
  format: 1;
  savedAt: number;
  deviceId: string;
  doc: LifeMapDoc;
}

export type SyncDecision = "pull" | "push" | "none";

// accepts the remote snapshot only when it is structurally a LifeMapDoc —
// a corrupt or foreign file must never replace local data
export function parseEnvelope(json: unknown): CloudEnvelope | null {
  if (typeof json !== "object" || json === null) return null;
  const e = json as Record<string, unknown>;
  if (e.format !== 1) return null;
  if (typeof e.savedAt !== "number" || !Number.isFinite(e.savedAt)) return null;
  if (typeof e.deviceId !== "string" || e.deviceId.length === 0) return null;
  const doc = e.doc as Record<string, unknown> | null;
  if (typeof doc !== "object" || doc === null) return null;
  if (typeof doc.nodes !== "object" || doc.nodes === null) return null;
  if (typeof doc.edges !== "object" || doc.edges === null) return null;
  if (!Array.isArray(doc.rootNodeIds) || !Array.isArray(doc.rootEdgeIds)) return null;
  return e as unknown as CloudEnvelope;
}

// last-writer-wins by the envelope's embedded savedAt; a missing remote is
// the first-ever sync, so local uploads itself
export function decideSync(localSavedAt: number | null, remote: CloudEnvelope | null): SyncDecision {
  if (!remote) return "push";
  const local = localSavedAt ?? 0;
  if (remote.savedAt > local) return "pull";
  if (remote.savedAt < local) return "push";
  return "none";
}

export function buildEnvelope(doc: LifeMapDoc, deviceId: string, savedAt: number): CloudEnvelope {
  return { format: 1, savedAt, deviceId, doc };
}
