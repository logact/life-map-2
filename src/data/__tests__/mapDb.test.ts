import { describe, expect, it } from "@jest/globals";

import { docToRows, rowsToDoc } from "@/data/mapDb";
import { emptyDoc, makeGoal } from "@/domain/doc";

describe("mapDb tag persistence", () => {
  it("docToRows/rowsToDoc round-trips the registry and per-node tagIds", () => {
    const doc = emptyDoc();
    const node = makeGoal(1, 2, "G", { tagIds: ["t1", "t2"] });
    doc.nodes[node.id] = node;
    doc.rootNodeIds.push(node.id);
    doc.tags = {
      t1: { id: "t1", name: "Health", color: "#E69F00" },
      t2: { id: "t2", name: "English", color: "#56B4E9" },
    };
    const rows = docToRows(doc);
    expect(rows.tags).toHaveLength(2);
    expect(JSON.parse(rows.nodes[0].data).tagIds).toEqual(["t1", "t2"]);
    expect(rowsToDoc(rows.nodes, rows.notes, rows.edges, rows.tags)).toEqual(doc);
  });

  it("a row whose blob lacks tagIds parses to undefined (pre-tags data)", () => {
    const doc = emptyDoc();
    const node = makeGoal(1, 2, "G");
    doc.nodes[node.id] = node;
    doc.rootNodeIds.push(node.id);
    const rows = docToRows(doc);
    expect(rows.nodes[0].data).not.toContain("tagIds");
    // old databases also have no tags table rows at all
    const parsed = rowsToDoc(rows.nodes, rows.notes, rows.edges);
    expect(parsed.nodes[node.id].tagIds).toBeUndefined();
    expect(parsed.tags).toEqual({});
    expect(parsed.schemaVersion).toBe(3);
  });
});
