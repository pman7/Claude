// Truth model for Fig 2: the ARUM 5X-200's five axes. Pure, no DOM.
// Specs: arumdentistry.com/eng/solution/milling1.php (5X-200): 5 axes; travel 325 × 142.5 × 144 mm; A 360°, B ±30°;
// 15 tools Ø6 shank, DC 3.0 kW / 60,000 rpm spindle, Disk Cartridge (ARUM's term), mounting of 5 pre-milled blanks (P1–P5).
// Which part carries which axis is from the dealer: the cradle (with A and B) moves in and out (X), the spindle moves
// left and right and up and down (Z); the magazine comes out through a window behind a flap door hinged at its bottom.
// The 325 mm stroke is drawn on the spindle's left-right move (Y): it is the only stroke long enough to reach the magazine.
// Ø98.5 mm disc: assumed (the standard dental disc size); ARUM publishes none for the 5X-200. The dealer's photos give
// proportions only, so every size taken from them (holder 157 × 25, magazine grid) is scaled to this disc.
// Form: from the dealer's photos of a 5X-200 chamber and ARUM's product photos (styling illustrative, not traced).

export const SPEC = { aRange: 360, bLimit: 30, tools: 15, shank: 6, rpm: 60000, kw: 3.0, disc: 98.5, premills: 5 };
// strokes in mm: X the cradle in and out, Y the spindle left and right, Z the spindle up and down
export const TRAVEL = { x: 142.5, y: 325, z: 144 };

// World: 1 unit = 1 mm, origin at the disc centre with every axis at 0; x right, y toward the operator, z up.
export const GEO = {
  HALF: 78.5, // holder: 157 square
  THICK: 12.5, // holder: 25 thick
  ARM_L: [-130, -94], // cradle: left (support) arm X span
  ARM_R: [119, 160], // cradle: right (A drive) arm X span
  BOSS_R: 33, // a rim of gold round the left cap, as in the dealer's photo 1
  WALL: [85, 105], // cradle back wall, distance back
  TOP: 52,
  WALL_Z0: -40,
  KNUCKLE: [105, 111], // B knuckle on the cradle's back face, distance back
  TIP_Z: 112, // bur tip with Z at 0
  TOOL: 43, // bur stick-out below the nose ring
  SPINDLE_X0: -225, // spindle axis with Y at 0: over the magazine's far column
  // The spindle's line is 55 mm in front of the B axis, so the X stroke spans the work: X 0 puts the bur just past the
  // disc's front edge (+55), X 142.5 just past the premill bar at the back edge (−87.5), and X 55 over the disc centre.
  SPINDLE_Y: 55,
  // magazine block in plan, out: its front row (R1) on the spindle's line
  MAG: { x: -244, y: -89, w: 100, d: 160, r: 3 },
  MAG_TOP: 0,
  MAG_STROKE: 222, // magazine travel from out to fully behind the flap
  RAM: { x: [-77.5, 77.5], z: [-40, 35], len: 200 }, // the X carriage's ram through the back wall, behind the knuckle
};
// Y at which the spindle is over the disc centre, X at which the disc centre is under the spindle, and the home they make
export const Y_DISC = -GEO.SPINDLE_X0;
export const X_DISC = GEO.SPINDLE_Y;
export const HOME = { x: X_DISC, y: Y_DISC, z: 0, a: 0, b: 0 };

export const wrap = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
export const clampB = (deg) => Math.max(-SPEC.bLimit, Math.min(SPEC.bLimit, deg));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The magazine and its flap move as one sequence, 0 (out, flap open flat) to 1 (in, flap shut): the block slides in over
// the open flap first, then the flap swings up.
export const magOf = (m) => {
  const t = clamp(m, 0, 1);
  const slide = t < 0.72 ? t / 0.72 : 1;
  const ease = (u) => u * u * (3 - 2 * u);
  return { mag: GEO.MAG_STROKE * ease(slide), flap: t <= 0.72 ? 0 : 90 * ease((t - 0.72) / 0.28) };
};

// ---------------------------------------------------------------- clearance: how far down the spindle may come
// Rodrigues rotation about a unit axis through the origin, right-handed, as the turn engine's hinges
const rot = (axis, degrees) => {
  const [x, y, z] = axis;
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
};
const mul = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2], M[3] * p[0] + M[4] * p[1] + M[5] * p[2], M[6] * p[0] + M[7] * p[1] + M[8] * p[2]];
const mulM = (A, B) => {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return out;
};

