import { Id, isGoal, isRecord, isTask, LifeMapDoc, NodeData, RecurRule, Status } from "./doc";
import { fmtDuration, focusedMs } from "./focus";
import { getIndexes } from "./indexes";
import { dayStart, dueState, recurStats, recurStatus } from "./recur";
import { goalStatus } from "./status";
import { fmtDate, fmtTime } from "./time";

// ---------- Markdown export for AI review ----------
// The export's consumer is an LLM doing a retrospective ("how did this
// period go?", "how is this going and why?"), not a backup tool — so the
// format is human-readable Markdown and drops everything that is pure
// noise to a model (canvas coordinates, internal ids, dayOrder). All rules
// are pure derivations over the doc with `now` passed explicitly, reusing
// the recurrence/focus/status derivations; tests live in
// src/domain/__tests__/export.test.ts.
//
// Two orthogonal modes, both in a fixed Chinese template:
// - docToMarkdown: a global date-range export ("how was this period?") —
//   a header (range + export time + timezone), then three sections:
//   【范围标签】完成的工作 (numbered completed goals/tasks and logged
//   habits, each with 基本信息, notes and in-range linked records),
//   【范围标签】超时的工作 (overdue one-off tasks and due/overdue habits,
//   evaluated as of the range end), and 事件汇总 (records, task creations
//   and goal creations in range, chronological). Nothing past `now`
//   counts — the effective range end is clamped to it.
// - subgraphToMarkdown: one node's context ("how is this going?"): a
//   format preamble, EVERY complete path the node sits on as a numbered
//   【类型-标题-描述-状态】 sequence (records omitted from paths), then
//   the selected node's details — 基本信息, its note list, and its
//   directly linked records sorted by time. The node graph is a DAG, not
//   a tree (indexes.ts); synthetic expand-midpoints (doc.ts) are passed
//   through — their neighbors attach to the real parent, matching the
//   status rollup's behaviour.

function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
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

// presets, or an explicit custom range from the settings screen
export type ExportOptions = { range: ExportRange } | { startMs: number; endMs: number };

