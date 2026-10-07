import { Id, isRecord, LifeMapDoc } from "./doc";

// ---------- focus mode: measured work sessions ----------
// A focus session is "I am working on this task right now" (see
// src/state/focusStore.ts). Every ended segment writes one record under the
// focused task carrying `durationMs` — the same trail a manual journal
// entry leaves, with measured time attached. These are the pure reads over
// that trail; like the calendar derivations they stay free of timers and
// stores so the rules are testable.

// compact duration: "45s", "12m", "1h 5m" — the record title, the info
// card's total, the calendar's day rows and the banner all share it
export function fmtDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// a running stopwatch: "0:05", "12:34", "1:02:09" — the focus screen's
// timer and the map banner's elapsed readout
export function fmtClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

// total focused time on a node: the sum of the durations on the records
// directly under it. Deliberately NOT recursive — a goal's rollup beyond
// its own records is out of scope (segments attach to tasks anyway)
export function focusedMs(doc: LifeMapDoc, nodeId: Id): number {
  let total = 0;
  for (const edge of Object.values(doc.edges)) {
    if (edge.fromId !== nodeId) continue;
    const child = doc.nodes[edge.toId];
    if (child && isRecord(child) && typeof child.durationMs === "number") {
      total += child.durationMs;
    }
  }
  return total;
}

// the focus records of one calendar day (their occurredAt lands them
// there), for the day header's total
export function focusedMsOnDay(doc: LifeMapDoc, dayMs: number): number {
  const start = new Date(dayMs);
  const lo = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const hi = lo + 86400000;
  let total = 0;
  for (const node of Object.values(doc.nodes)) {
    if (
      isRecord(node) &&
      typeof node.durationMs === "number" &&
      node.occurredAt !== undefined &&
      node.occurredAt >= lo &&
      node.occurredAt < hi
    ) {
      total += node.durationMs;
    }
  }
  return total;
}