// collision stand-ins at rest, in the frame of the group that carries them: boxes [x0, x1, y0, y1, z0, z1] and
// cylinders along x or y { c, axis, s: [s0, s1], r }
const { HALF, THICK, ARM_L, ARM_R, BOSS_R, WALL, TOP, WALL_Z0, KNUCKLE, MAG, MAG_TOP, RAM, SPINDLE_Y } = GEO;
const CRADLE = [
  { box: [ARM_L[0], ARM_L[1], -WALL[0], BOSS_R, -BOSS_R, BOSS_R] },
  { box: [ARM_L[0], ARM_L[1], -WALL[0], -8, BOSS_R, TOP] },
  { box: [ARM_R[0], ARM_R[1], -WALL[0], 35, -60, TOP] },
  { box: [ARM_L[0], ARM_R[1], -WALL[1], -WALL[0], WALL_Z0, TOP] },
  { box: [-45, 45, -WALL[1], -WALL[0], TOP, TOP + 12] },
  { cyl: { axis: 1, c: [0, 0], s: [-KNUCKLE[1], -KNUCKLE[0]], r: 34 } },
  { cyl: { axis: 0, c: [0, 0], s: [ARM_L[0] - 5, ARM_L[0]], r: 29.5 } },
  { cyl: { axis: 0, c: [0, 0], s: [ARM_L[1], ARM_L[1] + 6], r: 31.5 } },
  { cyl: { axis: 0, c: [0, 0], s: [91, ARM_R[0]], r: 42.5 } },
];
const HOLDER = [
  { box: [-HALF, HALF, -HALF, HALF, -THICK, THICK] },
  { box: [HALF - 10, HALF - 1, -(HALF - 15), 40, THICK, THICK + 3] },
  { box: [-(HALF - 1), -(HALF - 10), -(HALF - 15), 40, THICK, THICK + 3] },
  { cyl: { axis: 0, c: [0, 0], s: [ARM_L[1] + 6, -HALF], r: 24 } },
  { cyl: { axis: 0, c: [0, 0], s: [HALF, 91], r: 29 } },
];
// the ram rides X only (it does not tilt with B)
const RAM_BODY = { box: [RAM.x[0], RAM.x[1], -KNUCKLE[1] - RAM.len, -KNUCKLE[1], RAM.z[0], RAM.z[1]] };
// the magazine block with its shanks standing in the pockets
const MAGAZINE = { box: [MAG.x, MAG.x + MAG.w, MAG.y, MAG.y + MAG.d, MAG_TOP - 40, MAG_TOP + 33] };
// the spindle's underside, from the bur tip up: footprint (circle about the spindle axis, or a box relative to it) and its
// height above the tip
const HEAD = [
  { r: 3, zb: 0 }, // bur
  { r: 7.5, zb: 26 }, // collar and shaft
  { r: 19, zb: 43 }, // nose ring
  { r: 42.5, zb: 47 }, // nose, ring, and the inner half of the nozzle tips
  { rect: [28, 48, 18, 34], zb: 49 }, // right nozzle tube and tip, outside r 42.5
  { rect: [-48, -28, 18, 34], zb: 49 }, // left nozzle tube and tip
  { rect: [38, 58, 24, 42], zb: 67 }, // right nozzle block and dome
  { rect: [-58, -38, 24, 42], zb: 67 }, // left nozzle block and dome
  { rect: [-56, 57, -68, 42], zb: 84 }, // head box
  { rect: [-35, 35, -126 - SPINDLE_Y, -68], zb: 84 }, // saddle, back to the column rails
];
const CLEAR = 2;

