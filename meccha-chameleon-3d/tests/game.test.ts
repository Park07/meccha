import { test } from "node:test";
import assert from "node:assert/strict";
import { segAABB, isExposed, type AABB } from "shared";

const box: AABB = { minX: -1, maxX: 1, minZ: 2, maxZ: 3 };

test("segAABB detects a crossing segment", () => {
  assert.equal(segAABB(0, 0, 0, 5, box), true);   // straight through
  assert.equal(segAABB(5, 0, 5, 5, box), false);  // off to the side
});

test("isExposed: clear line of sight inside the cone", () => {
  // hunter at origin looking +z (aim 0), hider 6m ahead, no occluders
  assert.equal(isExposed(0, 0, 0, 0, 6, []), true);
});

test("isExposed: target behind the hunter is not seen", () => {
  assert.equal(isExposed(0, 0, 0, 0, -6, []), false);
});

test("isExposed: target out of range is not seen", () => {
  assert.equal(isExposed(0, 0, 0, 0, 30, []), false);
});

test("isExposed: occluder between hunter and hider blocks sight", () => {
  assert.equal(isExposed(0, 0, 0, 0, 6, [box]), false); // box spans z2..3 at x0
});
