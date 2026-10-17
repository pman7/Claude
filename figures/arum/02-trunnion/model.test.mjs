import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC, TRAVEL, GEO, HOME, Y_DISC, X_DISC, BRIDGE, OUTLINE, OPENING, TEETH, CHANNELS, CONNECTORS, CAP, ARCH_L, HEAD, burRadius, magOf, mOf, zLimit, upperRoom, axesFor, tipIn, toWorld, bodiesOf, WALL_REACH, archAt, bandOutline, roomAt, magFor, jogEnter, jogRequest, jogStep, simAt, simPassStart, SIM, SIM_LEN, SIM_SPANS, POCKETS, SHANK_TOP, pocketAt, viewFor, drawnTools, readoutOf, wrap } from "./model.mjs";
import { workShapes, burCut } from "./work.mjs";
import { readFileSync } from "node:fs";

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

test("the magazine slides in over the open flap, and the flap swings up only once the block is behind the wall", () => {
  assert.deepEqual(magOf(0), { mag: 0, flap: 0 });
  assert.deepEqual(magOf(1), { mag: GEO.MAG_STROKE, flap: 90 });
  let last = magOf(0);
  for (let m = 0.002; m <= 1.0001; m += 0.002) {
    const now = magOf(m);
    assert.ok(now.mag >= last.mag && now.flap >= last.flap, `m ${m}`);
    // the block's front (with its fittings) behind the wall's face whenever the flap is off the floor of its swing
    if (now.flap > 0) assert.ok(GEO.MAG.y + GEO.MAG.d + 11 - now.mag < GEO.WALL_Y, `flap ${now.flap.toFixed(1)}° with the block's front at ${(GEO.MAG.y + GEO.MAG.d - now.mag).toFixed(1)}`);
    // and the pose read back from the slide and the flap gives the sequence again
    near(mOf(now), Math.min(1, m), 1e-6);
    last = now;
  }
  // in, the whole magazine with its carrier is behind the window; out, its front row is on the spindle's line
  near(pocketAt(1, 1)[1], GEO.SPINDLE_Y, 1e-9);
  assert.ok(GEO.MAG.y + GEO.MAG.d - GEO.MAG_STROKE < GEO.WALL_Y - 14);
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
  // and the other way: each stand-in has something drawn within 2.5 mm of its underside over its footprint, so the
  // envelope does not stand far proud of the head anywhere (where it did, it once eased the walls' lean on its own)
  const headPts = T.parts.filter((x) => x.group?.name === "z").flatMap((part) => part.shapes.flatMap(surface)).map((q) => [q[0] - GEO.SPINDLE_X0, q[1] - GEO.SPINDLE_Y, q[2] - GEO.TIP_Z]);
  // (the bur's own stand-in is its drawn profile's, checked in the scene test; its sorting shape starts 9 mm up)
  for (const sb of HEAD.filter((x) => x.zb > 0)) {
    const on = ([dx, dy]) => (sb.r !== undefined ? Math.hypot(dx, dy) <= sb.r : dx >= sb.rect[0] && dx <= sb.rect[1] && dy >= sb.rect[2] && dy <= sb.rect[3]);
    const lowest = Math.min(...headPts.filter(on).map((q) => q[2]));
    assert.ok(lowest - sb.zb <= 2.5, `stand-in ${JSON.stringify(sb)}: nothing drawn within 2.5 of it (lowest ${lowest.toFixed(1)})`);
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
  for (const span of SIM_SPANS.filter((x) => x.kind !== "tool")) {
    const cut = job.filter(({ s }) => s.cutting && s.kind === span.kind);
    assert.ok(cut.length > 100, span.kind);
    const range = (k) => Math.max(...cut.map(({ s }) => s[k])) - Math.min(...cut.map(({ s }) => s[k]));
    assert.ok(range("a") > 2 && range("b") > 2, `${span.kind}: A ${range("a")}, B ${range("b")}`);
    const tilts = cut.map(({ s }) => s.tilt);
    if (span.kind === "occlusal") { near(Math.max(...tilts), 3, 0.01); near(Math.min(...tilts), 3, 0.01); }
    else { assert.ok(Math.max(...tilts) <= 15 + 1e-9 && Math.max(...tilts) > 14.9, `${span.kind} max ${Math.max(...tilts)}`); assert.ok(Math.min(...tilts) >= 10, `${span.kind} min ${Math.min(...tilts)}`); }
  }
  // with the head and cradle as drawn, nothing comes inside the head's envelope, so the walls' lean never eases (the
  // caption says so: a change that brings an easing back must be described there)
  const eased = job.filter(({ s }) => s.cutting && s.kind !== "occlusal" && s.tilt < 14.99);
  assert.equal(eased.length, 0, `lean eased to ${eased.length ? Math.min(...eased.map(({ s }) => s.tilt)).toFixed(2) : ""}°`);
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
    // only the dips into and out of each pass go below the clearance plane; the tool change is left of the cradle
    if (s.step === "cut" || s.step === "dip" || s.kind === "tool") continue;
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
  assert.deepEqual(SIM_SPANS.map((span) => span.kind), ["tool", "occlusal", "buccal", "palatal"]);
  const order = ["occlusal", "buccal", "palatal"];
  let last = { occlusal: 0, buccal: 0, palatal: 0 };
  for (const { s } of job) { for (const k of order) assert.ok(s.done[k] >= last[k] - 1e-12); last = s.done; }
  // the magazine is in, and back on its front row, whenever the head is at the work
  for (const { t, s } of job) if (s.kind !== "tool" && s.step !== "move") { near(s.m, 1, 1e-12); near(s.row, 0, 1e-12); assert.ok(s.tool.spindle, `no tool at ${t}`); }
});

test("resuming lands at the dip into the pass that was running, above the part; after the last pass, the job starts again", () => {
  assert.equal(simPassStart(0), 0);
  assert.equal(simPassStart(SIM_LEN), 0);
  for (const span of SIM_SPANS.filter((x) => x.kind !== "tool")) {
    const dip = SIM.steps.find((step) => step.kind === "dip" && step.pass?.kind === span.kind).start;
    near(simPassStart(span.start + 0.5), dip, 1e-9);
    near(simPassStart(span.end - 0.01), dip, 1e-9);
    // above the part, the tip on the clearance plane over the disc
    near(tipIn(simAt(dip)).p[2], GEO.THICK + 6, 0.5);
  }
  // in the tool change, resuming lands on a move with the tools as they are at the time left (never undoing a swap)
  for (const { t, s } of job) {
    if (s.kind !== "tool" || t > SIM_SPANS[0].end - 1e-6) continue;
    const back = simPassStart(t);
    assert.ok(back >= SIM_SPANS[0].start && back < SIM_SPANS[0].end, `resume from ${t} at ${back}`);
    assert.deepEqual(simAt(back).tool, s.tool, `resume from ${t} at ${back} changes the tools`);
    assert.equal(simAt(back + 1e-6).step, "move");
  }
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
  const ask = (j, key, delta) => { const want = jogRequest(j.want, key, j.want[key] + delta, ...ENDS[key]); return { ...j, want, mWant: magFor(want.y, want.b) }; };
  const run = (t0, lateral, zDown, zFrame, hz) => {
    const s = simAt(t0);
    const cur = { x: s.x, y: s.y, z: s.z, a: s.a, b: s.b, m: s.m, row: s.row };
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
  // times in the cuts, counted from the start of the first pass's move (the tool change comes before it)
  const T0 = SIM_SPANS.find((span) => span.kind === "occlusal").start;
  for (const dt of [5.03, 11.43, 24, 36, 41]) for (const lateral of [["x", 5], ["y", 5], ["a", -45], ["b", 15]]) for (const [zDown, zFrame] of [[1, 2], [5, 1], [200, 4]]) run(T0 + dt, lateral, zDown, zFrame, 60);
  // the sequences that once stalled, at 60 and 120 frames a second
  for (const hz of [60, 120]) { run(T0 + 11.43, ["x", 5], 200, 1, hz); run(T0 + 5.03, ["y", 5], 5, 1, hz); run(T0 + 24, ["a", -30], 200, 1, hz); }
});

test("the tool change: the magazine brings each pocket under the spindle, and the drawn tools swap where the head stands", async () => {
  const { carry } = await scene;
  for (const [what, key] of [["drop", POCKETS.drop], ["pick", POCKETS.pick]]) {
    const t = SIM.swapAt[what];
    const s = simAt(t);
    const [c, r] = key.split("/").map(Number);
    const [px, py] = pocketAt(c, r);
    // the spindle over the pocket, the slide holding that pocket's row on the spindle's line, the collet 5 above the shank
    near(GEO.SPINDLE_X0 + s.y, px, 1e-9);
    near(py - magOf(s.m).mag + GEO.PITCH * s.row, GEO.SPINDLE_Y, 1e-9);
    near(GEO.TIP_Z - s.z + GEO.COLLET, SHANK_TOP + 5, 1e-9);
    assert.equal(s.step, "hold");
    // and the drawn pocket under the drawn spindle, as the page poses them
    const pocket = carry(s, "magrow", [px, py, SHANK_TOP]);
    const tip = carry(s, "z", [GEO.SPINDLE_X0, GEO.SPINDLE_Y, GEO.TIP_Z]);
    near(pocket[0], tip[0], 1e-9);
    near(pocket[1], tip[1], 1e-9);
  }
  // the tools: the spindle holds one except between the swaps; the drop pocket fills at the first, the pick pocket
  // empties at the second; the job loops back to the start's tools
  for (const { t, s } of job) {
    const between = t >= SIM.swapAt.drop && t < SIM.swapAt.pick;
    assert.equal(s.tool.spindle, !between, `spindle at ${t}`);
    assert.equal(s.tool[POCKETS.drop], t >= SIM.swapAt.drop, `drop pocket at ${t}`);
    assert.equal(s.tool[POCKETS.pick], t < SIM.swapAt.pick, `pick pocket at ${t}`);
  }
  assert.ok(SIM.swapAt.drop < SIM.swapAt.pick && SIM.swapAt.pick < SIM_SPANS[1].start);
  // the bur comes down onto the sensor post's cap to be measured, with the magazine back on its front row by then
  const post = job.filter(({ s }) => s.kind === "tool" && Math.abs(GEO.SPINDLE_X0 + s.y - GEO.POST.x) < 1e-6 && Math.abs(GEO.SPINDLE_Y - GEO.POST.y) < 1e-9);
  const lowest = post.reduce((best, x) => (GEO.TIP_Z - x.s.z < GEO.TIP_Z - best.s.z ? x : best));
  near(GEO.TIP_Z - lowest.s.z, GEO.POST.top, 1e-6);
  near(lowest.s.row, 0, 1e-9);
  assert.ok(lowest.s.tool.spindle);
  // as in the video: the magazine comes out while the head is over the sensor post, before it moves over the magazine,
  // and goes back in as the head leaves for the first pass
  for (const { t, s } of job) {
    const out = SIM.runs[0];
    if (t >= out.t0 && t <= out.t1) near(GEO.SPINDLE_X0 + s.y, GEO.POST.x, 1e-9);
    const back = SIM.runs[SIM.runs.length - 1];
    if (t >= back.t0 && t <= back.t1) assert.equal(s.say, "Down to the first pass · the magazine goes back in", `at ${t}`);
  }
  assert.deepEqual(SIM.runs.map((run) => run.key), ["m", "row", "row", "m"]);
});

test("jog: the magazine comes out only with the cradle level, the cradle tilts only with it in, and it indexes home first", () => {
  const ENDS = { x: [0, TRAVEL.x], y: [0, TRAVEL.y], z: [0, TRAVEL.z], a: [-180, 180], b: [-SPEC.bLimit, SPEC.bLimit] };
  const ask = (j, key, value) => { const want = jogRequest(j.want, key, value, ...ENDS[key]); return { ...j, want, mWant: magFor(want.y, want.b) }; };
  const settle = (j, label) => {
    for (let f = 0; f < 1200; f++) {
      const r = jogStep(j, 0.1, 1 / 60);
      const c = r.cur;
      assert.ok(c.m >= 1 || Math.abs(c.b) <= 0.5 + 1e-9, `${label}: cradle tilted ${c.b.toFixed(2)}° with the magazine at ${c.m.toFixed(3)}`);
      assert.ok(c.row <= 1e-12 || c.m === j.cur.m, `${label}: the magazine ran its sequence while indexed out`);
      // out of a swap the head first rises straight up (its bur stand-in is down among the shanks); after that it is
      // never inside anything
      if (r.lifting) assert.ok(c.z <= j.cur.z + 1e-12 && c.x === j.cur.x && c.y === j.cur.y, `${label}: moved off the lift at frame ${f}`);
      else assert.ok(roomAt(c, c.m) >= c.z - 1e-9, `${label}: head inside at frame ${f}`);
      j = { ...j, cur: c, want: r.want, lifting: r.lifting };
      if (!r.busy) return j;
    }
    assert.fail(`${label}: still moving`);
  };
  let j = { cur: { ...HOME, m: 1, row: 0 }, want: { ...HOME }, mWant: 1, lifting: false };
  j = settle(ask(j, "b", 10), "tilt");
  j = settle(ask(j, "y", 50), "over the magazine, tilted");
  near(j.cur.m, 1, 1e-12);
  j = settle(ask(j, "b", 0), "level");
  near(j.cur.m, 0, 1e-12);
  j = settle(ask(j, "b", -12), "tilt with it out");
  near(j.cur.m, 1, 1e-12);
  near(j.cur.b, -12, 1e-9);
  // into jog at the pick, the magazine indexed three rows out: it indexes home before anything else of its own moves
  const s = simAt(SIM.swapAt.pick);
  const cur = { x: s.x, y: s.y, z: s.z, a: s.a, b: s.b, m: s.m, row: s.row };
  j = settle({ cur, ...jogEnter(cur) }, "from the pick");
  near(j.cur.row, 0, 1e-12);
});

test("jog: the cradle and the magazine never wait on each other, and the head never passes through anything between frames", () => {
  const ENDS = { x: [0, TRAVEL.x], y: [0, TRAVEL.y], z: [0, TRAVEL.z], a: [-180, 180], b: [-SPEC.bLimit, SPEC.bLimit] };
  const k = 1 - Math.exp(-1 / 60 / 0.18);
  const run = (j, label) => {
    for (let f = 0; f < 1800; f++) {
      const r = jogStep(j, k, 1 / 60);
      const a = j.cur;
      const b = r.cur;
      // between this frame and the next, at quarter steps, the head clear of everything (it may only be inside while it
      // rises straight out of a cut)
      if (!r.lifting && !j.lifting)
        for (const u of [0.25, 0.5, 0.75]) {
          const mid = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, a: a.a + wrap(b.a - a.a) * u, b: a.b + (b.b - a.b) * u, m: a.m + (b.m - a.m) * u, row: (a.row ?? 0) + ((b.row ?? 0) - (a.row ?? 0)) * u };
          assert.ok(roomAt(mid, mid.m) >= mid.z - 0.5, `${label}: through something at frame ${f} + ${u} (room ${roomAt(mid, mid.m).toFixed(1)} at Z ${mid.z.toFixed(1)})`);
        }
      j = { ...j, cur: b, want: r.want, lifting: r.lifting };
      if (!r.busy) return j;
    }
    assert.fail(`${label}: still moving after 30 s`);
  };
  const ask = (j, key, value) => { const want = jogRequest(j.want, key, value, ...ENDS[key]); return { ...j, want, mWant: magFor(want.y, want.b) }; };
  // half way back into the job from a tilted jog (the magazine half out, the cradle still tilted), the reader levels it
  const half = { x: 55, y: 50, z: 0, a: 0, b: -3.125, m: 0.156, row: 0 };
  let j = run(ask({ cur: half, want: { ...half }, mWant: 0, lifting: false }, "b", -0.13), "level from half way");
  assert.ok(Math.abs(j.cur.b) <= 0.5 && j.cur.m === 0, `ended at B ${j.cur.b}, magazine ${j.cur.m}`);
  // the head down by the sensor post, then sideways over the magazine or home
  const post = { x: X_DISC, y: 0, z: 0, a: 0, b: 0, m: 0, row: 0 };
  post.z = roomAt(post, 0);
  const low = { cur: post, want: { ...post }, mWant: 0, lifting: false };
  run(ask(low, "y", TRAVEL.y), "from the post to Y's end");
  run(ask(low, "y", 25), "from the post over the magazine");
  run({ ...low, want: { ...HOME }, mWant: 1 }, "from the post home");
});

test("the tool change uses the video's pockets: C1 R1 back, C3 R4 out, column 1 at the operator's left, row 1 at the front, three rows indexed", () => {
  // (the caption names them: the front row, three rows)
  assert.equal(POCKETS.drop, "1/1");
  assert.equal(POCKETS.pick, "3/4");
  assert.ok(pocketAt(1, 1)[0] < pocketAt(2, 1)[0] && pocketAt(2, 1)[0] < pocketAt(3, 1)[0], "column 1 at the operator's left (−x)");
  assert.ok(pocketAt(1, 1)[1] > pocketAt(1, 2)[1], "row 1 at the front (+y)");
  assert.deepEqual(SIM.runs.filter((r) => r.key === "row").map((r) => [r.from, r.to]), [[0, 3], [3, 0]]);
});

test("the drawn magazine slides and indexes as the model and its stand-in do", async () => {
  const { carry } = await scene;
  const at0 = bodiesOf({ mag: 0, row: 0 }).find((b) => b.group === "mag").c;
  for (const [m, row] of [[1, 0], [0.8, 0], [0.5, 0], [0, 0], [0, 1.5], [0, 3], [0, 4]]) {
    const mag = magOf(m).mag;
    const p = [...pocketAt(2, 3), SHANK_TOP];
    const q = carry({ m, row }, "magrow", p);
    near(q[0], p[0], 1e-9);
    near(q[1], p[1] - mag + GEO.PITCH * row, 1e-9);
    near(q[2], p[2], 1e-9);
    const at = bodiesOf({ mag, row }).find((b) => b.group === "mag").c;
    near(at[1] - at0[1], -mag + GEO.PITCH * row, 1e-9);
  }
});

test("jog never lets the head inside the drawn carriage, magazine (its tools included) or sensor post", async () => {
  const { T, carry } = await scene;
  const pick = (name) => (name === "ram" || name === "ram.brush" ? "x" : name.startsWith("magazine") || name.startsWith("pocket.") ? "magrow" : name.startsWith("post.") && !name.startsWith("post.cable") ? "post" : null);
  const parts = [];
  for (const part of T.parts) {
    const g = pick(part.name);
    if (!g) continue;
    let pts = part.shapes.flatMap(surface);
    // the two pockets the change swaps sort on a stub: take their drawn shank
    const key = part.name.startsWith("pocket.") ? part.name.slice(7).replace(".", "/") : null;
    if (key === POCKETS.drop || key === POCKETS.pick) {
      const [x, y] = pocketAt(...key.split("/").map(Number));
      pts = [];
      for (let z = GEO.MAG_TOP + 5; z <= SHANK_TOP + 1e-9; z += 0.5) for (let k = 0; k < 24; k++) pts.push([x + 3 * Math.cos((k / 24) * 2 * Math.PI), y + 3 * Math.sin((k / 24) * 2 * Math.PI), z]);
    }
    parts.push({ name: part.name, g, pts });
  }
  const covering = (dx, dy) => { let zb = Infinity; for (const sb of HEAD) { const on = sb.r !== undefined ? Math.hypot(dx, dy) <= sb.r : dx >= sb.rect[0] && dx <= sb.rect[1] && dy >= sb.rect[2] && dy <= sb.rect[3]; if (on) zb = Math.min(zb, sb.zb); } return zb; };
  let worst = { over: -Infinity };
  let checked = 0;
  const states = [];
  for (const x of [0, TRAVEL.x / 2, TRAVEL.x]) for (let y = 0; y <= TRAVEL.y; y += 2.5) states.push({ x, y, a: 0, b: 0, m: magFor(y, 0), row: 0 });
  for (let y = 0; y <= 125; y += 2.5) for (const row of [1.5, 3]) states.push({ x: GEO.SPINDLE_Y, y, a: 0, b: 0, m: 0, row });
  // the cradle tilted (its left end down beside the carriage), the magazine in as the interlock keeps it
  for (const x of [40, 80, 120, TRAVEL.x]) for (let y = 60; y <= 200; y += 5) for (const b of [-30, 30]) for (const a of [-180, 0]) states.push({ x, y, a, b, m: 1, row: 0 });
  for (const s of states) {
    const z = zLimit({ x: s.x, b: s.b, a: s.a, mag: magOf(s.m).mag, row: s.row }, s.y);
    if (z < 0) continue;
    const sx = GEO.SPINDLE_X0 + s.y;
    const tip = GEO.TIP_Z - z;
    // both groups are slides: their pose is a translation
    const shifts = { post: [0, 0, 0], x: carry({ ...s, a: 0, b: 0, z: 0 }, "x", [0, 0, 0]), magrow: carry({ ...s, a: 0, b: 0, z: 0 }, "magrow", [0, 0, 0]) };
    for (const part of parts) {
      const shift = shifts[part.g];
      for (const p of part.pts) {
        const q = [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]];
        const zb = covering(q[0] - sx, q[1] - GEO.SPINDLE_Y);
        if (zb === Infinity) continue;
        checked++;
        const over = q[2] - tip - zb;
        if (over > worst.over) worst = { over, part: part.name, s, z };
      }
    }
  }
  assert.ok(checked > 10000, `checked ${checked}`);
  assert.ok(worst.over <= 0, `head ${worst.over.toFixed(1)} mm into ${worst.part} at ${JSON.stringify(worst.s)} Z ${worst.z.toFixed(1)}`);
});