// a stand-in in world space: a box as centre, three axes and half sizes; a cylinder as two end centres and a radius
function placed(shape, M, t) {
  const at = (p) => { const q = mul(M, p); return [q[0] + t[0], q[1] + t[1], q[2] + t[2]]; };
  if (shape.box) {
    const [x0, x1, y0, y1, z0, z1] = shape.box;
    const c = at([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
    const e = [mul(M, [1, 0, 0]), mul(M, [0, 1, 0]), mul(M, [0, 0, 1])];
    const corners = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) corners.push(at([x, y, z]));
    return { kind: "box", c, e, h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], corners };
  }
  const { axis, c: [c0, c1], s: [s0, s1], r } = shape.cyl;
  const end = (s) => (axis === 0 ? [s, c0, c1] : [c0, s, c1]);
  const p0 = at(end(s0));
  const p1 = at(end(s1));
  const u = mul(M, axis === 0 ? [1, 0, 0] : [0, 1, 0]);
  const v = mul(M, axis === 0 ? [0, 1, 0] : [1, 0, 0]);
  const w = mul(M, [0, 0, 1]);
  const corners = [];
  for (const p of [p0, p1]) for (let j = 0; j < 12; j++) { const t2 = (j / 12) * 2 * Math.PI; corners.push([p[0] + r * (Math.cos(t2) * v[0] + Math.sin(t2) * w[0]), p[1] + r * (Math.cos(t2) * v[1] + Math.sin(t2) * w[1]), p[2] + r * (Math.cos(t2) * v[2] + Math.sin(t2) * w[2])]); }
  return { kind: "cyl", p0, u, len: s1 - s0, r, corners };
}
// plan extent of a placed stand-in (its corners, grown by 1 for the cylinder's rim samples)
function extentOf(body) {
  const pad = body.kind === "cyl" ? 1 : 0;
  const xs = body.corners.map((p) => p[0]);
  const ys = body.corners.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
}

// the highest point of a stand-in on the vertical line through (x, y), or −Infinity if the line misses it
function topAt(body, x, y) {
  let lo = -Infinity;
  let hi = Infinity;
  if (body.kind === "box") {
    for (let i = 0; i < 3; i++) {
      const e = body.e[i];
      const base = e[0] * (x - body.c[0]) + e[1] * (y - body.c[1]) - e[2] * body.c[2];
      if (Math.abs(e[2]) < 1e-9) {
        if (Math.abs(base) > body.h[i]) return -Infinity;
        continue;
      }
      const t0 = (-body.h[i] - base) / e[2];
      const t1 = (body.h[i] - base) / e[2];
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
    return lo <= hi ? hi : -Infinity;
  }
  // cylinder: points p = (x, y, t) with 0 ≤ s ≤ len and distance from the axis ≤ r
  const { p0, u, len, r } = body;
  const w = [x - p0[0], y - p0[1], -p0[2]];
  const sw = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const uz = u[2];
  if (Math.abs(uz) > 1e-9) {
    const ta = (0 - sw) / uz;
    const tb = (len - sw) / uz;
    lo = Math.min(ta, tb);
    hi = Math.max(ta, tb);
  } else if (sw < 0 || sw > len) return -Infinity;
  // perp(t) = w + t·ẑ − s(t)·u, with s(t) = sw + uz·t: |perp|² = A t² + B t + C ≤ r²
  const d = [w[0] - sw * u[0], w[1] - sw * u[1], w[2] - sw * u[2]];
  const g = [-uz * u[0], -uz * u[1], 1 - uz * u[2]];
  const A = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
  const B = 2 * (d[0] * g[0] + d[1] * g[1] + d[2] * g[2]);
  const C = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - r * r;
  if (A < 1e-12) return C <= 0 && lo <= hi ? hi : -Infinity;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -Infinity;
  const q = Math.sqrt(disc);
  lo = Math.max(lo, (-B - q) / (2 * A));
  hi = Math.min(hi, (-B + q) / (2 * A));
  return lo <= hi ? hi : -Infinity;
}

// sample points of a footprint about the spindle axis at (sx, 0)
const RING = Array.from({ length: 16 }, (_, j) => [Math.cos((j / 16) * 2 * Math.PI), Math.sin((j / 16) * 2 * Math.PI)]);
function footprint(part, sx) {
  const sy = SPINDLE_Y;
  if (part.r !== undefined) {
    const pts = [[sx, sy]];
    for (const [c, s] of RING) pts.push([sx + part.r * c, sy + part.r * s], [sx + 0.5 * part.r * c, sy + 0.5 * part.r * s]);
    return { pts, ext: [sx - part.r, sx + part.r, sy - part.r, sy + part.r], inside: (x, y) => (x - sx) ** 2 + (y - sy) ** 2 <= part.r * part.r };
  }
  const [x0, x1, y0, y1] = part.rect;
  // sampled at 8 mm or finer, so a thin part (the cradle hat is 20 deep) cannot slip between the rows
  const ni = Math.max(4, Math.ceil((x1 - x0) / 8));
  const nj = Math.max(4, Math.ceil((y1 - y0) / 8));
  const pts = [];
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) pts.push([sx + x0 + ((x1 - x0) * i) / ni, sy + y0 + ((y1 - y0) * j) / nj]);
  return { pts, ext: [sx + x0, sx + x1, sy + y0, sy + y1], inside: (x, y) => x >= sx + x0 && x <= sx + x1 && y >= sy + y0 && y <= sy + y1 };
}
const meets = (a, b) => a[0] <= b[1] && b[0] <= a[1] && a[2] <= b[3] && b[2] <= a[3];

