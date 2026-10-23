import { calendarMonth, CalItem, groupDayItems } from "./calendar";
import { Id, isGoal, isRecord, isTask, LifeMapDoc, NodeData, RecurRule, Status } from "./doc";
import { fmtDuration, focusedMs } from "./focus";
import { getIndexes } from "./indexes";
import { dayStart, describeRecur, recurStats, recurStatus } from "./recur";
import { goalStatus } from "./status";
import { fmtDate, fmtTime } from "./time";

// ---------- Markdown export for AI review ----------
// The export's consumer is an LLM doing a retrospective ("how did this
// period go?", "how is this going and why?"), not a backup tool — so the
// format is human-readable Markdown and drops everything that is pure
// noise to a model (canvas coordinates, internal ids, dayOrder). All rules
// are pure derivations over the doc with `now` passed explicitly, reusing
// the calendar/recurrence/focus derivations; tests live in
// src/domain/__tests__/export.test.ts.
//
// Two orthogonal modes:
// - docToMarkdown: a global date-range export ("how was this period?"),
//   English labels (the app has no i18n)
// - subgraphToMarkdown: one node's context ("how is this going?"), in a
//   fixed Chinese template: a format preamble, EVERY complete path the
//   node sits on as a numbered 【类型-标题-描述-状态】 sequence (records
//   omitted from paths), then the selected node's details — 基本信息, its
//   note list, and its directly linked records sorted by time. The node
//   graph is a DAG, not a tree (indexes.ts); synthetic expand-midpoints
//   (doc.ts) are passed through — their neighbors attach to the real
//   parent, matching the status rollup's behaviour.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

// "Oct 20 2026 (Mon)" — a day heading in the log section
function fmtDay(ms: number): string {
  return `${fmtDate(ms)} (${WEEKDAYS[new Date(ms).getDay()]})`;
}