test("the drawn sensor post stands where the model measures on it and where its stand-in is", async () => {
  const { T } = await scene;
  const cap = T.parts.find((p) => p.name === "post.cap").shapes[0];
  near(cap.F.o[0], GEO.POST.x, 1e-9);
  near(cap.F.o[1], GEO.POST.y, 1e-9);
  near(Math.max(...cap.poly.map(([sv]) => sv)), GEO.POST.top, 1e-9);
  near(Math.max(...cap.poly.map(([, r]) => r)), GEO.POST.r, 1e-9);
  const body = bodiesOf({ mag: 0 }).find((b) => b.group === "post");
  near(body.c[0], GEO.POST.x, 1e-9);
  near(body.c[1], GEO.POST.y, 1e-9);
  near(body.c[2] + body.h[2], GEO.POST.top, 1e-9);
});

test("jog: a magazine the job left indexed out goes back to its front row before it moves in, and only once the head is clear", () => {
  const s = simAt(SIM.swapAt.pick + 0.01);
  const cur = { x: s.x, y: s.y, z: s.z, a: s.a, b: s.b, m: s.m, row: s.row };
  let j = { cur, ...jogEnter(cur) };
  const want = jogRequest(j.want, "y", TRAVEL.y, 0, TRAVEL.y);
  j = { ...j, want, mWant: magFor(want.y, want.b) };
  let ran = false;
  for (let f = 0; f < 1800; f++) {
    const r = jogStep(j, 1 - Math.exp(-1 / 60 / 0.18), 1 / 60);
    const c = r.cur;
    if (c.m !== j.cur.m) { ran = true; assert.ok(j.cur.row <= 1e-12 && c.row <= 1e-12, `the magazine ran its sequence at row ${c.row.toFixed(3)} (frame ${f})`); }
    if (c.row !== j.cur.row) assert.ok(roomAt(c, c.m, c.row) >= c.z - 1e-9, `row stepped to ${c.row.toFixed(3)} with the head ${(c.z - roomAt(c, c.m, c.row)).toFixed(1)} too low (frame ${f})`);
    j = { ...j, cur: c, want: r.want, lifting: r.lifting };
    if (!r.busy) break;
  }
  assert.ok(ran, "the magazine never went in");
  near(j.cur.m, 1, 1e-12);
  near(j.cur.row, 0, 1e-12);
});

