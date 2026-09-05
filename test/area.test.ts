import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pointInBox, toBox } from "../sapi/src/types.ts";

describe("area AABB", () => {
  it("pointInBox 含边界", () => {
    const box = toBox([-10, -10], [10, 10]);
    assert.equal(pointInBox(0, 0, box), true);
    assert.equal(pointInBox(-10, 10, box), true);
    assert.equal(pointInBox(-11, 0, box), false);
  });

  it("对角顶点无序仍正确", () => {
    const box = toBox([10, 10], [-10, -10]);
    assert.equal(pointInBox(0, 0, box), true);
  });
});