// the header's timezone note: the whole app computes day boundaries in
// local time (dayStart is local midnight), so the export says which local
// zone the dates belong to — "GMT+8", "GMT-3:30"
function tzLabel(now: number): string {
  const mins = -new Date(now).getTimezoneOffset();
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${m > 0 ? `${h}:${String(m).padStart(2, "0")}` : h}`;
}

// one bullet in a day log, derived from the calendar item. Scheduled
// (future) occurrences are skipped: a habit's rule fills every future day
// with them, which is pure noise for a retrospective
function itemLine(doc: LifeMapDoc, item: CalItem): string | null {
  const t = item.title;
  switch (item.label) {
    case "Logged":
      return `✔ ${t} (logged)`;
    case "Missed":
      return `✗ ${t} (missed)`;
    case "Due today":
      return `• ${t} (due today)`;
    case "Overdue":
      return `⚠ ${t} (overdue)`;
    case "Completed":
      return `✔ ${t} (completed)`;
    case "Started":
      return `Started: ${t}`;
    case "Target date":
      return `Target: ${t}`;
    case "Due date":
      return `Due: ${t}`;
    case "Record": {
      const node = doc.nodes[item.nodeId];
      // a record's occurred-at is exact — export it with seconds
      const time = item.timeMs !== undefined ? ` at ${fmtTime(item.timeMs, true)}` : "";
      if (node?.durationMs !== undefined) {
        return `Focus · ${fmtDuration(node.durationMs)}${time} — "${t}"`;
      }
      const note = node?.note?.trim();
      return `Record · ${t}${time}${note ? `: "${note}"` : ""}`;
    }
    default:
      return null;
  }
}

// every day in [startDay, endDay] holding at least one calendar item, in
// ascending order; the items keep the calendar's own ordering (tone, then
// the stored manual day order)
function daysWithItems(
  doc: LifeMapDoc,
  startDay: number,
  endDay: number,
  now: number,
): { dayMs: number; items: CalItem[] }[] {
  const out: { dayMs: number; items: CalItem[] }[] = [];
  const s = new Date(startDay);
  const e = new Date(endDay);
  let y = s.getFullYear();
  let m = s.getMonth();
  const endKey = e.getFullYear() * 12 + e.getMonth();
  while (y * 12 + m <= endKey) {
    const month = calendarMonth(doc, y, m, now);
    for (const [day, items] of month) {
      const dayMs = new Date(y, m, day).getTime();
      if (dayMs < startDay || dayMs > endDay) continue;
      out.push({ dayMs, items });
    }
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  out.sort((a, b) => a.dayMs - b.dayMs);
  return out;
}

// the earliest dated thing anywhere in the doc — the start of an "all
// time" range. Undefined when nothing carries a date yet
function earliestStamp(doc: LifeMapDoc): number | undefined {
  let min: number | undefined;
  const take = (ms: number | undefined) => {
    if (ms !== undefined && (min === undefined || ms < min)) min = ms;
  };
  for (const n of Object.values(doc.nodes)) {
    take(n.occurredAt);
    take(n.createdAt);
    take(n.startedAt);
    take(n.completedAt);
    take(n.dueDate);
    take(n.targetDate);
    take(n.recur?.anchor);
    for (const t of n.log ?? []) take(t);
    for (const note of n.notes) take(note.createdAt);
  }
  return min;
}

// ---------- mode A: the whole doc over a date range ----------

export type ExportRange = "last7" | "last30" | "all";

export function docToMarkdown(doc: LifeMapDoc, options: { range: ExportRange }, now: number): string {
  const today = dayStart(now);
  const startDay =
    options.range === "all"
      ? dayStart(earliestStamp(doc) ?? now)
      : addDays(today, options.range === "last7" ? -6 : -29);

  const nodes = Object.values(doc.nodes).filter((n) => !n.synthetic);
  const goals = nodes.filter(isGoal);
  const activeGoals = goals.filter((g) => !g.completedAt);
  const completedInRange = goals.filter(
    (g) => g.completedAt !== undefined && g.completedAt >= startDay && g.completedAt <= now,
  ).length;
  const habits = nodes.filter((n) => isTask(n) && n.recur);
  const habitStats = habits.map((h) => recurStats(h.recur!, h.log ?? [], now));
  const avgStreak =
    habitStats.length > 0
      ? Math.round((habitStats.reduce((s, x) => s + x.streak, 0) / habitStats.length) * 10) / 10
      : 0;

  // measured focus inside the range: focus segments are records carrying a
  // duration (focus.ts)
  let focusMs = 0;
  let sessions = 0;
  for (const n of nodes) {
    if (
      isRecord(n) &&
      n.durationMs !== undefined &&
      n.occurredAt !== undefined &&
      dayStart(n.occurredAt) >= startDay &&
      n.occurredAt <= now
    ) {
      focusMs += n.durationMs;
      sessions++;
    }
  }

  const lines: string[] = [
    "# Life Map Export",
    `Range: ${fmtDate(startDay)} – ${fmtDate(today)} · Exported: ${fmtDate(now)} (${tzLabel(now)})`,
    "",
    "## Summary",
    `- ${activeGoals.length} active goal${activeGoals.length === 1 ? "" : "s"} (${completedInRange} completed this period)`,
    `- ${habits.length} habit${habits.length === 1 ? "" : "s"} · avg streak ${avgStreak}`,
    `- Total focus: ${fmtDuration(focusMs)} across ${sessions} session${sessions === 1 ? "" : "s"}`,
    "",
    "## Goals & Habits",
  ];
  for (const g of goals) {
    const facts = [`goal, ${goalStatus(doc, g.id)}`];
    if (g.targetDate !== undefined) facts.push(`target ${fmtDate(g.targetDate)}`);
    lines.push(`- ${g.title} (${facts.join(" · ")})`);
  }
  for (const [i, h] of habits.entries()) {
    const s = habitStats[i];
    lines.push(
      `- ${h.title} (habit — ${describeRecur(h.recur!)}): ${s.total} logged, streak ${s.streak}`,
    );
  }
  if (goals.length === 0 && habits.length === 0) lines.push("- (none)");

  lines.push("", "## Daily Log");
  let anyDay = false;
  for (const { dayMs, items } of daysWithItems(doc, startDay, today, now)) {
    const dayLines = groupDayItems(items)
      .map((it) => itemLine(doc, it))
      .filter((l): l is string => l !== null);
    if (dayLines.length === 0) continue;
    anyDay = true;
    lines.push("", `### ${fmtDay(dayMs)}`, ...dayLines.map((l) => `- ${l}`));
  }
  if (!anyDay) lines.push("", "(nothing logged in this period)");
  return lines.join("\n") + "\n";
}

