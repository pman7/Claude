import { test } from "node:test";
import assert from "node:assert/strict";
import { ridge, passes, pathLength, profile, clampStep, readoutOf, TOOLS } from "./model.mjs";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("ridge height matches the scallop formula", () => {
  near(ridge(1.0, 0.1) * 1000, 2.5, 0.01);
  near(ridge(1.0, 0.05) * 1000, 0.63, 0.01);
  near(ridge(2.0, 0.3) * 1000, 11.3, 0.05);
});

test("profile peaks at half a stepover and is zero on a pass", () => {
  near(profile(1, 0.1, 0), 0, 1e-12);
  near(profile(1, 0.1, 0.05), ridge(1, 0.1), 1e-12);
  near(profile(1, 0.1, 0.35), profile(1, 0.1, 0.05), 1e-12);
});

test("pass count and path over the 8 mm patch", () => {
  assert.equal(passes(0.1), 80);
  assert.equal(pathLength(0.1), 640);
  assert.equal(passes(0.3), 27);
});

test("stepover stays inside each tool's range", () => {
  assert.equal(clampStep(1, 0.5), TOOLS[1].step[1]);
  assert.equal(clampStep(2, 0.01), TOOLS[2].step[0]);
  for (const tool of [1, 2]) assert.ok(TOOLS[tool].step[1] < TOOLS[tool].d / 2);
});

test("readout", () => {
  assert.equal(readoutOf(1, 0.1), "Ø1.0 ball · step 0.10 mm · ridge 2.5 µm · 80 passes");
});
