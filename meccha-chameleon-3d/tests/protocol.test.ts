import { test } from "node:test";
import assert from "node:assert/strict";
import { packColor, unpackColor, hexToColor, colorToHex, pushOutCircle } from "shared";

test("packColor/unpackColor round-trips", () => {
  for (const rgb of [[0, 0, 0], [255, 255, 255], [255, 90, 71], [54, 214, 198]] as const) {
    assert.deepEqual(unpackColor(packColor(rgb[0], rgb[1], rgb[2])), [...rgb]);
  }
});

test("hex <-> int round-trips", () => {
  assert.equal(colorToHex(hexToColor("#ff5a47")), "#ff5a47");
  assert.equal(hexToColor("#000000"), 0);
});

test("pushOutCircle leaves a circle clear of the box unchanged", () => {
  assert.deepEqual(pushOutCircle(5, 5, 0.5, -1, -1, 1, 1), [5, 5]);
});

test("pushOutCircle pushes a penetrating circle out along the face normal", () => {
  const [x, z] = pushOutCircle(1.2, 0, 0.5, -1, -1, 1, 1); // closest pt (1,0)
  assert.ok(Math.abs(x - 1.5) < 1e-9 && Math.abs(z) < 1e-9, `got ${x},${z}`);
});

test("pushOutCircle resolves corner penetration to exactly radius", () => {
  const [x, z] = pushOutCircle(1.1, 1.1, 0.5, -1, -1, 1, 1); // corner (1,1)
  assert.ok(Math.abs(Math.hypot(x - 1, z - 1) - 0.5) < 1e-9, `dist ${Math.hypot(x - 1, z - 1)}`);
});
