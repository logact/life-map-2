import { describe, expect, it } from "@jest/globals";

import { buildEnvelope, decideSync, parseEnvelope } from "@/data/syncPolicy";
import { emptyDoc, makeGoal } from "@/domain/doc";

function sampleDoc() {
  const doc = emptyDoc();
  const node = makeGoal(1, 2, "G");
  doc.nodes[node.id] = node;
  doc.rootNodeIds.push(node.id);
  return doc;
}

describe("parseEnvelope", () => {
  it("round-trips a built envelope", () => {
    const doc = sampleDoc();
    const envelope = buildEnvelope(doc, "device-1", 1728000000000);
    const parsed = parseEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(parsed).toEqual(envelope);
    expect(parsed?.doc).toEqual(doc);
  });

  it("rejects non-objects, wrong format, and missing fields", () => {
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope("json")).toBeNull();
    expect(parseEnvelope({ format: 2, savedAt: 1, deviceId: "d", doc: sampleDoc() })).toBeNull();
    expect(parseEnvelope({ format: 1, deviceId: "d", doc: sampleDoc() })).toBeNull();
    expect(parseEnvelope({ format: 1, savedAt: Number.NaN, deviceId: "d", doc: sampleDoc() })).toBeNull();
    expect(parseEnvelope({ format: 1, savedAt: 1, deviceId: "", doc: sampleDoc() })).toBeNull();
  });

  it("rejects a doc that is not structurally a LifeMapDoc", () => {
    expect(parseEnvelope({ format: 1, savedAt: 1, deviceId: "d", doc: null })).toBeNull();
    expect(parseEnvelope({ format: 1, savedAt: 1, deviceId: "d", doc: { edges: {} } })).toBeNull();
    expect(
      parseEnvelope({ format: 1, savedAt: 1, deviceId: "d", doc: { nodes: {}, edges: {} } }),
    ).toBeNull();
  });
});

describe("decideSync", () => {
  const remote = buildEnvelope(sampleDoc(), "device-2", 1000);

  it("pushes when there is no remote snapshot yet", () => {
    expect(decideSync(500, null)).toBe("push");
    expect(decideSync(null, null)).toBe("push");
  });

  it("pulls when the remote is newer than local", () => {
    expect(decideSync(999, remote)).toBe("pull");
    // a fresh install has no local timestamp: any remote wins
    expect(decideSync(null, remote)).toBe("pull");
  });

  it("pushes when local is newer than the remote", () => {
    expect(decideSync(1001, remote)).toBe("push");
  });

  it("does nothing when both sides carry the same timestamp", () => {
    expect(decideSync(1000, remote)).toBe("none");
  });
});