// ---------- mode B: one node plus its context ----------

// a node's real neighbors: edge endpoints, with synthetic expand-midpoints
// passed through (their own neighbors attach here instead — the midpoint
// is structure, not content). Order follows edge insertion order
function effectiveNeighbors(doc: LifeMapDoc, id: Id, dir: "out" | "in"): Id[] {
  const idx = getIndexes(doc);
  const out: Id[] = [];
  const walk = (nid: Id) => {
    const edgeIds = dir === "out" ? idx.outEdgeIds.get(nid) : idx.inEdgeIds.get(nid);
    for (const eid of edgeIds ?? []) {
      const e = doc.edges[eid];
      const other = doc.nodes[dir === "out" ? (e?.toId ?? "") : (e?.fromId ?? "")];
      if (!other) continue;
      if (other.synthetic) walk(other.id);
      else if (!out.includes(other.id)) out.push(other.id);
    }
  };
  walk(id);
  return out;
}

const STATUS_ZH: Record<Status, string> = {
  todo: "未开始",
  "in-progress": "进行中",
  done: "已完成",
};

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];

// Chinese companion of describeRecur (the English one stays for the UI):
// "每天", "每 2 天", "每周(周一、周五)", "每月 15 号"
function describeRecurZh(rule: RecurRule): string {
  const every = rule.interval === 1 ? "每" : `每 ${rule.interval} `;
  if (rule.freq === "daily") return rule.interval === 1 ? "每天" : `${every}天`;
  if (rule.freq === "weekly") {
    const days = (rule.weekdays && rule.weekdays.length > 0
      ? [...rule.weekdays].sort((a, b) => a - b)
      : [new Date(rule.anchor).getDay()]
    )
      .map((d) => `周${WEEKDAYS_ZH[d]}`)
      .join("、");
    return `${every}周(${days})`;
  }
  return `${every}月 ${new Date(rule.anchor).getDate()} 号`;
}

function kindLabelZh(node: NodeData): string {
  if (isGoal(node)) return "目标";
  if (isRecord(node)) return "记录";
  if (node.recur) return "习惯";
  return "任务";
}

// the status word for goals/tasks/habits (records carry no status)
function nodeStatusZh(doc: LifeMapDoc, node: NodeData, now: number): string {
  if (isGoal(node)) return STATUS_ZH[goalStatus(doc, node.id)];
  if (node.recur) return STATUS_ZH[recurStatus(node, now)];
  return STATUS_ZH[node.status ?? "todo"];
}

// safety nets for dense graphs, same idea as route.ts: stop enumerating
// once the paths are past what anyone will read
const MAX_PATHS = 32;
const MAX_PATH_HOPS = 15;

// EVERY complete path the node sits on: from an ancestor-less node down to
// the selected node, ancestor first. Records are excluded — a record on
// the way ends the branch instead of joining the path (paths answer
// "which life area is this?", and records carry no such context). A node
// with no qualifying ancestors yields the single-node path.
function allPathsTo(doc: LifeMapDoc, rootId: Id): NodeData[][] {
  const paths: NodeData[][] = [];
  const walk = (chain: Id[]) => {
    if (paths.length >= MAX_PATHS) return;
    const head = chain[chain.length - 1];
    const parents = effectiveNeighbors(doc, head, "in").filter((p) => {
      const n = doc.nodes[p];
      return n && !isRecord(n) && !chain.includes(p);
    });
    if (parents.length === 0 || chain.length >= MAX_PATH_HOPS) {
      paths.push([...chain].reverse().map((id) => doc.nodes[id]));
      return;
    }
    for (const p of parents) walk([...chain, p]);
  };
  walk([rootId]);
  return paths;
}

