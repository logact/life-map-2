// ---------- time-of-day formatting ----------
// Domain-level so recurrence descriptions (src/domain/recur.ts) can use it
// without importing from the map layer. 24-hour clock, zero-padded minutes —
// the app's dates are all hand-rolled local-time formatting.

// "9:05", "21:30" — the time-of-day carried by a timed schedule field
export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