test("the page shows and hides the drawn tools by the job's tools, and frames the tool change on the magazine", async () => {
  const { T } = await scene;
  const live = readFileSync(new URL("./live.js", import.meta.url), "utf8");
  const names = new Set(T.parts.map((p) => p.name));
  for (const [, n] of live.matchAll(/data-name="([^"$]+)"/g)) assert.ok(names.has(n), `live.js looks for ${n}`);
  // live.js takes both from the model
  assert.match(live, /drawnTools\(tool\)/);
  assert.match(live, /const trViewFor = viewFor;/);
  // the tools: every part named is drawn; before the drop, between the swaps and after the pick
  for (const name of Object.keys(drawnTools(simAt(0).tool))) assert.ok(names.has(name), `no drawn ${name}`);
  const at = (t) => drawnTools(simAt(t).tool);
  const drop = `pocket.${POCKETS.drop.replace("/", ".")}`;
  const pick = `pocket.${POCKETS.pick.replace("/", ".")}`;
  assert.deepEqual(at(SIM.swapAt.drop - 0.1), { "tool.bur": true, [drop]: false, [pick]: true });
  assert.deepEqual(at((SIM.swapAt.drop + SIM.swapAt.pick) / 2), { "tool.bur": false, [drop]: true, [pick]: true });
  assert.deepEqual(at(SIM.swapAt.pick + 0.1), { "tool.bur": true, [drop]: true, [pick]: false });
  // the view: on the magazine through the tool change and until it is shut, then in close for the passes
  for (const { t, s } of job) assert.equal(viewFor(t), s.kind === "tool" || s.m < 1 ? 2 : 1, `view at ${t}`);
  for (const { t, s } of job) if (s.cutting) assert.equal(viewFor(t), 1, `view while cutting at ${t}`);
  assert.equal(viewFor(SIM.swapAt.drop), 2);
});

test("readout", () => {
  assert.equal(readoutOf({ ...HOME, z: 12.34, a: -180 }), "X 55.0 · Y 262.0 · Z −12.3 · A 180.0° · B 0.0°");
});
