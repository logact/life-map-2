import { describe, expect, it } from "@jest/globals";

import { NODE_SIZE, RECORD_SIZE, TASK_SIZE } from "../constants";
import { rimOffset } from "../utils";

// rimOffset keeps the edge trim glued to the rendered rim: pins cap at
// natural size on screen past 1x zoom (nodeGlyph), so the world-space
// trim must shrink with the camera. A flat nodeSize/2 overshoots by the
// zoom factor — at 6x it eats a whole edge, leaving a floating arrowhead
describe("rimOffset", () => {
  it("equals the plain world radius at and below 1x zoom", () => {
    expect(rimOffset("task", 1)).toBe(TASK_SIZE / 2);
    expect(rimOffset("task", 0.25)).toBe(TASK_SIZE / 2);
    expect(rimOffset("goal", 0.5)).toBe(NODE_SIZE / 2);
  });

  it("shrinks with the camera past 1x so the screen-space trim stays natural", () => {
    // rendered rim on screen is rimOffset * scale and must stay nodeSize/2
    expect(rimOffset("task", 4) * 4).toBe(TASK_SIZE / 2);
    expect(rimOffset("goal", 6) * 6).toBe(NODE_SIZE / 2);
    expect(rimOffset("record", 2) * 2).toBe(RECORD_SIZE / 2);
  });
});
