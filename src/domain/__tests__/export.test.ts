import { describe, expect, it } from "@jest/globals";

import { emptyDoc, Id, LifeMapDoc, makeEdgeData, makeGoal, makeRecordNode, makeTask, NodeData } from "../doc";
import { docToMarkdown, subgraphToMarkdown } from "../export";
import { dayStart } from "../recur";

// fixed local dates in October 2026; `now` is Wednesday the 21st at noon
const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const NOW = at("2026-10-21");

function docWith(...nodes: NodeData[]): LifeMapDoc {
  const doc = emptyDoc();
  for (const n of nodes) doc.nodes[n.id] = n;
  return doc;
}

function connect(doc: LifeMapDoc, fromId: Id, toId: Id): LifeMapDoc {
  const e = makeEdgeData(fromId, toId, null);
  doc.edges[e.id] = e;
  return doc;
}

describe("docToMarkdown", () => {
  it("renders the header and in-range completed work with details", () => {
    const goal = makeGoal(0, 0, "Ship v1", { completedAt: at("2026-10-20") });
    goal.notes.push({
      id: "n1",
      text: "复盘笔记",
      createdAt: at("2026-10-20"),
      updatedAt: at("2026-10-20"),
    });
    const task = makeTask(0, 0, "Write report", { status: "done", completedAt: at("2026-10-19") });
    const habit = makeTask(0, 0, "Morning run", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-10-15") },
      log: [at("2026-10-19"), NOW],
    });
    const rec = makeRecordNode(0, 0, "Called grandma", "she is well", at("2026-10-20"));
    const stale = makeGoal(0, 0, "Old win", { completedAt: at("2026-10-01") });
    const doc = docWith(goal, task, habit, rec, stale);
    connect(doc, goal.id, rec.id);

    const md = docToMarkdown(doc, { range: "last7" }, NOW);
    expect(md).toContain("# 人生地图导出");
    expect(md).toContain("范围: Oct 15 2026 – Oct 21 2026");
    expect(md).toMatch(/导出于: Oct 21 2026 \(GMT[+-]/);
    expect(md).toContain("### 10月15日–10月21日完成的工作");
    // numbered by completion time ascending: task (19th), goal (20th), habit (21st)
    expect(md).toContain("1. 【任务-Write report-已完成】");
    expect(md).toContain("2. 【目标-Ship v1-已完成】");
    expect(md).toContain("3. 【习惯-Morning run-已完成】");
    // 基本信息 lines ride along under each entry
    expect(md).toContain("- 类型: 目标");
    expect(md).toContain("- 完成: Oct 20 2026");
    expect(md).toContain("- 重复规则: 每天");
    // the notes subsection only appears where notes exist
    expect(md).toContain("- 笔记:\n  - (Oct 20 2026) 复盘笔记");
    // the in-range linked record nests under the goal
    expect(md).toContain("- 关联的记录:\n  1. Oct 20 2026: Called grandma — she is well");
    // completed before the range — absent
    expect(md).not.toContain("Old win");
  });

  it("filters linked records to the range", () => {
    const task = makeTask(0, 0, "Fix bug", { status: "done", completedAt: at("2026-10-20") });
    const inR = makeRecordNode(0, 0, "In range", "", at("2026-10-20"));
    const outR = makeRecordNode(0, 0, "Out of range", "", at("2026-10-01"));
    const doc = docWith(task, inR, outR);
    connect(doc, task.id, inR.id);
    connect(doc, task.id, outR.id);

    const md = docToMarkdown(doc, { range: "last7" }, NOW);
    expect(md).toContain("1. Oct 20 2026: In range");
    expect(md).not.toContain("Out of range");
  });

  it("lists overdue tasks and due/overdue habits as of the range end", () => {
    const untimed = makeTask(0, 0, "Late report", { dueDate: at("2026-10-19") });
    const timed = makeTask(0, 0, "Timed deadline", {
      dueDate: new Date("2026-10-21T09:00:00").getTime(),
      dueHasTime: true,
    });
    // a daily habit unlogged today is due
    const dueHabit = makeTask(0, 0, "Meditate", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-10-18") },
      log: [at("2026-10-18")],
    });
    // a Monday habit not scheduled today (Wednesday), last log before the
    // previous scheduled day → overdue
    const overdueHabit = makeTask(0, 0, "Stretch", {
      recur: { freq: "weekly", interval: 1, weekdays: [1], anchor: at("2026-10-05") },
      log: [at("2026-10-05")],
    });
    const okHabit = makeTask(0, 0, "Read", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-10-15") },
      log: [NOW],
    });
    const doneTask = makeTask(0, 0, "Finished late", {
      status: "done",
      dueDate: at("2026-10-10"),
      completedAt: at("2026-10-12"),
    });
    const doc = docWith(untimed, timed, dueHabit, overdueHabit, okHabit, doneTask);

    const md = docToMarkdown(doc, { range: "last7" }, NOW);
    expect(md).toContain("### 10月15日–10月21日超时的工作");
    expect(md).toContain("- Late report【任务】 — 截止: Oct 19 2026");
    expect(md).toContain("- Timed deadline【任务】 — 截止: Oct 21 2026 9:00");
    expect(md).toContain("- Meditate【习惯】 — 重复规则: 每天");
    expect(md).toContain("- Stretch【习惯】 — 重复规则: 每周(周一)");
    // a habit logged today asks nothing; a done task's past due date is history
    expect(md).not.toContain("Read【习惯】");
    expect(md).not.toContain("Finished late");
  });

  it("honors a custom range and clamps a future end to now", () => {
    const inR = makeGoal(0, 0, "In range win", { completedAt: at("2026-10-19") });
    const outR = makeGoal(0, 0, "Before range win", { completedAt: at("2026-10-16") });
    const futureDue = makeTask(0, 0, "Due later", { dueDate: at("2026-10-23") });
    const doc = docWith(inR, outR, futureDue);

    const md = docToMarkdown(doc, { startMs: at("2026-10-18"), endMs: at("2026-10-25") }, NOW);
    // the end clamps to now: the header stops at today, and a task due
    // between now and endMs is not overdue
    expect(md).toContain("范围: Oct 18 2026 – Oct 21 2026");
    expect(md).toContain("### 10月18日–10月21日完成的工作");
    expect(md).toContain("【目标-In range win-已完成】");
    expect(md).not.toContain("Before range win");
    expect(md).not.toContain("Due later");
  });

  it("labels a today-only range 今天, a single other day by date", () => {
    const today = docToMarkdown(emptyDoc(), { startMs: dayStart(NOW), endMs: NOW }, NOW);
    expect(today).toContain("### 今天完成的工作");
    const oneDay = docToMarkdown(
      emptyDoc(),
      { startMs: dayStart(at("2026-10-20")), endMs: at("2026-10-20") },
      NOW,
    );
    expect(oneDay).toContain("### 10月20日完成的工作");
  });

  it("lists records and creations chronologically in 事件汇总, (无) when empty", () => {
    const rec = makeRecordNode(0, 0, "Called grandma", "she is well", at("2026-10-20"));
    rec.durationMs = 65 * 60000;
    const task = makeTask(0, 0, "New task", { createdAt: at("2026-10-18") });
    const goal = makeGoal(0, 0, "New goal", { createdAt: at("2026-10-16") });
    const old = makeRecordNode(0, 0, "Ancient", "", at("2026-10-01"));
    const doc = docWith(rec, task, goal, old);

    const md = docToMarkdown(doc, { range: "last7" }, NOW);
    expect(md).toContain("### 事件汇总");
    expect(md).toContain("- Oct 16 2026: 【目标】New goal");
    expect(md).toContain("- Oct 18 2026: 【任务】New task");
    expect(md).toContain("- Oct 20 2026: 【记录】Called grandma — she is well (1h 5m)");
    expect(md.indexOf("New goal")).toBeLessThan(md.indexOf("New task"));
    expect(md.indexOf("New task")).toBeLessThan(md.indexOf("Called grandma"));
    expect(md).not.toContain("Ancient");

    const empty = docToMarkdown(emptyDoc(), { range: "last7" }, NOW);
    expect(empty).toContain("### 10月15日–10月21日完成的工作\n\n(无)");
    expect(empty).toContain("### 10月15日–10月21日超时的工作\n\n(无)");
    expect(empty).toContain("### 事件汇总\n\n(无)");
  });
});

