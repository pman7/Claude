import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC, TRAVEL, GEO, HOME, Y_DISC, X_DISC, BRIDGE, OUTLINE, OPENING, TEETH, CHANNELS, CONNECTORS, CAP, ARCH_L, HEAD, burRadius, magOf, zLimit, upperRoom, axesFor, tipIn, toWorld, bodiesOf, WALL_REACH, archAt, bandOutline, roomAt, magFor, jogEnter, jogRequest, jogStep, simAt, simPassStart, SIM_LEN, SIM_SPANS, readoutOf, wrap } from "./model.mjs";
import { workShapes, burCut } from "./work.mjs";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const deg = (r) => (r * 180) / Math.PI;
const job = [];
for (let t = 0; t <= SIM_LEN + 1e-9; t += 0.01) job.push({ t, s: simAt(t) });
// distance from a point to a closed polygon's boundary, and whether it is inside
const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]; const [xj, yj] = poly[j]; if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const edgeDist = (p, poly) => { let best = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; const ex = b[0] - a[0]; const ey = b[1] - a[1]; const l2 = ex * ex + ey * ey || 1; const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)); best = Math.min(best, Math.hypot(p[0] - a[0] - k * ex, p[1] - a[1] - k * ey)); } return best; };
// the finishing bur's radius at a height h above its tip, as drawn (model.mjs BUR)
const neck = burRadius;
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
    const plate = bodiesOf(pose).find((body) => body.name === "holder.plate");
    const H = GEO.HALF;
    const T = GEO.THICK;
    const want = [];
    for (const x of [-H, H]) for (const y of [-H, H]) for (const z of [-T, T]) want.push(toWorld(pose, [x, y, z]));
    for (let k = 0; k < 8; k++) for (let j = 0; j < 3; j++) near(plate.corners[k][j], want[k][j], 1e-9);
  }
});

test("the cradle in the collision model tilts as the kinematics do", () => {
  for (let i = 0; i < 30; i++) {
    const pose = { x: (i * 11) % 140, a: 0, b: ((i * 17) % 60) - 30, mag: 0 };
    // the cradle's back wall rides B only
    const wall = bodiesOf(pose).find((body) => body.name === "cradle.wall");
    const [x0, x1, y0, y1, z0, z1] = [GEO.ARM_L[0], GEO.ARM_R[1], -GEO.WALL[1], -GEO.WALL[0], GEO.WALL_Z0, GEO.TOP];
    const want = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) want.push(toWorld(pose, [x, y, z]));
    for (let k = 0; k < 8; k++) for (let j = 0; j < 3; j++) near(wall.corners[k][j], want[k][j], 1e-9);
  }
});

// the drawn machine, as build.mjs puts it together (importing it builds the scene but writes nothing)
const scene = (async () => {
  const { T, follow, BUR_DRAWN } = await import("./build.mjs");
  const { TURN } = await import("../../../.claude/skills/anatomy/kit/turn.mjs");
  const groups = T.groups.map((g) => ({ name: g.name, parent: g.parent ? g.parent.index : -1, kind: g.kind, origin: g.origin, direction: g.direction, axis: g.axis }));
  // a point at rest carried by one group, with the machine in the given state, posed as the page poses it (follow())
  const carry = (state, name, p) => {
    const { R, t } = TURN.poses(groups, follow({ m: 1, ...state })).get(name);
    const o = groups.find((g) => g.name === name).origin;
    const q = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    return [0, 1, 2].map((r) => R[3 * r] * q[0] + R[3 * r + 1] * q[1] + R[3 * r + 2] * q[2] + t[r]);
  };
  return { T, carry, BUR_DRAWN };
})();
// points over a recorded shape's surface: a solid of revolution's profile turned round its axis, a prism's two ends
const add3 = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];
function surface(shape) {
  const out = [];
  const along = (a, b, f) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5)); for (let j = 0; j < n; j++) f(a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n); };
  const { F, poly } = shape;
  if (shape.kind === "body") {
    for (let i = 0; i < poly.length; i++) along(poly[i], poly[(i + 1) % poly.length], (s, r) => { for (let k = 0; k < 24; k++) { const th = (k / 24) * 2 * Math.PI; out.push(add3(add3(add3(F.o, F.a, s), F.u, r * Math.cos(th)), F.v, r * Math.sin(th))); } });
  } else if (shape.kind === "prism") {
    for (const s of [shape.s0, shape.s1]) for (let i = 0; i < poly.length; i++) along(poly[i], poly[(i + 1) % poly.length], (x, y) => out.push(add3(add3(add3(F.o, F.u, x), F.v, y), F.a, s)));
  } else throw new Error(`no surface for a ${shape.kind}`);
  return out;
}

