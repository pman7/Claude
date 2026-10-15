import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC, TRAVEL, GEO, HOME, Y_DISC, X_DISC, BRIDGE, OUTLINE, OPENING, TEETH, CHANNELS, CONNECTORS, magOf, zLimit, upperRoom, axesFor, tipIn, toWorld, bodiesOf, simAt, simPassStart, SIM_LEN, SIM_SPANS, readoutOf, wrap } from "./model.mjs";
import { workShapes } from "./work.mjs";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const deg = (r) => (r * 180) / Math.PI;
const job = [];
for (let t = 0; t <= SIM_LEN + 1e-9; t += 0.01) job.push({ t, s: simAt(t) });
// distance from a point to a closed polygon's boundary, and whether it is inside
const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]; const [xj, yj] = poly[j]; if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const edgeDist = (p, poly) => { let best = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; const ex = b[0] - a[0]; const ey = b[1] - a[1]; const l2 = ex * ex + ey * ey || 1; const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)); best = Math.min(best, Math.hypot(p[0] - a[0] - k * ex, p[1] - a[1] - k * ey)); } return best; };
// the finishing bur's radius at a height h above its tip (as drawn: Ø1.0 ball, a neck widening to Ø1.8 at 20 mm)
const neck = (h) => (h < 2 ? 0.55 : h < 20 ? 0.55 + ((h - 2) * 0.35) / 18 : 0.9 + ((h - 20) * 2.1) / 3.5);
const level = (s, z) => { const { p, t } = tipIn(s); const k = (z - p[2]) / t[2]; return { q: [p[0] + k * t[0], p[1] + k * t[1]], h: k }; };

test("specs match ARUM's 5X-200 page", () => {
  assert.deepEqual(SPEC, { aRange: 360, bLimit: 30, tools: 15, shank: 6, rpm: 60000, kw: 3.0, disc: 98.5, premills: 5 });
});