// "10月20日" — the Chinese month-day the section headings are built from
function fmtMonthDayZh(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// the word prefixing the first two section headings: 今天 when start, end
// and now all share one day, a single date for a one-day range, else a
// span ("10月15日–10月21日")
function rangeLabelZh(startMs: number, endMs: number, now: number): string {
  const sameDay = (a: number, b: number) => dayStart(a) === dayStart(b);
  if (sameDay(startMs, endMs) && sameDay(endMs, now)) return "今天";
  if (sameDay(startMs, endMs)) return fmtMonthDayZh(startMs);
  return `${fmtMonthDayZh(startMs)}–${fmtMonthDayZh(endMs)}`;
}

export function docToMarkdown(doc: LifeMapDoc, options: ExportOptions, now: number): string {
  let startMs: number;
  let endMs: number;
  if ("range" in options) {
    startMs =
      options.range === "all"
        ? dayStart(earliestStamp(doc) ?? now)
        : addDays(dayStart(now), options.range === "last7" ? -6 : -29);
    endMs = now;
  } else {
    startMs = options.startMs;
    endMs = options.endMs;
  }
  // nothing in the future counts: the effective end is clamped to now
  const end = Math.min(endMs, now);
  const inRange = (ms: number | undefined): ms is number =>
    ms !== undefined && ms >= startMs && ms <= end;

  const nodes = Object.values(doc.nodes).filter((n) => !n.synthetic);

  // 完成的工作: goals/tasks completed in range plus habits with an
  // in-range check-in, ordered by when the work landed
  const doneAt = (n: NodeData): number | undefined => {
    if (isGoal(n)) return inRange(n.completedAt) ? n.completedAt : undefined;
    if (isTask(n) && n.recur) {
      const hits = (n.log ?? []).filter(inRange);
      return hits.length > 0 ? hits[hits.length - 1] : undefined;
    }
    if (isTask(n)) {
      return n.status === "done" && inRange(n.completedAt) ? n.completedAt : undefined;
    }
    return undefined;
  };
  const done = nodes
    .map((n) => ({ node: n, at: doneAt(n) }))
    .filter((e): e is { node: NodeData; at: number } => e.at !== undefined)
    .sort((a, b) => a.at - b.at);

  // 超时的工作, evaluated as of the (clamped) range end — mirrors the
  // calendar's overdue rules: an untimed due date turns overdue the day
  // after, a timed one the moment it passes
  const overdueTasks = nodes
    .filter(
      (n) =>
        isTask(n) &&
        !n.recur &&
        n.dueDate !== undefined &&
        n.status !== "done" &&
        (n.dueHasTime ? n.dueDate < end : dayStart(n.dueDate) < dayStart(end)),
    )
    .sort((a, b) => a.dueDate! - b.dueDate!);
  const overdueHabits = nodes.filter((n) => {
    const s = isTask(n) && n.recur ? dueState(n, end) : null;
    return s === "due" || s === "overdue";
  });

  // 事件汇总: records, task creations and goal creations in range,
  // chronological
  const events = nodes
    .map((n) => {
      const time = isRecord(n) ? (n.occurredAt ?? n.createdAt) : n.createdAt;
      return inRange(time) ? { node: n, time } : null;
    })
    .filter((e): e is { node: NodeData; time: number } => e !== null)
    .sort((a, b) => a.time - b.time);

  const label = rangeLabelZh(startMs, end, now);
  const lines: string[] = [
    "# 人生地图导出",
    `范围: ${fmtDate(startMs)} – ${fmtDate(end)} · 导出于: ${fmtDate(now)} (${tzLabel(now)})`,
    "",
    `### ${label}完成的工作`,
    "",
  ];
  if (done.length === 0) {
    lines.push("(无)");
  } else {
    done.forEach(({ node }, i) => {
      lines.push(`${i + 1}. 【${kindLabelZh(node)}-${node.title}-${nodeStatusZh(doc, node, now)}】`);
      lines.push(...basicInfoZh(doc, node, now));
      if (node.notes.length > 0) {
        lines.push("- 笔记:");
        for (const note of node.notes) lines.push(`  - (${fmtDate(note.createdAt)}) ${note.text}`);
      }
      const records = linkedRecordsZh(doc, node.id, { startMs, endMs: end });
      if (records.length > 0) {
        lines.push("- 关联的记录:");
        lines.push(...records.map((l) => `  ${l}`));
      }
    });
  }

  lines.push("", `### ${label}超时的工作`, "");
  if (overdueTasks.length === 0 && overdueHabits.length === 0) {
    lines.push("(无)");
  } else {
    for (const t of overdueTasks) {
      const time = t.dueHasTime ? ` ${fmtTime(t.dueDate!)}` : "";
      lines.push(`- ${t.title}【${kindLabelZh(t)}】 — 截止: ${fmtDate(t.dueDate!)}${time}`);
    }
    for (const h of overdueHabits) {
      lines.push(`- ${h.title}【习惯】 — 重复规则: ${describeRecurZh(h.recur!)}`);
    }
  }

  lines.push("", "### 事件汇总", "");
  if (events.length === 0) {
    lines.push("(无)");
  } else {
    for (const { node, time } of events) {
      let line = `- ${fmtDate(time)}: 【${kindLabelZh(node)}】${node.title}`;
      if (isRecord(node)) {
        if (node.note?.trim()) line += ` — ${node.note.trim()}`;
        if (node.durationMs !== undefined) line += ` (${fmtDuration(node.durationMs)})`;
      }
      lines.push(line);
    }
  }

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
    dates([["发生时间", node.occurredAt]]);
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
// sorted by time ascending — the node's factual history. Mode B wants it
// full length; mode A passes a range to keep only the period's records
function linkedRecordsZh(
  doc: LifeMapDoc,
  rootId: Id,
  range?: { startMs: number; endMs: number },
): string[] {
  const ids = [...effectiveNeighbors(doc, rootId, "in"), ...effectiveNeighbors(doc, rootId, "out")];
  const records = [...new Set(ids)]
    .map((id) => doc.nodes[id])
    .filter((n): n is NodeData => !!n && isRecord(n));
  const timeOf = (r: NodeData) => r.occurredAt ?? r.createdAt ?? 0;
  records.sort((a, b) => timeOf(a) - timeOf(b));
  const shown = range
    ? records.filter((r) => {
        const t = timeOf(r);
        return t >= range.startMs && t <= range.endMs;
      })
    : records;
  return shown.map((r, i) => {
    const time = timeOf(r);
    let line = `${i + 1}. ${time > 0 ? fmtDate(time) : "未知时间"}: ${r.title}`;
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