// one path entry per the template: 【类型-标题-描述-状态】, with (当前) on
// the selected node. Paths keep only 目标/任务 (a habit is a task here);
// the description segment is dropped entirely when the node has none
// (tasks carry no description field)
function pathEntryZh(doc: LifeMapDoc, node: NodeData, isCurrent: boolean, now: number): string {
  const kind = isGoal(node) ? "目标" : "任务";
  const desc = node.description?.trim();
  const parts = [kind, node.title, ...(desc ? [desc] : []), nodeStatusZh(doc, node, now)];
  return `【${parts.join("-")}】${isCurrent ? "(当前)" : ""}`;
}

// 基本信息: type, status, the kind-specific schedule fields, description
// or note, habit counts, measured focus
function basicInfoZh(doc: LifeMapDoc, node: NodeData, now: number): string[] {
  const lines: string[] = [`- 类型: ${kindLabelZh(node)}`];
  const dates = (entries: [string, number | undefined][]) => {
    const facts = entries.filter((e): e is [string, number] => e[1] !== undefined);
    if (facts.length > 0) lines.push(`- ${facts.map(([k, v]) => `${k}: ${fmtDate(v)}`).join(" · ")}`);
  };
  if (isGoal(node)) {
    lines.push(`- 状态: ${nodeStatusZh(doc, node, now)}`);
    dates([
      ["目标日期", node.targetDate],
      ["开始", node.startedAt],
      ["完成", node.completedAt],
    ]);
    if (node.description?.trim()) lines.push(`- 描述: ${node.description.trim()}`);
  } else if (isRecord(node)) {
    // a record's occurred-at is an exact moment — export it with seconds
    if (node.occurredAt !== undefined) {
      lines.push(`- 发生时间: ${fmtDate(node.occurredAt)} ${fmtTime(node.occurredAt, true)}`);
    }
    if (node.durationMs !== undefined) lines.push(`- 时长: ${fmtDuration(node.durationMs)}`);
    if (node.note?.trim()) lines.push(`- 内容: ${node.note.trim()}`);
  } else if (node.recur) {
    lines.push(`- 状态: ${nodeStatusZh(doc, node, now)}`);
    lines.push(`- 重复规则: ${describeRecurZh(node.recur)}`);
    const s = recurStats(node.recur, node.log ?? [], now);
    lines.push(`- 打卡: 共 ${s.total} 次 · 当前连续 ${s.streak} 次`);
  } else {
    lines.push(`- 状态: ${nodeStatusZh(doc, node, now)}`);
    dates([
      ["截止", node.dueDate],
      ["开始", node.startedAt],
      ["完成", node.completedAt],
    ]);
  }
  const directFocusMs = focusedMs(doc, node.id);
  if (directFocusMs > 0 && !isRecord(node)) {
    lines.push(`- 专注时长: ${fmtDuration(directFocusMs)}`);
  }
  return lines;
}

// the records directly linked to the node (either direction), deduped and
// sorted by time ascending — the node's factual history, full length
function linkedRecordsZh(doc: LifeMapDoc, rootId: Id): string[] {
  const ids = [...effectiveNeighbors(doc, rootId, "in"), ...effectiveNeighbors(doc, rootId, "out")];
  const records = [...new Set(ids)]
    .map((id) => doc.nodes[id])
    .filter((n): n is NodeData => !!n && isRecord(n));
  const timeOf = (r: NodeData) => r.occurredAt ?? r.createdAt ?? 0;
  records.sort((a, b) => timeOf(a) - timeOf(b));
  return records.map((r, i) => {
    const time = timeOf(r);
    let line = `${i + 1}. ${time > 0 ? `${fmtDate(time)} ${fmtTime(time, true)}` : "未知时间"}: ${r.title}`;
    if (r.note?.trim()) line += ` — ${r.note.trim()}`;
    if (r.durationMs !== undefined) line += ` (${fmtDuration(r.durationMs)})`;
    return line;
  });
}