test("the drawn machine moves as the kinematics do: the holder's points and the bur's tip land where the model puts them", async () => {
  const { T, carry, BUR_DRAWN } = await scene;
  const TIP = [GEO.SPINDLE_X0, GEO.SPINDLE_Y, GEO.TIP_Z];
  // the bur is drawn upright on the spindle's line, its tip at TIP and its profile the model's
  const F = T.parts.find((x) => x.name === "tool.bur").shapes[0].F;
  near(F.o[0], TIP[0], 1e-9);
  near(F.o[1], TIP[1], 1e-9);
  assert.deepEqual(F.a, [0, 0, 1]);
  assert.deepEqual(BUR_DRAWN[0], [GEO.TIP_Z, 0]);
  for (const [z, r] of BUR_DRAWN.slice(0, -1)) near(r, burRadius(z - GEO.TIP_Z), 1e-9);
  for (let i = 0; i < 40; i++) {
    const pose = { x: (i * 7) % 140, a: ((i * 47) % 360) - 180, b: ((i * 13) % 60) - 30, y: (i * 29) % 320, z: (i * 11) % 140 };
    for (const p of [[GEO.HALF, GEO.HALF, GEO.THICK], [-GEO.HALF, 20, -GEO.THICK], [10, -30, 5]]) {
      const got = carry(pose, "a", p);
      const want = toWorld(pose, p);
      for (let j = 0; j < 3; j++) near(got[j], want[j], 1e-9);
    }
    // Y runs the spindle right along the wall, Z lowers it
    const tip = carry(pose, "z", TIP);
    const want = [GEO.SPINDLE_X0 + pose.y, GEO.SPINDLE_Y, GEO.TIP_Z - pose.z];
    for (let j = 0; j < 3; j++) near(tip[j], want[j], 1e-9);
  }
  // through the job, the drawn bur's tip is on the point of the drawn holder that the model says it cuts
  for (let t = 0; t < SIM_LEN; t += 0.37) {
    const s = simAt(t);
    const tip = carry(s, "z", TIP);
    const at = carry(s, "a", tipIn(s).p);
    for (let j = 0; j < 3; j++) near(tip[j], at[j], 1e-9);
  }
});