// every stand-in placed for a pose { x, b, a, mag }
export function bodiesOf(pose) {
  const t = [0, pose.x ?? 0, 0];
  const Mb = rot([0, -1, 0], pose.b ?? 0);
  const Ma = mulM(Mb, rot([1, 0, 0], pose.a ?? 0));
  const eye = rot([1, 0, 0], 0);
  const out = [...CRADLE.map((s) => placed(s, Mb, t)), ...HOLDER.map((s) => placed(s, Ma, t)), placed(RAM_BODY, eye, t)];
  out.push(placed(MAGAZINE, eye, [0, -(pose.mag ?? 0), 0]));
  for (const body of out) body.ext = extentOf(body);
  return out;
}

// the lowest the bur tip may come with the spindle at Y = y, with CLEAR mm between every part of the head and anything
// under it; and the Z it allows (0 … TRAVEL.z, down)
export function tipFloor(pose, y, bodies = bodiesOf(pose)) {
  const sx = GEO.SPINDLE_X0 + y;
  let floor = -Infinity;
  for (const part of HEAD) {
    const fp = footprint(part, sx);
    let top = -Infinity;
    for (const body of bodies) {
      if (!meets(fp.ext, body.ext)) continue;
      for (const [px, py] of fp.pts) top = Math.max(top, topAt(body, px, py));
      for (const p of body.corners) if (fp.inside(p[0], p[1])) top = Math.max(top, p[2]);
    }
    if (top > -Infinity) floor = Math.max(floor, top + CLEAR - part.zb);
  }
  return floor;
}
// the deepest Z the pose allows (0 … TRAVEL.z down), or −1 when the head would hit something even at the top
export const zLimit = (pose, y, bodies) => {
  const room = GEO.TIP_Z - tipFloor(pose, y, bodies);
  return room < 0 ? -1 : Math.min(room, TRAVEL.z);
};

// ---------------------------------------------------------------- readout and words
const mm = (v) => {
  const r = Math.round(v * 10) / 10 || 0;
  return `${r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}`;
};
const deg = (v) => `${mm(v)}°`;
// A reads in (−180°, 180°]: a half turn is 180°, never −180°
const half = (v) => { const w = wrap(v); return w <= -179.95 ? 180 : w; };
// machine positions: X and Y from home, Z down from the top (negative), A and B in degrees
export const axesOf = (s) => ({ X: mm(s.x), Y: mm(s.y), Z: mm(-s.z), A: deg(half(s.a)), B: deg(s.b) });
export const readoutOf = (s) => { const v = axesOf(s); return `X ${v.X} · Y ${v.Y} · Z ${v.Z} · A ${v.A} · B ${v.B}`; };
export const wordsOf = (s) => `Cradle ${Math.round(s.x)} millimetres in X, spindle ${Math.round(s.y)} in Y and ${Math.round(s.z)} down in Z; disc turned ${Math.round(half(s.a))} degrees on A, tilted ${Math.round(s.b)} on B`;