export function subgraphToMarkdown(doc: LifeMapDoc, rootId: Id, now: number): string {
  const root = doc.nodes[rootId];
  if (!root) return "";

  const lines: string[] = [
    `# 导出: ${root.title}`,
    `导出于: ${fmtDate(now)} (${tzLabel(now)})`,
    "",
    "## 内容格式描述",
    "",
    "本文件是「人生地图」中一个节点及其上下文的导出,供 AI 复盘使用。",
    "- 节点类型: 目标(goal)、任务(task)、习惯(habit,按重复规则打卡的任务)、记录(record,某一天发生的事或一段专注时长)。",
    "- 有向边 A → B 表示 A 拆解/细化为 B。",
    "- 「完整路径」是从顶层节点一路到当前节点的每一条链路,按 【类型-标题-描述-状态】 编号,(当前) 标记本次导出的节点,用来回答“这件事属于哪个人生领域”;路径上只保留目标/任务,record 一律省略。",
    "- 「当前节点的详细信息」包含基本信息、全部笔记(note)、与它直接相连的记录(按时间升序),以及沿出边可达的全部后继节点。",
    "",
    "## 完整路径",
  ];

  const paths = allPathsTo(doc, rootId);
  if (paths.length === 1 && paths[0].length === 1) {
    lines.push("", "(当前节点是顶层节点,无上游路径)");
  } else {
    // one numbered sequence per path: the graph is a DAG, so the node can
    // sit on several complete paths and each is its own group
    paths.forEach((path, i) => {
      lines.push("", `### 路径 ${i + 1}`);
      path.forEach((n, j) => {
        lines.push(`${j + 1}.${pathEntryZh(doc, n, n.id === rootId, now)}`);
      });
    });
  }

  lines.push("", "## 当前节点的详细信息", "", `### 当前节点: ${root.title}`, "", "#### 基本信息", "");
  lines.push(...basicInfoZh(doc, root, now));

  lines.push("", "#### note", "");
  if (root.notes.length === 0) {
    lines.push("(无)");
  } else {
    root.notes.forEach((n, i) => lines.push(`${i + 1}. (${fmtDate(n.createdAt)}) ${n.text}`));
  }

  lines.push("", "#### 关联的记录 (按照时间排序)", "");
  const records = linkedRecordsZh(doc, rootId);
  if (records.length === 0) {
    lines.push("(无)");
  } else {
    lines.push(...records);
  }

  // the node's FULL downstream closure (BFS over out-edges, records
  // excluded — they are listed above): what this goal/task breaks down
  // into, to the leaves. Synthetic midpoints are passed through UNLESS
  // they carry a title — an expand-midpoint starts as untitled structure,
  // but once the user names it (the seed's "Spread to zoom into a road")
  // it is content and must be listed
  lines.push("", "#### 后继节点", "");
  const successors: NodeData[] = [];
  const seen = new Set<Id>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const next: Id[] = [];
    for (const id of frontier) {
      for (const eid of getIndexes(doc).outEdgeIds.get(id) ?? []) {
        const target = doc.nodes[doc.edges[eid]?.toId ?? ""];
        if (!target || seen.has(target.id)) continue;
        seen.add(target.id);
        next.push(target.id);
        if (target.synthetic && !target.title.trim()) continue; // structure
        if (!isRecord(target)) successors.push(target);
      }
    }
    frontier = next;
  }
  if (successors.length === 0) {
    lines.push("(无)");
  } else {
    successors.forEach((n, i) => {
      lines.push(`${i + 1}.${pathEntryZh(doc, n, false, now)}`);
    });
  }

  return lines.join("\n") + "\n";
}