describe("subgraphToMarkdown", () => {
  it("renders the template: preamble, numbered paths with (当前), details with note and linked records", () => {
    const life = makeGoal(0, 0, "Life", { description: "照顾好自己" });
    const health = makeGoal(0, 0, "Health", { description: "身体是一切的基础" });
    const root = makeGoal(0, 0, "Run 500km", {
      targetDate: at("2026-12-31"),
      startedAt: at("2026-03-01"),
      description: "get fit",
    });
    root.notes.push(
      { id: "n1", text: "膝盖有点疼,减量一周", createdAt: at("2026-10-12"), updatedAt: at("2026-10-12") },
      { id: "n2", text: "恢复良好", createdAt: at("2026-10-18"), updatedAt: at("2026-10-18") },
    );
    const habit = makeTask(0, 0, "Morning run", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-10-19") },
      log: [at("2026-10-19"), at("2026-10-20"), NOW],
    });
    const older = makeRecordNode(0, 0, "First 5k", "很轻松", at("2026-10-10"));
    const rec = makeRecordNode(0, 0, "Knee pain", "left knee", at("2026-10-14"));
    rec.durationMs = 45 * 60000;
    const doc = docWith(life, health, root, habit, older, rec);
    connect(doc, life.id, health.id);
    connect(doc, health.id, root.id);
    connect(doc, root.id, habit.id);
    connect(doc, root.id, rec.id);
    connect(doc, root.id, older.id);

    const md = subgraphToMarkdown(doc, root.id, NOW);
    expect(md).toContain("# 导出: Run 500km");
    expect(md).toMatch(/导出于: Oct 21 2026 \(GMT[+-]/);
    expect(md).toContain("## 内容格式描述");

    // 完整路径: numbered 【类型-标题-描述-状态】 entries, (当前) on the root
    expect(md).toContain("## 完整路径");
    expect(md).toContain("### 路径 1");
    expect(md).toContain("1.【目标-Life-照顾好自己-未开始】");
    expect(md).toContain("2.【目标-Health-身体是一切的基础-未开始】");
    expect(md).toContain("3.【目标-Run 500km-get fit-未开始】(当前)");

    // 当前节点的详细信息
    expect(md).toContain("## 当前节点的详细信息");
    expect(md).toContain("### 当前节点: Run 500km");
    expect(md).toContain("#### 基本信息");
    expect(md).toContain("- 类型: 目标");
    expect(md).toContain("- 状态: 未开始");
    expect(md).toContain("- 目标日期: Dec 31 2026 · 开始: Mar 01 2026");
    expect(md).toContain("- 描述: get fit");
    expect(md).toContain("- 专注时长: 45m");

    // note: numbered, every note, creation date prefixed
    expect(md).toContain("#### note");
    expect(md).toContain("1. (Oct 12 2026) 膝盖有点疼,减量一周");
    expect(md).toContain("2. (Oct 18 2026) 恢复良好");

    // 关联的记录: directly linked records only (the habit is not one),
    // time ascending, full history
    expect(md).toContain("#### 关联的记录 (按照时间排序)");
    expect(md).toContain("1. Oct 10 2026 12:00:00: First 5k — 很轻松");
    expect(md).toContain("2. Oct 14 2026 12:00:00: Knee pain — left knee (45m)");
    expect(md.indexOf("First 5k")).toBeLessThan(md.indexOf("Knee pain"));
    const recordsSection = md.slice(md.indexOf("#### 关联的记录"), md.indexOf("#### 后继节点"));
    expect(recordsSection).not.toContain("Morning run");

    // 后继节点: the direct non-record successors
    expect(md).toContain("#### 后继节点");
    expect(md).toContain("1.【任务-Morning run-已完成】");
  });

  it("numbers each path separately when the node sits on several (DAG)", () => {
    const a = makeGoal(0, 0, "Life");
    const b = makeGoal(0, 0, "Work");
    const root = makeTask(0, 0, "Stretch");
    const doc = docWith(a, b, root);
    connect(doc, a.id, root.id);
    connect(doc, b.id, root.id);

    const md = subgraphToMarkdown(doc, root.id, NOW);
    expect(md.match(/### 路径 /g)?.length).toBe(2);
    // tasks have no description — the segment is dropped, not filled with 无
    expect(md).toContain("【任务-Stretch-未开始】(当前)");
    expect(md).toContain("1.【目标-Life-未开始】");
    expect(md).toContain("1.【目标-Work-未开始】");
    expect(md).not.toContain("-无-");
  });

  it("omits records from paths: a record parent ends the branch but stays a linked record", () => {
    const rec = makeRecordNode(0, 0, "Race day", "finished 10k", at("2026-10-01"));
    const root = makeGoal(0, 0, "Run 500km");
    const doc = docWith(rec, root);
    connect(doc, rec.id, root.id);

    const md = subgraphToMarkdown(doc, root.id, NOW);
    const pathSection = md.slice(md.indexOf("## 完整路径"), md.indexOf("## 当前节点的详细信息"));
    expect(pathSection).toContain("(当前节点是顶层节点,无上游路径)");
    expect(pathSection).not.toContain("Race day");
    // ...and it shows up in 关联的记录
    expect(md).toContain("1. Oct 01 2026 12:00:00: Race day — finished 10k");
  });

  it("passes synthetic midpoints through to the real successors and linked records", () => {
    const root = makeGoal(0, 0, "Root");
    const mid = makeTask(0, 0, "", { synthetic: true });
    const rec = makeRecordNode(0, 0, "Real record", "reached through", at("2026-10-05"));
    const child = makeTask(0, 0, "Real child");
    const doc = docWith(root, mid, rec, child);
    connect(doc, root.id, mid.id);
    connect(doc, mid.id, rec.id);
    connect(doc, mid.id, child.id);

    const md = subgraphToMarkdown(doc, root.id, NOW);
    const succ = md.slice(md.indexOf("#### 后继节点"));
    expect(succ.match(/【/g)?.length).toBe(1); // only the real child, the untitled midpoint adds no entry
    expect(md).toContain("1. Oct 05 2026 12:00:00: Real record — reached through");
    expect(succ).toContain("1.【任务-Real child-未开始】");
  });

  it("renders the empty states for a solitary node", () => {
    expect(subgraphToMarkdown(emptyDoc(), "gone", NOW)).toBe(""); // unknown id
    const solo = makeGoal(0, 0, "Alone");
    const md = subgraphToMarkdown(docWith(solo), solo.id, NOW);
    expect(md).toContain("(当前节点是顶层节点,无上游路径)");
    expect(md).toContain("#### note\n\n(无)");
    expect(md).toContain("#### 关联的记录 (按照时间排序)\n\n(无)");
    expect(md).toContain("#### 后继节点\n\n(无)");
    // no description — the line is dropped, never filled with 无
    expect(md).not.toContain("- 描述:");
  });

  it("renders a habit's rule and counts in 基本信息", () => {
    const habit = makeTask(0, 0, "Morning run", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-10-19") },
      log: [at("2026-10-19"), at("2026-10-20"), NOW],
    });
    const md = subgraphToMarkdown(docWith(habit), habit.id, NOW);
    expect(md).toContain("- 类型: 习惯");
    expect(md).toContain("- 重复规则: 每天");
    expect(md).toContain("- 打卡: 共 3 次 · 当前连续 3 次");
  });

  it("lists the full downstream closure in 后继节点, not just direct children", () => {
    const root = makeGoal(0, 0, "Root");
    const child = makeTask(0, 0, "Child");
    const grand = makeTask(0, 0, "Grandchild");
    const leaf = makeGoal(0, 0, "Leaf goal");
    const doc = docWith(root, child, grand, leaf);
    connect(doc, root.id, child.id);
    connect(doc, child.id, grand.id);
    connect(doc, grand.id, leaf.id);

    const md = subgraphToMarkdown(doc, root.id, NOW);
    const succ = md.slice(md.indexOf("#### 后继节点"));
    expect(succ).toContain("1.【任务-Child-未开始】");
    expect(succ).toContain("2.【任务-Grandchild-未开始】");
    expect(succ).toContain("3.【目标-Leaf goal-未开始】");
  });

  it("lists a RENAMED synthetic midpoint as content, passes untitled ones through", () => {
    const root = makeGoal(0, 0, "Root");
    const named = makeTask(0, 0, "Spread to zoom into a road", { synthetic: true });
    const plain = makeTask(0, 0, "", { synthetic: true });
    const leaf = makeTask(0, 0, "Leaf");
    const doc = docWith(root, named, plain, leaf);
    connect(doc, root.id, named.id);
    connect(doc, named.id, plain.id);
    connect(doc, plain.id, leaf.id);

    const md = subgraphToMarkdown(doc, root.id, NOW);
    const succ = md.slice(md.indexOf("#### 后继节点"));
    expect(succ).toContain("1.【任务-Spread to zoom into a road-未开始】");
    expect(succ).toContain("2.【任务-Leaf-未开始】");
    expect(succ.match(/【/g)?.length).toBe(2); // the untitled midpoint adds no entry
  });
});