test("the collision stand-ins cover what is drawn: the head under the spindle, the cradle and the holder", async () => {
  const { T } = await scene;
  // the head: every drawn point at or above the floor its stand-in footprint gives it
  for (const part of T.parts.filter((x) => x.group?.name === "z")) {
    for (const shape of part.shapes) {
      for (const q of surface(shape)) {
        const dx = q[0] - GEO.SPINDLE_X0;
        const dy = q[1] - GEO.SPINDLE_Y;
        const h = q[2] - GEO.TIP_Z;
        let zb = Infinity;
        for (const sb of HEAD) {
          const on = sb.r !== undefined ? Math.hypot(dx, dy) <= sb.r + 1e-6 : dx >= sb.rect[0] - 1e-6 && dx <= sb.rect[1] + 1e-6 && dy >= sb.rect[2] - 1e-6 && dy <= sb.rect[3] + 1e-6;
          if (on) zb = Math.min(zb, sb.zb);
        }
        assert.ok(zb <= h + 1e-6, `${part.name}: drawn ${h.toFixed(1)} above the tip at (${dx.toFixed(1)}, ${dy.toFixed(1)}), stand-ins from ${zb}`);
      }
    }
  }
  // the cradle and the holder: every drawn point inside one of its own group's stand-ins (within 0.5), at rest and
  // turned, the drawn points carried as the page carries them
  const { carry } = await scene;
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const within = (body, q) => {
    if (body.kind === "box") { const d = [q[0] - body.c[0], q[1] - body.c[1], q[2] - body.c[2]]; return body.e.every((e, i) => Math.abs(dot(d, e)) <= body.h[i] + 0.5); }
    const d = [q[0] - body.p0[0], q[1] - body.p0[1], q[2] - body.p0[2]];
    const s = dot(d, body.u);
    return s >= -0.5 && s <= body.len + 0.5 && Math.hypot(d[0] - s * body.u[0], d[1] - s * body.u[1], d[2] - s * body.u[2]) <= body.r + 0.5;
  };
  let checked = 0;
  const parts = T.parts.filter((x) => x.group?.name === "a" || x.group?.name === "b").map((x) => ({ name: x.name, group: x.group.name, pts: x.shapes.flatMap(surface) }));
  for (const pose of [{ x: 0, a: 0, b: 0 }, { x: 40, a: 90, b: 30 }, { x: 100, a: -135, b: -20 }]) {
    const bodies = bodiesOf({ ...pose, mag: 0 });
    for (const part of parts) {
      const mine = bodies.filter((body) => body.group === part.group);
      for (const p of part.pts) {
        const q = pose.x || pose.a || pose.b ? carry({ ...pose, y: 0, z: 0 }, part.group, p) : p;
        checked++;
        assert.ok(mine.some((body) => within(body, q)), `${part.name} drawn outside its group's stand-ins at ${JSON.stringify(pose)}: ${q.map((v) => v.toFixed(1))}`);
      }
    }
  }
  assert.ok(checked > 1000);
});

test("the bridge's outline and the roughing terraces inside it: no spurs, no crossings, and each end where it belongs", () => {
  for (const g of [0, BRIDGE.gap, -1.3, -2.6]) {
    const { pts } = bandOutline(g, g < 0 ? 1.2 : 0.6);
    const n = pts.length;
    const edge = (k) => [pts[(k + 1) % n][0] - pts[k][0], pts[(k + 1) % n][1] - pts[k][1]];
    for (let k = 0; k < n; k++) {
      const a = edge(k);
      const b = edge((k + 1) % n);
      const turn = deg(Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])));
      assert.ok(turn < 100, `grow ${g}: turns ${turn.toFixed(0)}° at point ${k + 1}`);
    }
    const cross = (p, q, r, s) => { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (Math.abs(d) < 1e-12) return false; const u = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d; const v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return u > 1e-9 && u < 1 - 1e-9 && v > 1e-9 && v < 1 - 1e-9; };
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      assert.ok(!cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]), `grow ${g}: edges ${i} and ${j} cross`);
    }
    // each end face stands CAP + grow past the last contact, along the arch
    for (const dir of [1, -1]) {
      const c = archAt(dir * ARCH_L);
      const reach = Math.max(...pts.map((p) => dir * ((p[0] - c.p[0]) * c.t[0] + (p[1] - c.p[1]) * c.t[1])));
      near(reach, CAP + g, 0.05);
    }
  }
});

