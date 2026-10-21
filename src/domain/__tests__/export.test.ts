import { describe, expect, it } from "@jest/globals";

import { emptyDoc, Id, LifeMapDoc, makeEdgeData, makeGoal, makeRecordNode, makeTask, NodeData } from "../doc";
import { docToMarkdown, subgraphToMarkdown } from "../export";

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
  function periodDoc(): { doc: LifeMapDoc; habit: NodeData } {
    const habit = makeTask(0, 0, "Morning run", {
      recur: { freq: "daily", interval: 1, anchor: at("2026-10-15") },
      log: [at("2026-10-19"), NOW],
    });
    const goal = makeGoal(0, 0, "Run 500km", { targetDate: at("2026-12-31") });
    const rec = makeRecordNode(0, 0, "Called grandma", "she is well", at("2026-10-20"));
    const focus = makeRecordNode(0, 0, "Deep work", "", at("2026-10-20"));
    focus.durationMs = 65 * 60000;
    return { doc: docWith(habit, goal, rec, focus), habit };
  }

  it("renders the header, summary and daily log for a range", () => {
    const { doc } = periodDoc();
    const md = docToMarkdown(doc, { range: "last7" }, NOW);
    expect(md).toContain("# Life Map Export");
    expect(md).toContain(`Range: Oct 15 2026 – Oct 21 2026`);
    expect(md).toMatch(/Exported: Oct 21 2026 \(GMT[+-]/);
    expect(md).toContain("- 1 active goal (0 completed this period)");
    expect(md).toContain("- 1 habit · avg streak 1");
    expect(md).toContain("- Total focus: 1h 5m across 1 session");
    expect(md).toContain("- Run 500km (goal, todo · target Dec 31 2026)");
    expect(md).toContain("- Morning run (habit — Every day): 2 logged, streak 1");
    // daily log: logged yesterday-and-today, missed the unlogged days
    expect(md).toContain("### Oct 19 2026");
    expect(md).toContain("- ✔ Morning run (logged)");
    expect(md).toContain("- ✗ Morning run (missed)");
    expect(md).toContain('Record · Called grandma at 12:00:00: "she is well"');
    expect(md).toContain('Focus · 1h 5m at 12:00:00 — "Deep work"');
    // future scheduled occurrences are noise and never exported
    expect(md).not.toContain("Scheduled");
  });

  it("scopes the range: last7 drops older days, all reaches back", () => {
    const old = makeRecordNode(0, 0, "Ancient", "", at("2026-10-01"));
    const { doc } = periodDoc();
    doc.nodes[old.id] = old;
    expect(docToMarkdown(doc, { range: "last7" }, NOW)).not.toContain("Ancient");
    const all = docToMarkdown(doc, { range: "all" }, NOW);
    expect(all).toContain("Range: Oct 01 2026 – Oct 21 2026");
    expect(all).toContain("Record · Ancient");
  });

  it("exports record times down to the second (issue #45)", () => {
    const precise = new Date("2026-10-20T12:34:56").getTime();
    const rec = makeRecordNode(0, 0, "Called grandma", "", precise);
    const doc = docWith(rec);
    expect(docToMarkdown(doc, { range: "all" }, NOW)).toContain("Record · Called grandma at 12:34:56");
    expect(subgraphToMarkdown(doc, rec.id, NOW)).toContain("- 发生时间: Oct 20 2026 12:34:56");
  });

  it("says so when the period holds nothing", () => {
    const md = docToMarkdown(emptyDoc(), { range: "last7" }, NOW);
    expect(md).toContain("(nothing logged in this period)");
    expect(md).toContain("- (none)");
  });

  it("marks a goal completed inside the period", () => {
    const goal = makeGoal(0, 0, "Ship v1", { completedAt: at("2026-10-20") });
    const md = docToMarkdown(docWith(goal), { range: "last7" }, NOW);
    expect(md).toContain("0 active goals (1 completed this period)");
    expect(md).toContain("- Ship v1 (goal, done)");
    expect(md).toContain("- ✔ Ship v1 (completed)");
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
