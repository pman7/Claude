import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC, TRAVEL, GEO, HOME, Y_DISC, X_DISC, magOf, zLimit, tourAt, tourStepStart, TOUR_LEN, readoutOf, wrap } from "./model.mjs";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const roomOf = (s) => zLimit({ x: s.x, b: s.b, a: s.a, mag: magOf(s.m).mag }, s.y);
const tour = [];
for (let t = 0; t < TOUR_LEN; t += 0.01) tour.push(tourAt(t));

test("specs match ARUM's 5X-200 page", () => {
  assert.deepEqual(SPEC, { aRange: 360, bLimit: 30, tools: 15, shank: 6, rpm: 60000, kw: 3.0, disc: 98.5, premills: 5 });
});

test("home puts the bur over the disc centre, inside the travel, with room to come down", () => {
  assert.equal(Y_DISC, -GEO.SPINDLE_X0);
  assert.equal(X_DISC, GEO.SPINDLE_Y);
  for (const key of ["x", "y", "z"]) assert.ok(HOME[key] >= 0 && HOME[key] <= TRAVEL[key], key);
  assert.ok(roomOf({ ...HOME, m: 1 }) > 50);
});

test("the magazine slides in over the open flap, then the flap swings shut", () => {
  assert.deepEqual(magOf(0), { mag: 0, flap: 0 });
  assert.deepEqual(magOf(1), { mag: GEO.MAG_STROKE, flap: 90 });
  let last = magOf(0);
  for (let m = 0.01; m <= 1.0001; m += 0.01) {
    const now = magOf(m);
    assert.ok(now.mag >= last.mag && now.flap >= last.flap, `m ${m}`);
    if (now.flap > 0) near(now.mag, GEO.MAG_STROKE, 1e-9);
    last = now;
  }
});

test("the tour never brings the head into anything", () => {
  for (const s of tour) {
    const room = roomOf(s);
    assert.ok(room >= 0 && s.z <= room + 1e-9, `${readoutOf(s)} room ${room}`);
  }
});

test("the tour reaches each axis's ends and changes a tool with the magazine out", () => {
  const min = (key) => Math.min(...tour.map((s) => s[key]));
  const max = (key) => Math.max(...tour.map((s) => s[key]));
  near(min("x"), 0, 0.01);
  near(max("x"), TRAVEL.x, 0.01);
  near(min("y"), 0, 0.01);
  near(min("b"), -SPEC.bLimit, 0.01);
  near(max("b"), SPEC.bLimit, 0.01);
  // A: the holder's turn, unwrapped across its step, is a full turn
  const turning = tour.filter((s) => s.axis === "A");
  const turned = turning.slice(1).reduce((sum, s, i) => sum + wrap(s.a - turning[i].a), 0);
  near(Math.abs(turned), SPEC.aRange, 2);
  const atTools = tour.filter((s) => s.say === "Z: down to the tools");
  assert.ok(atTools.length > 0 && atTools.every((s) => s.y === 0 && s.m === 0));
  assert.ok(Math.max(...atTools.map((s) => s.z)) > 30);
});

test("the tour starts at home and loops without a jump", () => {
  const first = tourAt(0);
  const last = tourAt(TOUR_LEN - 1e-6);
  for (const key of ["x", "y", "z", "b", "m"]) {
    near(first[key], { ...HOME, m: 1 }[key], 1e-9);
    near(last[key], first[key], 1e-6);
  }
  near(wrap(last.a - first.a), 0, 1e-6);
});

test("a paused tour resumes from the start of its step", () => {
  assert.equal(tourStepStart(0), 0);
  assert.equal(tourStepStart(1), 0);
  near(tourStepStart(2.3), 2.2, 1e-9);
  near(tourStepStart(TOUR_LEN + 2.3), 2.2, 1e-9);
});

test("readout", () => {
  assert.equal(readoutOf({ ...HOME, z: 12.34, a: -180 }), "X 55.0 · Y 225.0 · Z −12.3 · A 180.0° · B 0.0°");
});