test("home puts the bur over the disc centre, inside the travel, with room to come down", () => {
  assert.equal(Y_DISC, -GEO.SPINDLE_X0);
  assert.equal(X_DISC, GEO.SPINDLE_Y);
  for (const key of ["x", "y", "z"]) assert.ok(HOME[key] >= 0 && HOME[key] <= TRAVEL[key], key);
  assert.ok(zLimit({ ...HOME, mag: magOf(1).mag }, HOME.y) > 50);
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

test("the axes put the tip where asked, with the tool upright in the machine", () => {
  for (let i = 0; i < 400; i++) {
    const th = (i % 20) * 0.025;
    const ph = i * 0.7;
    const t = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const p = [((i * 37) % 80) - 40, ((i * 53) % 80) - 40, 12.5 - (i % 25)];
    const s = axesFor(p, t);
    const back = tipIn(s);
    for (let k = 0; k < 3; k++) { near(back.p[k], p[k], 1e-9); near(back.t[k], t[k], 1e-9); }
    const w = toWorld(s, p);
    near(w[0], GEO.SPINDLE_X0 + s.y, 1e-9);
    near(w[1], GEO.SPINDLE_Y, 1e-9);
    near(w[2], GEO.TIP_Z - s.z, 1e-9);
  }
});

test("the collision model turns the holder exactly as the kinematics do", () => {
  for (let i = 0; i < 50; i++) {
    const pose = { x: (i * 7) % 140, a: ((i * 47) % 360) - 180, b: ((i * 13) % 60) - 30, mag: 0 };
    const plate = bodiesOf(pose)[9];
    const H = GEO.HALF;
    const T = GEO.THICK;
    const want = [];
    for (const x of [-H, H]) for (const y of [-H, H]) for (const z of [-T, T]) want.push(toWorld(pose, [x, y, z]));
    for (let k = 0; k < 8; k++) for (let j = 0; j < 3; j++) near(plate.corners[k][j], want[k][j], 1e-9);
  }
});

test("the bridge fits the disc: a maxillary twelve-unit arch inside the clamp ring, milled 20% large", () => {
  assert.equal(TEETH.length, 12);
  const r = Math.max(...OPENING.pts.map((p) => Math.hypot(...p)));
  assert.ok(r <= 45.5 - 1, `channel reaches r ${r}`);
  // intermolar width (first-molar centres) as sintered, about 48-50 mm in adults
  const molars = TEETH.filter((t) => t.name === "first molar");
  const cx = (t) => t.outline.reduce((a, p) => a + p[0], 0) / t.outline.length;
  const inter = Math.abs(cx(molars[0]) - cx(molars[1])) / BRIDGE.ef;
  assert.ok(inter > 45 && inter < 52, `intermolar ${inter}`);
  // milled height within a 25 mm disc
  assert.ok(BRIDGE.base - BRIDGE.top > 18 && BRIDGE.base < 2 * GEO.THICK);
  assert.equal(CHANNELS.length, 4);
  assert.ok(CONNECTORS.length >= 10 && CONNECTORS.length <= 14);
  // the bridge's outline stays inside the channel's
  for (const p of OUTLINE.pts) assert.ok(inside(p, OPENING.pts), `outline point ${p} outside the channel`);
});

test("the job stays in the machine's travel and B's ±30°", () => {
  for (const { t, s } of job) {
    assert.ok(s.x >= -1e-9 && s.x <= TRAVEL.x + 1e-9, `X ${s.x} at ${t}`);
    assert.ok(s.y >= -1e-9 && s.y <= TRAVEL.y + 1e-9, `Y ${s.y} at ${t}`);
    assert.ok(s.z >= -1e-9 && s.z <= TRAVEL.z + 1e-9, `Z ${s.z} at ${t}`);
    assert.ok(Math.abs(s.b) <= SPEC.bLimit + 1e-9, `B ${s.b} at ${t}`);
  }
});

test("the head above the bur clears the cradle, holder and disc everywhere in the job, even between samples", () => {
  let tightest = Infinity;
  for (let t = 0; t <= SIM_LEN; t += 0.002) { const s = simAt(t); tightest = Math.min(tightest, upperRoom(s) - s.z); }
  assert.ok(tightest >= 2, `tightest ${tightest}`);
});

test("A and B share the lean through every pass, within hyperDENT's tilts", () => {
  for (const span of SIM_SPANS) {
    const cut = job.filter(({ s }) => s.cutting && s.kind === span.kind);
    assert.ok(cut.length > 100, span.kind);
    const range = (k) => Math.max(...cut.map(({ s }) => s[k])) - Math.min(...cut.map(({ s }) => s[k]));
    assert.ok(range("a") > 2 && range("b") > 2, `${span.kind}: A ${range("a")}, B ${range("b")}`);
    const tilts = cut.map(({ s }) => s.tilt);
    if (span.kind === "occlusal") { near(Math.max(...tilts), 3, 0.01); near(Math.min(...tilts), 3, 0.01); }
    else { assert.ok(Math.max(...tilts) <= 15 + 1e-9 && Math.max(...tilts) > 14.9, `${span.kind} max ${Math.max(...tilts)}`); assert.ok(Math.min(...tilts) >= 8, `${span.kind} min ${Math.min(...tilts)}`); }
  }
  // the lean eases only where the cradle's drive hub would meet the right nozzle: the buccal side, right-hand end
  const eased = job.filter(({ s }) => s.cutting && s.kind !== "occlusal" && s.tilt < 14.5);
  assert.ok(eased.length > 0 && eased.every(({ s }) => s.kind === "buccal" && tipIn(s).p[0] > 20));
});

test("the bur touches each surface it finishes, and its neck clears the channel and the bridge's edge", () => {
  for (const { t, s } of job) {
    if (!s.cutting) continue;
    const { p, t: axis } = tipIn(s);
    const ball = [p[0] + BRIDGE.ball * axis[0], p[1] + BRIDGE.ball * axis[1]];
    if (s.kind === "occlusal") {
      // over the bridge's top (or just past its ends, over the channel), between the cusp lines and the fossa
      assert.ok(inside(ball, OUTLINE.pts) || edgeDist(ball, OUTLINE.pts) < 1.3, `occlusal ball off the bridge at ${t}`);
      const depth = GEO.THICK - p[2];
      assert.ok(depth >= BRIDGE.top - 0.01 && depth <= BRIDGE.top + 1.25, `occlusal depth ${depth} at ${t}`);
      continue;
    }
    // walls: the ball's centre one radius outside the wall
    assert.ok(!inside(ball, OUTLINE.pts), `wall ball inside the bridge at ${t}`);
    near(edgeDist(ball, OUTLINE.pts), BRIDGE.ball, 0.12);
    // the neck at face B stays inside the channel, clear of its outer wall
    const face = level(s, GEO.THICK);
    assert.ok(inside(face.q, OPENING.pts) && edgeDist(face.q, OPENING.pts) >= neck(face.h) + 0.1, `neck at the channel's lip at ${t}`);
    // and at the bridge's top it stays off the bridge's edge
    const top = level(s, GEO.THICK - BRIDGE.top);
    assert.ok(!inside(top.q, OUTLINE.pts) && edgeDist(top.q, OUTLINE.pts) >= neck(top.h) - 1e-9, `neck on the bridge's edge at ${t}`);
  }
});

test("between passes the bur stays above the disc", () => {
  for (const { t, s } of job) {
    // only the dips into and out of each pass go below the clearance plane
    if (s.step === "cut" || s.step === "dip") continue;
    assert.ok(tipIn(s).p[2] >= GEO.THICK + 5.9, `tip ${tipIn(s).p[2]} at ${t} (${s.say})`);
  }
});

test("the machine moves smoothly: no jumps, and rapids within about 100 mm/s", () => {
  for (let i = 1; i < job.length; i++) {
    const a = job[i - 1].s;
    const b = job[i].s;
    for (const k of ["x", "y", "z"]) assert.ok(Math.abs(b[k] - a[k]) / 0.01 <= 100, `${k} at ${job[i].t}`);
    for (const k of ["a", "b"]) assert.ok(Math.abs(wrap(b[k] - a[k])) / 0.01 <= 180, `${k} at ${job[i].t}`);
  }
});

test("the job starts and ends at home, and finishes every surface in order", () => {
  for (const k of ["x", "y", "z", "a", "b"]) { near(simAt(0)[k], HOME[k], 1e-9); near(simAt(SIM_LEN)[k], HOME[k], 1e-9); }
  assert.deepEqual(simAt(0).done, { occlusal: 0, buccal: 0, palatal: 0 });
  assert.deepEqual(simAt(SIM_LEN).done, { occlusal: 1, buccal: 1, palatal: 1 });
  const order = SIM_SPANS.map((span) => span.kind);
  assert.deepEqual(order, ["occlusal", "buccal", "palatal"]);
  let last = { occlusal: 0, buccal: 0, palatal: 0 };
  for (const { s } of job) { for (const k of order) assert.ok(s.done[k] >= last[k] - 1e-12); last = s.done; }
});

test("a pass's start is where Page Up and resuming land; after the last pass, the job starts again", () => {
  assert.equal(simPassStart(0), 0);
  assert.equal(simPassStart(SIM_LEN), 0);
  for (const span of SIM_SPANS) { near(simPassStart(span.start + 0.5), span.start, 1e-9); near(simPassStart(span.end - 0.01), span.start, 1e-9); }
});

test("the disc drawing: only walls facing the viewer are swept, and the reveal runs with the occlusal pass", () => {
  const lit = (n) => n[0] < 0;
  const none = workShapes([0, 0], { occlusal: 0, buccal: 0, palatal: 0 }, lit);
  assert.equal(none.body.roughLit + none.body.roughShade + none.body.finLit + none.body.finShade, "");
  const start = workShapes([0.3, 1.2], { occlusal: 0, buccal: 0, palatal: 0 }, lit);
  const end = workShapes([0.3, 1.2], { occlusal: 1, buccal: 1, palatal: 1 }, lit);
  assert.ok(start.body.roughLit.length + start.body.roughShade.length > 0);
  assert.equal(start.body.finLit + start.body.finShade, "");
  assert.equal(end.body.roughLit + end.body.roughShade, "");
  assert.equal(end.bodySteps, "");
  assert.ok(start.reveal > 0);
  assert.equal(end.reveal, 0);
});

test("readout", () => {
  assert.equal(readoutOf({ ...HOME, z: 12.34, a: -180 }), "X 55.0 · Y 225.0 · Z −12.3 · A 180.0° · B 0.0°");
});