// ---------------------------------------------------------------- the idle tour: each axis on its own, then all five
// Steps run in order; each eases the values it names to their targets over its duration (a `path` step sets them
// directly). `axis` is the control lit during the step and `say` the line the readout shows.
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const START = { ...HOME, m: 1 };
const deepest = (s) => zLimit({ x: s.x, b: s.b, a: s.a, mag: magOf(s.m).mag }, s.y);
// all five at once: the cradle forward and back, the spindle across the disc, A swinging and B rocking, with Z as deep
// as the tightest moment allows
const together = (u) => ({ x: X_DISC + 45 * Math.sin(2 * Math.PI * u), y: Y_DISC + 45 * Math.sin(4 * Math.PI * u), a: 150 * Math.sin(2 * Math.PI * u), b: 25 * Math.sin(4 * Math.PI * u), m: 1 });
const HOVER = (() => {
  let h = Infinity;
  for (let i = 1; i < 200; i++) {
    const u = i / 200;
    const w = Math.sin(Math.PI * u) ** 2;
    if (w < 0.02) continue;
    h = Math.min(h, (deepest({ ...together(u), z: 0 }) - 3) / w);
  }
  return Math.max(0, Math.min(h, TRAVEL.z));
})();
const STEPS = [
  { say: "The magazine comes out", dur: 2.2, to: { m: 0 } },
  { axis: "Y", say: "Y: the spindle travels to the magazine", dur: 2.6, to: { y: 0 } },
  { axis: "Z", say: "Z: down to the tools", dur: 1.2, to: { z: (s) => deepest(s) - 1 } },
  { axis: "Z", say: "Z: back up", dur: 1.0, to: { z: 0 } },
  { axis: "Y", say: "Y: back over the disc", dur: 2.6, to: { y: Y_DISC } },
  { say: "The magazine goes back behind its flap", dur: 2.2, to: { m: 1 } },
  { axis: "X", say: "X: the cradle comes forward, to the premill bar", dur: 2.0, to: { x: TRAVEL.x } },
  { axis: "X", say: "X: and goes back, to the disc's front edge", dur: 2.8, to: { x: 0 } },
  { axis: "X", say: "X: to the disc's centre", dur: 1.4, to: { x: X_DISC } },
  { axis: "Z", say: "Z: the bur comes down to the disc", dur: 2.0, to: { z: (s) => deepest(s) - 1 } },
  { axis: "Z", say: "Z: and back up", dur: 1.6, to: { z: 0 } },
  { axis: "A", say: "A: the holder turns all the way round", dur: 5.0, to: { a: 360 } },
  { axis: "B", say: "B: the cradle tilts", dur: 1.6, to: { b: SPEC.bLimit } },
  { axis: "B", say: "B: to the other limit", dur: 3.0, to: { b: -SPEC.bLimit } },
  { axis: "B", say: "B: and back", dur: 1.6, to: { b: 0 } },
  { axis: "all", say: "All five together", dur: 9.0, path: (u) => ({ ...together(u), z: HOVER * Math.sin(Math.PI * u) ** 2 }) },
  { say: "", dur: 1.2, to: {} },
];
// each step's starting state, worked out once
const STARTS = [];
{
  let s = { ...START };
  for (const step of STEPS) {
    STARTS.push(s);
    const next = { ...s };
    if (step.path) Object.assign(next, step.path(1));
    else for (const [key, v] of Object.entries(step.to)) next[key] = typeof v === "function" ? v(s) : v;
    if (Math.abs(next.a) >= 360) next.a = 0;
    s = next;
  }
}
export const TOUR_LEN = STEPS.reduce((sum, step) => sum + step.dur, 0);
export function tourAt(time) {
  let t = ((time % TOUR_LEN) + TOUR_LEN) % TOUR_LEN;
  let i = 0;
  while (i < STEPS.length - 1 && t >= STEPS[i].dur) t -= STEPS[i++].dur;
  const step = STEPS[i];
  const from = STARTS[i];
  const u = Math.min(1, t / step.dur);
  const s = { ...from };
  if (step.path) Object.assign(s, step.path(u));
  else for (const [key, v] of Object.entries(step.to)) { const to = typeof v === "function" ? v(from) : v; s[key] = from[key] + (to - from[key]) * ease(u); }
  s.a = wrap(s.a);
  return { ...s, axis: step.axis ?? null, say: step.say };
}
// the time the tour step running at `time` began, so a paused tour can resume from the start of its step
export function tourStepStart(time) {
  const t = ((time % TOUR_LEN) + TOUR_LEN) % TOUR_LEN;
  let start = 0;
  for (const step of STEPS) {
    if (t < start + step.dur) return start;
    start += step.dur;
  }
  return 0;
}