test("each wall edge belongs to the pass that finishes it", () => {
  const n = OUTLINE.pts.length;
  for (let i = 0; i < n; i++) {
    const side = OUTLINE.side[i];
    const pass = WALL_REACH.pass[i];
    if (side === 1) assert.equal(pass, "buccal", `edge ${i}`);
    if (side === -1 && OUTLINE.side[(i + 1) % n] === -1) assert.equal(pass, "palatal", `edge ${i}`);
    if (side === 0) assert.equal(pass, OUTLINE.s[i] > 0 ? "buccal" : "palatal", `end edge ${i}`);
  }
  // and is reached in order: each edge's far end at its share of the way along its pass
  const seg = (k) => Math.hypot(OUTLINE.pts[(k + 1) % n][0] - OUTLINE.pts[k][0], OUTLINE.pts[(k + 1) % n][1] - OUTLINE.pts[k][1]);
  const firstPalatal = OUTLINE.side.indexOf(-1);
  for (const [kind, from, to] of [["buccal", 0, firstPalatal], ["palatal", firstPalatal, n]]) {
    let total = 0;
    for (let k = from; k < to; k++) total += seg(k);
    let run = 0;
    let last = 0;
    for (let k = from; k < to; k++) {
      run += seg(k);
      assert.equal(WALL_REACH.pass[k], kind, `edge ${k}`);
      near(WALL_REACH.at[k], run / total, 1e-9);
      assert.ok(WALL_REACH.at[k] > last, `edge ${k} reached out of order`);
      last = WALL_REACH.at[k];
    }
    near(last, 1, 1e-12);
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
    else { assert.ok(Math.max(...tilts) <= 15 + 1e-9 && Math.max(...tilts) > 14.9, `${span.kind} max ${Math.max(...tilts)}`); assert.ok(Math.min(...tilts) >= 10, `${span.kind} min ${Math.min(...tilts)}`); }
  }
  // the lean eases only where the cradle's right drive hub would come inside the head's envelope: on the buccal pass,
  // from the right second premolar on round the right-hand end
  const pm2 = TEETH.find((t) => t.side === 1 && t.name === "second premolar");
  const from = Math.min(...pm2.outline.map((p) => p[0])) - 1.5;
  const eased = job.filter(({ s }) => s.cutting && s.kind !== "occlusal" && s.tilt < 14.99);
  assert.ok(eased.length > 0);
  for (const { t, s } of eased) assert.ok(s.kind === "buccal" && tipIn(s).p[0] >= from, `lean eased to ${s.tilt.toFixed(1)}° at ${t}, before the right second premolar`);
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

test("dipping into and out of a pass, the whole bur stays in the channel and off the bridge", () => {
  let dips = 0;
  for (const { t, s } of job) {
    if (s.step !== "dip") continue;
    const { p, t: axis } = tipIn(s);
    if (GEO.THICK - p[2] > 0) dips++;
    // up the tool from its tip: below face B it is in the channel, clear of the outer wall; below the bridge's top, clear
    // of the bridge (the 0.12 is the wall pass's own tolerance on the ball's contact)
    for (let h = 0; h <= 24; h += 0.1) {
      const q = [p[0] + h * axis[0], p[1] + h * axis[1], p[2] + h * axis[2]];
      const depth = GEO.THICK - q[2];
      if (depth <= 0) break;
      const r = neck(h);
      assert.ok(inside(q, OPENING.pts) && edgeDist(q, OPENING.pts) >= r - 1e-9, `dip: the bur ${h.toFixed(1)} up meets the channel's wall at ${t}`);
      if (depth > BRIDGE.top) assert.ok(!inside(q, OUTLINE.pts) && edgeDist(q, OUTLINE.pts) >= r - 0.12, `dip: the bur ${h.toFixed(1)} up meets the bridge at ${t}`);
    }
  }
  assert.ok(dips > 20);
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

test("the bur is cut off where it goes into the channel, and left whole in the open", () => {
  const sh = [-1.07, 1.36];
  const faceAt = (p, axis) => { const k = (GEO.THICK - p[2]) / axis[2]; return [p[0] + k * axis[0], p[1] + k * axis[1]]; };
  // in the job: whenever the tip is below face B, the bur went in through the opening, so only its sight line decides
  let cuts = 0;
  for (const { t, s } of job) {
    const { p, t: axis } = tipIn(s);
    if (GEO.THICK - p[2] <= 0) { assert.equal(burCut(p, axis, sh), null, `clipped above the face at ${t}`); continue; }
    assert.ok(axis[2] >= 0.2 && inside(faceAt(p, axis), OPENING.pts), `below face B outside the channel at ${t}`);
    if (burCut(p, axis, sh)) cuts++;
  }
  assert.ok(cuts > 100, `cuts ${cuts}`);
  // in jog: the tip below face B's plane but out in the open (over the magazine, past the disc's edge, turned on A)
  let open = 0;
  for (const a of [-180, -135, -90, -85, -45, 0, 45, 90, 135]) for (const b of [-30, -15, 0, 15, 30]) for (const y of [0, 50, 100, 150, 225, 300]) for (const x of [0, 55, 140]) {
    const pose = { x, y, a, b, m: magFor(y) };
    const { p, t: axis } = tipIn({ ...pose, z: Math.max(0, roomAt(pose, pose.m)) });
    if (GEO.THICK - p[2] <= 0 || (axis[2] >= 0.2 && inside(faceAt(p, axis), OPENING.pts))) continue;
    open++;
    assert.equal(burCut(p, axis, sh), null, `clipped in the open at ${JSON.stringify(pose)}`);
  }
  assert.ok(open > 100, `open ${open}`);
});

test("jog: out of a cut the head only rises, never deeper or sideways in the part, and clears whatever keys come meanwhile", () => {
  const ENDS = { x: [0, TRAVEL.x], y: [0, TRAVEL.y], z: [0, TRAVEL.z], a: [-180, 180], b: [-SPEC.bLimit, SPEC.bLimit] };
  const ask = (j, key, delta) => ({ ...j, want: jogRequest(j.want, key, j.want[key] + delta, ...ENDS[key]), mWant: magFor(key === "y" ? j.want.y + delta : j.want.y) });
  const run = (t0, lateral, zDown, zFrame, hz) => {
    const s = simAt(t0);
    const cur = { x: s.x, y: s.y, z: s.z, a: s.a, b: s.b, m: 1 };
    let j = { cur, ...jogEnter(cur) };
    const depth0 = GEO.THICK - tipIn(cur).p[2];
    assert.ok(j.lifting, `not in the cut at ${t0}`);
    const k = 1 - Math.exp(-1 / hz / 0.18);
    const label = `${t0} ${lateral.join(" ")} then Z +${zDown} at frame ${zFrame}, ${hz} Hz`;
    j = ask(j, ...lateral);
    let cleared = -1;
    for (let f = 0; f < 10 * hz; f++) {
      if (f === zFrame) j = ask(j, "z", zDown);
      const r = jogStep(j, k, 1 / hz / 2.2);
      const depth = GEO.THICK - tipIn(r.cur).p[2];
      assert.ok(depth <= depth0 + 1e-6, `${label}: ${depth.toFixed(2)} deep at frame ${f}, from ${depth0.toFixed(2)}`);
      if (depth > 0) for (const key of ["x", "y", "a", "b"]) near(r.cur[key], cur[key], 1e-9);
      j = { ...j, cur: r.cur, want: r.want, lifting: r.lifting };
      if (cleared < 0 && !r.lifting) cleared = f;
      if (!r.busy) return;
    }
    assert.fail(`${label}: still moving after 10 s (lift cleared at frame ${cleared})`);
  };
  for (const t0 of [5.03, 11.43, 24, 36, 41]) for (const lateral of [["x", 5], ["y", 5], ["a", -45], ["b", 15]]) for (const [zDown, zFrame] of [[1, 2], [5, 1], [200, 4]]) run(t0, lateral, zDown, zFrame, 60);
  // the sequences that once stalled, at 60 and 120 frames a second
  for (const hz of [60, 120]) { run(11.43, ["x", 5], 200, 1, hz); run(5.03, ["y", 5], 5, 1, hz); run(24, ["a", -30], 200, 1, hz); }
});

test("readout", () => {
  assert.equal(readoutOf({ ...HOME, z: 12.34, a: -180 }), "X 55.0 · Y 225.0 · Z −12.3 · A 180.0° · B 0.0°");
});
