// Truth model for Fig 2: the ARUM 5X-200's five axes. Pure, no DOM.
// Specs: arumdentistry.com/eng/solution/milling1.php (5X-200): 5 axes; travel 325 × 142.5 × 144 mm; A 360°, B ±30°;
// 15 tools Ø6 shank, DC 3.0 kW / 60,000 rpm spindle, Disk Cartridge (ARUM's term), mounting of 5 pre-milled blanks (P1–P5).
// Which part carries which axis is from the dealer: the cradle (with A and B) moves in and out (X), the spindle moves
// left and right and up and down (Z); the magazine comes out through a window behind a flap door hinged at its bottom.
// The 325 mm stroke is drawn on the spindle's left-right move (Y): it is the only stroke long enough to reach the magazine.
// Ø98.5 mm disc: assumed (the standard dental disc size); ARUM publishes none for the 5X-200. The dealer's photos give
// proportions only, so every size taken from them (holder 157 × 25, magazine grid) is scaled to this disc.
// Form: from the dealer's photos of a 5X-200 chamber, ARUM's product photos, and a video of a 5X-200 at work filmed for
// this figure (a tool change and a cradle tilt; styling illustrative, not traced). The video shows the magazine indexing
// by row (the spindle never moves front to back: the magazine slide brings the row under it), the tool-length sensor
// post at the left end of Y, the tall X carriage in a raised collar, and the head's proportions.

export const SPEC = { aRange: 360, bLimit: 30, tools: 15, shank: 6, rpm: 60000, kw: 3.0, disc: 98.5, premills: 5 };
// strokes in mm: X the cradle in and out, Y the spindle left and right, Z the spindle up and down
export const TRAVEL = { x: 142.5, y: 325, z: 144 };

// World: 1 unit = 1 mm, origin at the disc centre with every axis at 0; x right, y toward the operator, z up.
export const GEO = {
  HALF: 78.5, // holder: 157 square
  THICK: 12.5, // holder: 25 thick
  ARM_L: [-130, -94], // cradle: left (support) arm X span
  ARM_R: [110, 185], // cradle: right (A drive) housing X span, about half the holder's width across (video)
  BOSS_R: 33, // a rim of gold round the left cap, as in the dealer's photo 1
  WALL: [85, 105], // cradle back wall, distance back
  TOP: 52,
  WALL_Z0: -40,
  KNUCKLE: [105, 111], // B knuckle on the cradle's back wall, distance back
  TIP_Z: 112, // bur tip with Z at 0
  TOOL: 43, // bur stick-out below the nose ring
  COLLET: 26, // from the bur's tip up to the collet nut
  // the spindle's axis with Y at 0: over the tool-length sensor post, left of the magazine (the video's head parks
  // there, near the chamber's left wall)
  SPINDLE_X0: -262,
  // The spindle's line is 55 mm in front of the B axis, so the X stroke spans the work: X 0 puts the bur just past the
  // disc's front edge (+55), X 142.5 just past the premill bar at the back edge (−87.5), and X 55 over the disc centre.
  SPINDLE_Y: 55,
  // the back wall's face, behind the disc centre: with X at 0 the carriage's face is flush in its collar (video)
  WALL_Y: -117,
  FLOOR: -172,
  // magazine block in plan, out with its front row (R1) on the spindle's line; 3 columns × 5 rows on a 33 mm pitch
  MAG: { x: -244, y: -96, w: 100, d: 170, r: 3 },
  MAG_TOP: 18, // the block's top plate (its underside 50 below); the pocket collars stand 5 on it, the shanks 24 more
  PITCH: 33,
  MAG_STROKE: 211, // magazine travel from out (R1 under the spindle) to fully behind the flap
  // the tool-length sensor post: a 20 mm square bar on the spindle's line, its cap (Ø22) level with the magazine's top
  POST: { x: -262, y: 55, r: 11, top: 18 },
  // the X carriage through the back wall, behind the knuckle: as wide as the holder, from the floor to 22 mm above the
  // cradle's hat (the video: 20–30), its bristles included
  RAM: { x: [-77.5, 77.5], z: [-171, 86], len: 200 },
};
// Y at which the spindle is over the disc centre, X at which the disc centre is under the spindle, and the home they make
export const Y_DISC = -GEO.SPINDLE_X0;
export const X_DISC = GEO.SPINDLE_Y;
export const HOME = { x: X_DISC, y: Y_DISC, z: 0, a: 0, b: 0 };

export const wrap = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
export const clampB = (deg) => Math.max(-SPEC.bLimit, Math.min(SPEC.bLimit, deg));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The magazine and its flap move as one sequence, 0 (out, flap open flat) to 1 (in, flap shut). Going in, the block
// slides back over the open flap; once its front is behind the wall the flap swings up, overlapping the end of the
// slide (the video's flap takes about 0.2 s of a 1 s sequence; here it takes 0.4, so its swing can be followed).
// Coming out is the same run backwards.
const ease = (u) => u * u * (3 - 2 * u);
// the inverse of ease on [0, 1]
const uneased = (v) => 0.5 - Math.sin(Math.asin(1 - 2 * Math.max(0, Math.min(1, v))) / 3);
const FLAP_FROM = 0.6;
const SLIDE_TO = 0.67;
export const magOf = (m) => {
  const t = clamp(m, 0, 1);
  return { mag: GEO.MAG_STROKE * (1 - ease(clamp((SLIDE_TO - t) / SLIDE_TO, 0, 1))), flap: 90 * ease(clamp((t - FLAP_FROM) / (1 - FLAP_FROM), 0, 1)) };
};
// the sequence for a slide and a flap angle (for a pose set from outside, as a verification tool does)
export const mOf = ({ mag = GEO.MAG_STROKE, flap = 90 }) => (flap > 0 ? FLAP_FROM + (1 - FLAP_FROM) * uneased(flap / 90) : SLIDE_TO - SLIDE_TO * uneased(1 - mag / GEO.MAG_STROKE));
// The pockets: column c from the operator's left (1 … 3), row r from the front (1 … 5), in plan with the magazine out
// and its front row on the spindle's line. The slide indexes the block toward the operator by a row's pitch to bring
// row r under the spindle (row = r − 1), so the head reaches every pocket with Y and Z alone.
export const pocketAt = (c, r) => [GEO.MAG.x + GEO.MAG.w / 2 + (c - 2) * GEO.PITCH, GEO.SPINDLE_Y - (r - 1) * GEO.PITCH];
// the pockets never filled in the figure, and the two the tool change swaps: the last job's tool goes back into C1 R1,
// and the finishing bur comes out of C3 R4 (the video's own change)
export const POCKETS = { empty: ["1/2", "2/5", "3/5"], drop: "1/1", pick: "3/4" };
// heights: the pocket collars and the shanks' tops (tools stand shank up, 24 out)
export const SHANK_TOP = GEO.MAG_TOP + 5 + 24;

// ---------------------------------------------------------------- the axes' directions, shared with the scene
// X slides the cradle toward the operator; B tilts it about a front-to-back axis through the disc centre; A turns the
// holder in it about the left-right shaft (A rides on B); Y runs the spindle right, Z brings it down. build.mjs builds
// its groups from these, and the clearance model and the kinematics turn the holder with them.
export const AXES_DIR = { x: [0, 1, 0], b: [0, -1, 0], a: [1, 0, 0], y: [1, 0, 0], z: [0, 0, -1] };

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
// cylinders along x or y { c, axis, s: [s0, s1], r }; the ones the tests check by name carry one
const { HALF, THICK, ARM_L, ARM_R, BOSS_R, WALL, TOP, WALL_Z0, KNUCKLE, MAG, MAG_TOP, RAM, POST, SPINDLE_Y } = GEO;
const CRADLE = [
  { box: [ARM_L[0], ARM_L[1], -WALL[0], BOSS_R, -BOSS_R, BOSS_R] },
  { box: [ARM_L[0], ARM_L[1], -WALL[0], -8, BOSS_R, TOP] },
  { box: [ARM_R[0], ARM_R[1], -WALL[0], 35, -60, TOP] },
  { name: "cradle.wall", box: [ARM_L[0], ARM_R[1], -WALL[1], -WALL[0], WALL_Z0, TOP] },
  { box: [-45, 45, -WALL[1], -WALL[0], TOP, TOP + 12] },
  { cyl: { axis: 1, c: [0, 0], s: [-KNUCKLE[1], -KNUCKLE[0]], r: 34 } },
  { cyl: { axis: 0, c: [0, 0], s: [ARM_L[0] - 5, ARM_L[0]], r: 29.5 } },
  { cyl: { axis: 0, c: [0, 0], s: [ARM_L[1], ARM_L[1] + 6], r: 31.5 } },
  { cyl: { axis: 0, c: [0, 0], s: [91, ARM_R[0]], r: 35 } },
  // the A motor's white box on the right housing's outer face, on a short collar: it tilts with B
  { name: "cradle.motor", box: [ARM_R[1], 258, -22, 22, -33, 33] },
];
const HOLDER = [
  { name: "holder.plate", box: [-HALF, HALF, -HALF, HALF, -THICK, THICK] },
  { box: [HALF - 10, HALF - 1, -(HALF - 15), 40, THICK, THICK + 3] },
  { box: [-(HALF - 1), -(HALF - 10), -(HALF - 15), 40, THICK, THICK + 3] },
  { cyl: { axis: 0, c: [0, 0], s: [ARM_L[1] + 6, -HALF], r: 24 } },
  { cyl: { axis: 0, c: [0, 0], s: [HALF, 91], r: 29 } },
];
// the carriage rides X only (it does not tilt with B)
const RAM_BODY = { box: [RAM.x[0], RAM.x[1], -KNUCKLE[1] - RAM.len, -KNUCKLE[1], RAM.z[0], RAM.z[1]] };
// the magazine block with its tray, side bar and front fittings, and the shanks standing in its pockets
const MAGAZINE = { box: [MAG.x - 2, MAG.x + MAG.w + 5, MAG.y - 10, MAG.y + MAG.d + 11, MAG_TOP - 60, SHANK_TOP] };
// the sensor post and its cap, standing on the floor
const POST_BODY = { box: [POST.x - POST.r, POST.x + POST.r, POST.y - POST.r, POST.y + POST.r, GEO.FLOOR, POST.top] };
// the finishing bur (as ARUM's ZB-86: a Ø1.0 ball on a neck widening to Ø1.8 at its 20 mm reach, then the taper to the
// Ø6 shank): height above the tip and radius, mm, as drawn (the ball's shoulder point drawn round)
export const BUR = [[0, 0], [0.25, 0.43, 1], [0.5, 0.5], [2, 0.55], [20, 0.9], [23.5, 3]];
export const burRadius = (h) => {
  for (let i = 1; i < BUR.length; i++) { const [h0, r0] = BUR[i - 1]; const [h1, r1] = BUR[i]; if (h <= h1) return r0 + ((r1 - r0) * Math.max(0, h - h0)) / (h1 - h0); }
  return BUR[BUR.length - 1][1];
};
// the coolant nozzles: on each side a black upright block under the head box ends in a swivel eye, from which a Ø5
// tube and a flat Ø10 tip aim in and down at the tool (the video: swivels about 54 mm out, tips about 30 mm from the
// axis, aimed 20–30 mm below the nose ring). Shared with the drawing: the eye's centre (dx, dy, height above the tip)
// and the aim point's height, and the tube's and the tip's spans along the aim from the eye.
export const NOZZLE = { dx: 54, dy: 33, h: 80, aim: 18, tube: [4, 29], tip: [29, 36], r: [2.5, 5], eye: 6.5 };
// the spindle's underside, from the bur tip up: footprint (circle about the spindle axis, or a box relative to it) and its
// height above the tip. A safety envelope, as a CAM keeps round the head: it covers everything drawn, stepped to follow
// the nozzles' tubes
const nozzleRects = [
  { rect: [27, 41, 14, 29], zb: 51 }, // tip
  { rect: [41, 46, 21, 33], zb: 61 }, // tube
  { rect: [46, 50, 25, 39], zb: 67 }, // tube
  { rect: [50, 61, 26, 41], zb: 71.5 }, // tube's start and the swivel eye
];
export const HEAD = [
  { r: 3, zb: 0 }, // bur
  { r: 7.5, zb: GEO.COLLET }, // collet nut and shaft
  { r: 19, zb: 43 }, // nose ring
  { r: 32.5, zb: 50 }, // nose
  { r: 42.5, zb: 68 }, // flange
  { rect: [-42, 42, -46, 36], zb: 84 }, // the gold plate under the head box
  ...nozzleRects,
  ...nozzleRects.map(({ rect: [x0, x1, y0, y1], zb }) => ({ rect: [-x1, -x0, y0, y1], zb })),
  { rect: [-69, 69, -125, 40], zb: 91 }, // head box and its side plates, back to the column
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
    return { name: shape.name, kind: "box", c, e, h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], corners };
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
  return { name: shape.name, kind: "cyl", p0, u, len: s1 - s0, r, corners };
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

// every stand-in placed for a pose { x, b, a, mag, row } (row: how many rows the magazine is indexed toward the operator)
export function bodiesOf(pose) {
  const t = [0, pose.x ?? 0, 0];
  const Mb = rot(AXES_DIR.b, pose.b ?? 0);
  const Ma = partRotation(pose.a ?? 0, pose.b ?? 0);
  const eye = rot([1, 0, 0], 0);
  const out = [...CRADLE.map((s) => ({ ...placed(s, Mb, t), group: "b" })), ...HOLDER.map((s) => ({ ...placed(s, Ma, t), group: "a" })), { ...placed(RAM_BODY, eye, t), group: "x" }];
  out.push({ ...placed(MAGAZINE, eye, [0, -(pose.mag ?? 0) + GEO.PITCH * (pose.row ?? 0), 0]), group: "mag" });
  out.push({ ...placed(POST_BODY, eye, [0, 0, 0]), group: "post" });
  for (const body of out) body.ext = extentOf(body);
  return out;
}

// the lowest the bur tip may come with the spindle at Y = y, with CLEAR mm between every part of the head and anything
// under it; and the Z it allows (0 … TRAVEL.z, down)
export function tipFloor(pose, y, bodies = bodiesOf(pose), parts = HEAD) {
  const sx = GEO.SPINDLE_X0 + y;
  let floor = -Infinity;
  for (const part of parts) {
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

// ---------------------------------------------------------------- five-axis kinematics
// The holder frame turns with A inside the cradle, and the cradle tilts with B: holder → world is B's rotation after
// A's, then the cradle's X slide (as bodiesOf).
export const partRotation = (a, b) => mulM(rot(AXES_DIR.b, b), rot(AXES_DIR.a, a));
export const toWorld = (s, p) => { const q = mul(partRotation(s.a, s.b), p); const X = AXES_DIR.x; return [q[0] + s.x * X[0], q[1] + s.x * X[1], q[2] + s.x * X[2]]; };
// The machine position that puts the bur tip on p (holder frame, mm) with the tool along t (unit, holder frame, from the
// tip toward the spindle). The spindle never tilts, so A and B turn t upright: R(A, B)·t = ẑ gives t = (sin B,
// cos B sin A, cos B cos A); then X, Y and Z bring the tip to the turned point.
export function axesFor(p, t) {
  const b = (Math.asin(Math.max(-1, Math.min(1, t[0]))) * 180) / Math.PI;
  const a = (Math.atan2(t[1], t[2]) * 180) / Math.PI;
  const w = mul(partRotation(a, b), p);
  return { x: GEO.SPINDLE_Y - w[1], y: w[0] - GEO.SPINDLE_X0, z: GEO.TIP_Z - w[2], a, b };
}
// where the bur tip is, in the holder frame, and which way the tool points there, for a machine position
export function tipIn(s) {
  const M = partRotation(s.a, s.b);
  // the tip in the cradle's frame before X: where Y and Z put it, less the cradle's X slide
  const Y = AXES_DIR.y;
  const Z = AXES_DIR.z;
  const X = AXES_DIR.x;
  const tip = [0, 1, 2].map((k) => [GEO.SPINDLE_X0, GEO.SPINDLE_Y, GEO.TIP_Z][k] + s.y * Y[k] + s.z * Z[k] - s.x * X[k]);
  const inv = (v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
  return { p: inv(tip), t: inv([0, 0, 1]) };
}

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

// ---------------------------------------------------------------- the part: a full-arch screw-retained bridge
// Disc frame: origin at the centre of face B (the face up at A = 0), x to the machine's right, y toward the operator; a
// point at depth d below face B is (x, y, THICK − d) in the holder frame. The bridge is maxillary, occlusal side up, its
// incisors toward the operator. Roughing is done (both sides), so the bridge stands in a channel cut through the disc,
// held by connectors; the figure shows the 5-axis finishing of its top side.
export const BRIDGE = {
  // green (pre-sintered) enlargement: the part is milled about 20% large and shrinks when sintered
  ef: 1.2,
  // one side, mesial to distal: tooth, mesiodistal and buccolingual crown widths as sintered (mm)
  teeth: [["central incisor", 8.5, 7.0], ["lateral incisor", 6.5, 6.0], ["canine", 7.5, 8.0], ["first premolar", 7.0, 9.0], ["second premolar", 7.0, 9.0], ["first molar", 10.0, 11.0]],
  arch: { A: 0.02111, B: 8.0e-8 }, // the crowns' centre line as sintered, y = −(A·x² + B·x⁶) (mm)
  top: 1.5, // the highest cusp, below face B
  base: 22, // the bridge's underside (the intaglio side), below face B
  flange: [0.8, 1.8], // the gingival flange beyond the crowns as milled: buccal, palatal
  gap: 2.7, // the channel round the bridge: the Ø2.0 roughing ball plus 0.7 (hyperDENT's milling boundary)
  ball: 0.5, // finishing bur: Ø1.0 ball end (ARUM ZB-86, 20 mm reach)
  connector: { w: 2.8 }, // Ø2.8 at the part, at its equator
  // screw access (All-on-4): tooth index, how far palatal of the centre line the channel opens (mm), its axis tilt from
  // the disc's normal toward palatal and toward distal (deg), and its diameter as milled
  implants: [
    { tooth: 1, off: -2.5, palatal: 10, distal: 0 },
    { tooth: 4, off: -0.4, palatal: 6, distal: 14 },
  ],
  channel: 3.2,
};
// The crowns' centre line as sintered: y = −(A·x² + B·x⁶) from the incisal contact (a polynomial arch form fitted to
// typical maxillary tooth widths), milled EF larger; laid out by arc length from the midline
const ARCH = (() => {
  const { A, B } = BRIDGE.arch;
  const ef = BRIDGE.ef;
  const N = 3000;
  const X = 48;
  const yOf = (x) => -ef * (A * (x / ef) ** 2 + B * (x / ef) ** 6);
  const table = [[0, 0]];
  let s = 0;
  for (let i = 1; i <= N; i++) {
    const x0 = (X * (i - 1)) / N;
    const x1 = (X * i) / N;
    s += Math.hypot(x1 - x0, yOf(x1) - yOf(x0));
    table.push([x1, s]);
  }
  const ends = [0];
  for (const [, md] of BRIDGE.teeth) ends.push(ends[ends.length - 1] + md * ef);
  return { table, ends, L: ends[ends.length - 1], yOf, slope: (x) => -ef * ((2 * A * x) / ef ** 2 + (6 * B * x ** 5) / ef ** 6) };
})();
// x at arc length s along the centre line
const xAt = (s) => {
  const a = Math.abs(s);
  const t = ARCH.table;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid][1] < a) lo = mid; else hi = mid; }
  const k = (a - t[lo][1]) / (t[hi][1] - t[lo][1] || 1);
  return Math.sign(s) * (t[lo][0] + (t[hi][0] - t[lo][0]) * k);
};
// buccolingual width along the arch: each tooth's width at its centre, eased between neighbours
const BL = (() => {
  const centres = BRIDGE.teeth.map(([, , bl], i) => [(ARCH.ends[i] + ARCH.ends[i + 1]) / 2, bl * BRIDGE.ef]);
  return (s) => {
    const a = Math.abs(s);
    if (a <= centres[0][0]) return centres[0][1];
    for (let i = 1; i < centres.length; i++) {
      if (a <= centres[i][0]) {
        const u = (a - centres[i - 1][0]) / (centres[i][0] - centres[i - 1][0]);
        const k = u * u * (3 - 2 * u);
        return centres[i - 1][1] + (centres[i][1] - centres[i - 1][1]) * k;
      }
    }
    return centres[centres.length - 1][1];
  };
})();
// the arch placed in the disc: its extent (with the channel) centred front to back
// the bridge ends this far past the first molars' distal contacts, squared off with rounded corners
export const CAP = 2.2;
// placed so the channel's outer wall is as far inside the clamp ring as it can be (worked out below, once the outline can be drawn)
let Y0 = 0;
// centre-line point, unit tangent (toward +s) and buccal normal at s; past either end it carries straight on
export function archAt(s) {
  const L = ARCH.L;
  const x = xAt(Math.max(-L, Math.min(L, s)));
  const p = [x, Y0 + ARCH.yOf(Math.abs(x))];
  const k = ARCH.slope(Math.abs(x)) * Math.sign(x);
  const l = Math.hypot(1, k);
  const t = [1 / l, k / l];
  const over = Math.abs(s) - L;
  if (over > 0) { p[0] += t[0] * over * Math.sign(s); p[1] += t[1] * over * Math.sign(s); }
  return { p, t, n: [-t[1], t[0]] };
}
export const halfWidths = (s, grow = 0) => { const h = BL(s) / 2; return [h + BRIDGE.flange[0] + grow, h + BRIDGE.flange[1] + grow]; };
const at2 = (c, o) => [c.p[0] + o * c.n[0], c.p[1] + o * c.n[1]];
// a closed outline of the band round the arch, grown by `grow` (the channel's outer wall is the bridge grown by the
// gap), with round ends; returned with the arc position along the arch of each point (for the finishing reveal)
export function bandOutline(grow = 0, step = 0.6) {
  // the end sits CAP + grow past the last contact (inside it, for an inset outline), its corners rounded with radius r;
  // the sides run to where the corners begin
  const [hbL, hlL] = halfWidths(ARCH.L, grow);
  const end = CAP + grow;
  const r = Math.max(0.5, Math.min(Math.max(end, 0.5), (hbL + hlL) / 2));
  const L = ARCH.L + Math.min(0, end - r);
  // how far the end reaches past where the sides stop
  const reach = end - Math.min(0, end - r);
  const pts = [];
  const sOf = [];
  const side = [];
  const n = Math.ceil((2 * L) / step);
  for (let i = 0; i <= n; i++) { const s = -L + (2 * L * i) / n; const c = archAt(s); pts.push(at2(c, halfWidths(s, grow)[0])); sOf.push(s); side.push(1); }
  // the distal ends: square across, with rounded corners
  const cap = (s, dir) => {
    const [hb, hl] = halfWidths(s, grow);
    const at = (a, o) => { const c = archAt(s + dir * a); return [c.p[0] + o * c.n[0], c.p[1] + o * c.n[1]]; };
    const m = 6;
    // round the buccal corner, across, round the palatal corner; the −L end is the same list run backwards
    const list = [];
    for (let j = 0; j <= m; j++) { const th = (j / m) * (Math.PI / 2); list.push([reach - r + r * Math.sin(th), hb - r + r * Math.cos(th)]); }
    for (let j = 0; j <= m; j++) { const th = Math.PI / 2 + (j / m) * (Math.PI / 2); list.push([reach - r + r * Math.sin(th), -hl + r + r * Math.cos(th)]); }
    for (const [a, o] of dir > 0 ? list : list.reverse()) { pts.push(at(a, o)); sOf.push(s); side.push(0); }
  };
  cap(L, 1);
  for (let i = n; i >= 0; i--) { const s = -L + (2 * L * i) / n; const c = archAt(s); pts.push(at2(c, -halfWidths(s, grow)[1])); sOf.push(s); side.push(-1); }
  cap(-L, -1);
  // drop points that repeat the one before (where a round corner starts exactly at a side's end)
  const keep = pts.map((p, k) => { const q = pts[(k + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6; });
  return { pts: pts.filter((_, k) => keep[k]), s: sOf.filter((_, k) => keep[k]), side: side.filter((_, k) => keep[k]) };
}
Y0 = (() => {
  const pts = bandOutline(BRIDGE.gap, 1.2).pts;
  let best = 0;
  let bestR = Infinity;
  for (let dy = -30; dy <= 30; dy += 0.05) {
    const r = Math.max(...pts.map((p) => Math.hypot(p[0], p[1] + dy)));
    if (r < bestR) { bestR = r; best = dy; }
  }
  return Math.round(best * 100) / 100;
})();
export const OUTLINE = bandOutline(0);
export const OPENING = bandOutline(BRIDGE.gap, 1.2);
// the teeth: their outlines on the occlusal face, each a rounded box in (along the arch, across it)
export const TEETH = [];
for (const side of [1, -1]) {
  BRIDGE.teeth.forEach(([name, md0, bl0], i) => {
    const md = md0 * BRIDGE.ef;
    const bl = bl0 * BRIDGE.ef;
    const s0 = ARCH.ends[i] + 0.15;
    const s1 = ARCH.ends[i + 1] - 0.15;
    const r = 0.38 * Math.min(md, bl);
    const box = [];
    const corner = (cs, co, a0) => { for (let j = 0; j <= 5; j++) { const a = a0 + (j / 5) * (Math.PI / 2); box.push([cs + r * Math.cos(a), co + r * Math.sin(a)]); } };
    const h = bl / 2 - 0.2;
    corner(s1 - r, h - r, 0);
    corner(s0 + r, h - r, Math.PI / 2);
    corner(s0 + r, -h + r, Math.PI);
    corner(s1 - r, -h + r, (3 * Math.PI) / 2);
    const outline = box.map(([ss, o]) => at2(archAt(side * ss), o));
    TEETH.push({ name, side, index: i, s: [side * s0, side * s1], bl, md, outline });
  });
}
// screw channels: where each opens on the occlusal face, and its axis (unit, disc frame, out of the face)
export const CHANNELS = [];
for (const side of [1, -1]) {
  for (const im of BRIDGE.implants) {
    const s = side * (ARCH.ends[im.tooth] + ARCH.ends[im.tooth + 1]) / 2;
    const c = archAt(s);
    const p = at2(c, im.off);
    const pal = (im.palatal * Math.PI) / 180;
    const dis = (im.distal * Math.PI) / 180;
    // tilt toward palatal (−n) and toward distal (away from the midline along the arch: +t·side)
    const v = [-c.n[0] * Math.tan(pal) + side * c.t[0] * Math.tan(dis), -c.n[1] * Math.tan(pal) + side * c.t[1] * Math.tan(dis), 1];
    const l = Math.hypot(...v);
    CHANNELS.push({ s, p, axis: v.map((x) => x / l), tooth: BRIDGE.teeth[im.tooth][0], side });
  }
}
CHANNELS.sort((u, v) => u.s - v.s);
// connectors at the bridge's equator, from its wall across the channel: one per unit, alternating buccal and palatal,
// and both sides of each distal end
export const CONNECTORS = (() => {
  const out = [];
  const eq = (BRIDGE.top + BRIDGE.base) / 2;
  const w = BRIDGE.connector.w / 2;
  const add = (s, wall) => {
    const c = archAt(s);
    const [hb, hl] = halfWidths(s);
    const o0 = wall > 0 ? hb - 0.4 : -(hl - 0.4);
    const o1 = wall > 0 ? hb + BRIDGE.gap + 0.4 : -(hl + BRIDGE.gap + 0.4);
    const q = (o, a) => [c.p[0] + o * c.n[0] + a * c.t[0], c.p[1] + o * c.n[1] + a * c.t[1]];
    out.push({ s, wall, quad: [q(o0, -w), q(o1, -w), q(o1, w), q(o0, w)], depth: [eq - w, eq + w] });
  };
  for (const side of [1, -1]) {
    BRIDGE.teeth.forEach((_, i) => { if (i < 5) add(side * (ARCH.ends[i] + ARCH.ends[i + 1]) / 2, i % 2 === 0 ? 1 : -1); });
    add(side * (ARCH.L - 1.8), 1);
    add(side * (ARCH.L - 1.8), -1);
  }
  return out.sort((u, v) => u.s - v.s);
})();

// ---------------------------------------------------------------- jog: the reader moves the axes (live.js drives these)
// how far down the head may come in a state, with the magazine at m and indexed `row` rows out (−1: it would not fit
// even at the top)
export const roomAt = (s, m, row = s.row ?? 0) => zLimit({ x: s.x, b: s.b, a: s.a, mag: magOf(m).mag, row }, s.y);
// The magazine comes out while the spindle is over it (or over the sensor post beside it), and goes back in when it
// leaves; it comes out only with the cradle level, and the cradle tilts only with it in (an interlock: the cradle's
// left end swings down beside the magazine's path)
const LEVEL = 0.5;
export const magFor = (y, b = 0) => (y < 125 && Math.abs(b) <= LEVEL ? 0 : 1);
const fitsAt = (s) => roomAt(s, 0, 0) >= 0 && roomAt(s, 1, 0) >= 0;
// into jog from wherever the job left the head: if the bur is in the part, the first request is the same pose lifted
// clear, and the head rises to it before anything else moves
export function jogEnter(cur) {
  const room = Math.max(0, roomAt(cur, cur.m));
  return { lifting: cur.z > room + 0.01, want: { x: cur.x, y: cur.y, z: Math.min(cur.z, room), a: cur.a, b: cur.b }, mWant: magFor(cur.y, cur.b) };
}
// the reader asks for a value on one axis: kept to its travel (A turns all the way round), stopped short of anything
// the move would hit, and Z kept to the room the new pose allows with the magazine either way
export function jogRequest(want, key, value, lo, hi) {
  let to = key === "a" ? value : Math.max(lo, Math.min(hi, value));
  const test = (v) => fitsAt({ ...want, [key]: v });
  if (key !== "z" && !test(to)) {
    let ok = want[key];
    let bad = to;
    for (let i = 0; i < 12; i++) { const mid = (ok + bad) / 2; if (test(mid)) ok = mid; else bad = mid; }
    to = ok;
  }
  const next = { ...want, [key]: to };
  next.z = Math.max(0, Math.min(next.z, Math.max(0, Math.min(roomAt(next, 0, 0), roomAt(next, 1, 0)))));
  return next;
}
// One frame of jog. j: { cur, want, mWant, lifting }; k: how much of the way to the request this frame eases;
// mStep: how far the magazine's sequence runs (its row index runs four times as fast: three rows in 0.75 s). The head
// never goes inside anything: it is lifted when the state needs it (the request stands, so it comes back down once
// there is room), and stops when even the top is not clear.
export function jogStep(j, k, mStep) {
  const c = j.cur;
  let want = j.want;
  let lifting = j.lifting;
  let changed = false;
  // rising out of a cut: only Z moves, and only up to the room at the pose it is held in, until the head is clear; a key
  // pressed meanwhile waits (a request is kept to the room at its own pose, which may let it go deeper)
  const wz = lifting ? Math.min(want.z, Math.max(0, roomAt(c, c.m))) : want.z;
  let next = { x: c.x + (want.x - c.x) * k, y: c.y + (want.y - c.y) * k, z: c.z + (wz - c.z) * k, a: wrap(c.a + wrap(want.a - c.a) * k), b: c.b + (want.b - c.b) * k, m: c.m, row: c.row ?? 0 };
  // close enough: land on the target (Z on the one it is easing to)
  for (const key of ["x", "y", "b"]) if (Math.abs(want[key] - next[key]) < 0.01) next[key] = want[key];
  if (Math.abs(wz - next.z) < 0.01) next.z = wz;
  if (Math.abs(wrap(want.a - next.a)) < 0.01) next.a = want.a;
  if (lifting) { next.x = c.x; next.y = c.y; next.a = c.a; next.b = c.b; }
  // the cradle stays level while the magazine is out of its bay
  if (c.m < 1 && Math.abs(next.b) > LEVEL) next.b = c.b;
  // too low for where the other axes are taking it this frame: only Z moves, up to the room there, before anything goes
  // sideways (else the head would pass through what it then clears)
  if (!lifting) {
    const across = roomAt(next, next.m);
    if (across >= 0 && c.z > across + 0.01) {
      const zt = Math.min(wz, across);
      const z = c.z + (zt - c.z) * k;
      next = { ...next, x: c.x, y: c.y, a: c.a, b: c.b, z: Math.abs(zt - z) < 0.01 ? zt : z };
    }
  }
  // the magazine runs its sequence at its own pace, and only moves once the head is clear of its path: first back to its
  // front row (if the job left it indexed), then in or out (out only with the cradle level)
  const clearFor = (room) => { want = { ...want, z: Math.min(want.z, Math.max(0, room)) }; changed = true; };
  // (with the cradle off level the magazine goes in whatever was asked, so the cradle can then level or tilt on)
  const mGoal = Math.abs(next.b) > LEVEL ? 1 : j.mWant;
  if (next.row > 0) {
    const r2 = Math.max(0, next.row - 4 * mStep);
    const room = roomAt(next, next.m, r2);
    if (room >= next.z) next.row = r2;
    else clearFor(room);
  } else if (next.m !== mGoal) {
    const m2 = mGoal < next.m ? Math.max(mGoal, next.m - mStep) : Math.min(mGoal, next.m + mStep);
    const room = roomAt(next, m2);
    if (room >= next.z) next.m = m2;
    else clearFor(room);
  }
  const room = roomAt(next, next.m);
  if (room < 0) {
    want = { x: c.x, y: c.y, z: c.z, a: c.a, b: c.b };
    next = { ...c, row: c.row ?? 0 };
    changed = true;
  } else if (lifting) {
    // rising out of the cut: clamped again once it is clear
    if (next.z <= room + 0.01) lifting = false;
  } else if (next.z > room) next.z = Math.max(0, room);
  const busy = !(next.x === want.x && next.y === want.y && Math.abs(next.z - Math.min(want.z, Math.max(0, room))) < 0.01 && next.a === want.a && next.b === want.b && next.m === j.mWant && next.row === 0);
  return { cur: next, want, lifting, changed, busy };
}

// ---------------------------------------------------------------- the finishing simulation
// One pass of each kind, thinned for clarity (a zig-zag every few millimetres, one contour round each wall, where the
// machine steps about 0.1 mm): the occlusal surface with the tool nearly upright, then the buccal and the palatal wall
// with the tool leaning out from the wall along the outline's normal. The spindle never tilts, so A and B tilt the disc
// to the tool: at the incisors the lean is on A, at the molars on B, and between them both share it and change together.
// The screw channels are indexed jobs of their own (3+2, not simultaneous), shown already finished.
const toHolder = (p2, depth) => [p2[0], p2[1], GEO.THICK - depth];
const tiltOf = (dir2, deg) => { const r = (deg * Math.PI) / 180; return [Math.sin(r) * dir2[0], Math.sin(r) * dir2[1], Math.cos(r)]; };
const LEAN = { occlusal: 3, wall: 15 };
// The wall pass runs one contour 3.3 mm below the cusps: deeper, the 15° lean would bring the bur's neck against the
// channel's outer wall (the channel is only the roughing ball's width; a drafted channel would not fit the disc)
const WALL_DEPTH = BRIDGE.top + 3.3;
export const ARCH_L = ARCH.L;
const L = ARCH.L;
// tip for a ball-end bur touching a point with outward normal n (3D), the tool along t: centre = point + r·n, tip = centre − r·t
const tipFor = (q, n, t) => { const r = BRIDGE.ball; return [q[0] + r * n[0] - r * t[0], q[1] + r * n[1] - r * t[1], q[2] + r * n[2] - r * t[2]]; };
// the occlusal pass runs over the square distal ends and 1.1 mm past them, over the channel
export const OCC_SPAN = [-L - CAP - 1.1, L + CAP + 1.1];
const occlusalAt = (u) => {
  const s = OCC_SPAN[0] + u * (OCC_SPAN[1] - OCC_SPAN[0]);
  const c = archAt(s);
  const [hb, hl] = halfWidths(Math.max(-L, Math.min(L, s)));
  // across the occlusal table and back, normal to the arch, about every 5 mm along it; narrowing to nothing past the end
  const over = Math.max(0, Math.abs(s) - L - CAP + 2);
  const rho = (hb + hl) / 2;
  const amp = (rho - BRIDGE.flange[1] - 1.1) * Math.max(0, 1 - over / 3.1);
  const o = (hb - hl) / 2 + amp * Math.sin((2 * Math.PI * (s + L)) / 5);
  const p = at2(c, o);
  // cusps and fossae: the cusp lines at the top, the surface dipping 1.2 mm to the fossa in the middle of the table
  const mid = (hb - hl) / 2;
  const depth = BRIDGE.top + (1.2 * (1 + Math.cos((Math.PI * (o - mid)) / Math.max(1, amp)))) / 2;
  // nearly upright on the tops, within hyperDENT's few degrees for cycles without undercuts
  const t = tiltOf([-c.t[0], -c.t[1]], LEAN.occlusal);
  return { p: tipFor(toHolder(p, depth), [0, 0, 1], t), t, s };
};
// how far down the head may come when only the parts above the bur count (the bur itself cuts the part)
const ABOVE_BUR = HEAD.filter((part) => part.zb >= 26);
export const upperRoom = (s) => GEO.TIP_Z - tipFloor({ x: s.x, b: s.b, a: s.a, mag: magOf(s.m ?? 1).mag, row: s.row ?? 0 }, s.y, undefined, ABOVE_BUR);
const CLEAR_HEAD = 2;
// The two wall passes follow the bridge's outline: the buccal pass from the left distal end round the front to the
// right one and on round that end; the palatal pass back from there round the inside and on round the left end. So
// each distal end is finished by the pass that ends there. Each path: contact points on the wall, outward normals, and
// arc length along it.
const WALL_PATHS = (() => {
  const pts = OUTLINE.pts;
  const n = pts.length;
  const firstPalatal = OUTLINE.side.indexOf(-1);
  // outward normal at each vertex: the average of its two edges' normals (the outline runs clockwise, interior right)
  const area = pts.reduce((a, p, k) => { const q = pts[(k + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  const edgeN = pts.map((p, k) => { const q = pts[(k + 1) % n]; const ex = q[0] - p[0]; const ey = q[1] - p[1]; const l = Math.hypot(ex, ey) || 1; return area > 0 ? [ey / l, -ex / l] : [-ey / l, ex / l]; });
  const vertN = pts.map((_, k) => { const a = edgeN[(k + n - 1) % n]; const b = edgeN[k]; const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1; return [(a[0] + b[0]) / l, (a[1] + b[1]) / l]; });
  const path = (from, to) => {
    const idx = [];
    for (let k = from; k !== to; k = (k + 1) % n) idx.push(k);
    idx.push(to);
    const len = [0];
    for (let k = 1; k < idx.length; k++) len.push(len[k - 1] + Math.hypot(pts[idx[k]][0] - pts[idx[k - 1]][0], pts[idx[k]][1] - pts[idx[k - 1]][1]));
    return { idx, len, total: len[len.length - 1] };
  };
  return { buccal: path(0, firstPalatal), palatal: path(firstPalatal, 0), pts, vertN };
})();
// for each edge of the outline (point k to point k + 1), the pass that finishes it and how far along that pass its
// far end is (0 … 1), for the drawing's finished walls
export const WALL_REACH = (() => {
  const n = OUTLINE.pts.length;
  const pass = new Array(n).fill(null);
  const at = new Array(n).fill(1);
  for (const kind of ["buccal", "palatal"]) {
    const w = WALL_PATHS[kind];
    for (let j = 0; j + 1 < w.idx.length; j++) { pass[w.idx[j]] = kind; at[w.idx[j]] = w.len[j + 1] / w.total; }
  }
  return { pass, at };
})();
// a point on a wall path at arc length a: the contact point and the outward normal, both interpolated
const wallContact = (kind, a) => {
  const w = WALL_PATHS[kind];
  const t = Math.max(0, Math.min(w.total, a));
  let j = 1;
  while (j < w.len.length - 1 && w.len[j] < t) j++;
  const k = (t - w.len[j - 1]) / (w.len[j] - w.len[j - 1] || 1);
  const p0 = WALL_PATHS.pts[w.idx[j - 1]];
  const p1 = WALL_PATHS.pts[w.idx[j]];
  const n0 = WALL_PATHS.vertN[w.idx[j - 1]];
  const n1 = WALL_PATHS.vertN[w.idx[j]];
  const nx = n0[0] + (n1[0] - n0[0]) * k;
  const ny = n0[1] + (n1[1] - n0[1]) * k;
  const l = Math.hypot(nx, ny) || 1;
  return { q: [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k], n: [nx / l, ny / l] };
};
const wallPoint = (kind, a, lean) => {
  const { q, n } = wallContact(kind, a);
  const t = tiltOf(n, lean);
  return { p: tipFor(toHolder(q, WALL_DEPTH), [n[0], n[1], 0], t), t, s: a };
};
// The lean on the walls: 15° where the head is clear, eased where tilting the cradle that far would bring a part of it
// inside the head's safety envelope (HEAD), as a CAM program limits the tilt to keep its clearance round the head.
// With the head and cradle in the video's proportions (the drive hub Ø70, the nozzles' tips tucked in under the
// flange, the carriage's top clear under the head box) it never needs to: the lean is 15° all the way
// round, and the tests hold it there, so a change that brings the easing back must be described. Worked out on a
// 0.25 mm grid with 3 mm of room to spare, then the least lean within 6 mm either side, blended, so the tilt changes
// gently; the build writes the table into the page, so it is not worked out again on load.
const LEAN_STEP = 0.25;
// LEANS:begin
const LEANS = (() => {
  const out = {};
  for (const kind of ["buccal", "palatal"]) {
    const total = WALL_PATHS[kind].total;
    const count = Math.ceil(total / LEAN_STEP);
    const grid = [];
    for (let i = 0; i <= count; i++) {
      const a = (total * i) / count;
      const fits = (lean) => { const q = wallPoint(kind, a, lean); const ax = axesFor(q.p, q.t); return upperRoom(ax) - ax.z >= CLEAR_HEAD + 1; };
      let ok = 0;
      let bad = LEAN.wall;
      if (fits(bad)) ok = bad;
      else for (let k = 0; k < 9; k++) { const mid = (ok + bad) / 2; if (fits(mid)) ok = mid; else bad = mid; }
      grid.push(ok);
    }
    const W = Math.round(6 / LEAN_STEP);
    const low = grid.map((_, i) => { let m = Infinity; for (let j = Math.max(0, i - W); j <= Math.min(grid.length - 1, i + W); j++) m = Math.min(m, grid[j]); return m; });
    out[kind] = low.map((_, i) => { let sum = 0; let w = 0; for (let j = -W; j <= W; j++) { const v = low[Math.max(0, Math.min(low.length - 1, i + j))]; const k = Math.cos((j / (W + 1)) * (Math.PI / 2)) ** 2; sum += v * k; w += k; } return Math.round((sum / w) * 1000) / 1000; });
  }
  return out;
})();
// LEANS:end
export const leansTable = () => LEANS;
const leanAt = (kind, a) => {
  const g = LEANS[kind];
  const f = Math.max(0, Math.min(g.length - 1, (a / WALL_PATHS[kind].total) * (g.length - 1)));
  const i = Math.floor(f);
  return g[i] + ((g[Math.min(g.length - 1, i + 1)]) - g[i]) * (f - i);
};
const wallAt = (u, kind) => {
  const a = u * WALL_PATHS[kind].total;
  return wallPoint(kind, a, leanAt(kind, a));
};
// passes in order: kind, readout line, duration, tip and tool along u ∈ [0, 1]
const PASSES = [
  { kind: "occlusal", say: "Occlusal surface · nearly upright, 3°", dur: 12, at: occlusalAt },
  { kind: "buccal", say: "Buccal wall and right end · leaning out 15°", dur: 10, at: (u) => wallAt(u, "buccal") },
  { kind: "palatal", say: "Palatal wall and left end · leaning out 15°", dur: 10, at: (u) => wallAt(u, "palatal") },
];
// each pass's tool path as the tip's track across the disc (disc frame, mm), for the part view
export const PASS_TRACKS = PASSES.map((pass) => {
  const pts = [];
  const n = Math.round(pass.dur * 40);
  for (let i = 0; i <= n; i++) { const q = pass.at(i / n); pts.push([q.p[0], q.p[1]]); }
  return { kind: pass.kind, pts };
});
// clearance plane for moves between passes: the tip 6 mm above face B, along the tool
const SAFE = 6;
const lift = (q) => {
  const k = (GEO.THICK + SAFE - q.p[2]) / q.t[2];
  return { p: [q.p[0] + k * q.t[0], q.p[1] + k * q.t[1], q.p[2] + k * q.t[2]], t: q.t };
};
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerpAxes = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, a: a.a + wrap(b.a - a.a) * k, b: a.b + (b.b - a.b) * k });
// the timeline: from home, the tool change, then down into each pass and up out of it, with a move between passes at a
// raised Z
const LINK = 1.2;
// a move's time: X and Y at no more than about 95 mm/s at their fastest, and Z climbing in the first 35% and coming
// down in the last 35% at no more than 90 mm/s (the 5X-200-class rapid is about 100 mm/s)
const moveTime = (from, via, to) => Math.max(LINK, (1.6 * Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))) / 100, (1.6 * Math.max(Math.abs(via.z - from.z), Math.abs(to.z - via.z))) / (0.35 * 90));
// a straight move along one axis, as fast
const dipTime = (from, to) => Math.max(0.5, (1.6 * Math.max(Math.abs(to.y - from.y), Math.abs(to.z - from.z))) / 100);
const DIP = 0.5;
// The tool change, as in the video: the magazine comes out to its front row while the head is still over the work; the
// head returns the last job's tool to C1 R1, rises, and crosses at a safe height while the magazine indexes three rows
// out to bring R4 under it; it takes the finishing bur from C3 R4, then touches it down on the sensor post to measure
// its length while the magazine indexes back. The magazine goes back in as the head rises off the sensor.
const TOOL = { kind: "tool", say: "Tool change" };
// heights of the tip (above the disc centre) for the change: crossing over the magazine, at a pocket (the collet 5 mm
// above the shank's top: the swap itself is drawn as the tool passing between pocket and collet), and over the post
const CROSS_Z = 40;
const SWAP_Z = GEO.TIP_Z - (SHANK_TOP + 5 - GEO.COLLET);
const TOUCH_Z = GEO.TIP_Z - POST.top;
const overPocket = (c, z) => ({ x: X_DISC, y: pocketAt(c, 1)[0] - GEO.SPINDLE_X0, z, a: 0, b: 0 });
const overPost = (z) => ({ x: X_DISC, y: POST.x - GEO.SPINDLE_X0, z, a: 0, b: 0 });
const SWAP_HOLD = 0.8;
const MAG_RUN = 2.4;
export const SIM = (() => {
  const steps = [];
  const homeAxes = { ...HOME };
  const [cDrop, rDrop] = POCKETS.drop.split("/").map(Number);
  const [cPick, rPick] = POCKETS.pick.split("/").map(Number);
  // the tool change: moves, dips (straight), holds; each step can carry the magazine's sequence and row index from → to
  const tool = (kind, say, from, to, extra = {}) => {
    const via = kind === "move" ? { ...to, z: Math.min(from.z, to.z) } : undefined;
    const dur = extra.dur ?? (kind === "move" ? moveTime(from, via, to) : kind === "dip" ? dipTime(from, to) : SWAP_HOLD);
    steps.push({ kind, say, dur, from, via, to, pass: TOOL, ...extra });
    return to;
  };
  let at = homeAxes;
  const dropUp = overPocket(cDrop, CROSS_Z);
  at = tool("move", "Tool change · the magazine comes out", at, dropUp, { mag: [1, 0] });
  at = tool("dip", "Returning the last tool to the magazine", at, overPocket(cDrop, SWAP_Z));
  tool("hold", "Returning the last tool to the magazine", at, at, { swap: "drop" });
  at = tool("dip", "Returning the last tool to the magazine", at, dropUp);
  at = tool("move", `Indexing the magazine to row ${rPick}`, at, overPocket(cPick, CROSS_Z), { row: [rDrop - 1, rPick - 1] });
  at = tool("dip", "Picking up the finishing bur", at, overPocket(cPick, SWAP_Z));
  tool("hold", "Picking up the finishing bur", at, at, { swap: "pick" });
  at = tool("dip", "Picking up the finishing bur", at, overPocket(cPick, CROSS_Z));
  at = tool("move", "To the tool sensor", at, overPost(CROSS_Z));
  at = tool("dip", "Measuring the bur on the tool sensor", at, overPost(TOUCH_Z - 10));
  // the last 10 mm onto the cap slowly, as the video's head creeps down; the magazine indexes back meanwhile
  at = tool("dip", "Measuring the bur on the tool sensor", at, overPost(TOUCH_Z), { dur: 0.9, row: [rPick - 1, 0] });
  tool("hold", "Measuring the bur on the tool sensor", at, at, { dur: 0.5 });
  // up off the sensor, the magazine going back in meanwhile (it is shut before the head leaves for the work)
  at = tool("dip", "The magazine goes back in", at, overPost(0), { mag: [0, 1] });
  tool("hold", "The magazine goes back in", at, at, { dur: Math.max(0.3, MAG_RUN + 0.3 - dipTime(overPost(TOUCH_Z), overPost(0))) });
  let prev = at;
  for (const pass of PASSES) {
    const first = pass.at(0);
    const last = pass.at(1);
    const above = axesFor(lift(first).p, first.t);
    const raised = { ...above, z: Math.max(0, Math.min(above.z, prev.z) - 12) };
    const opening = pass === PASSES[0];
    steps.push({ kind: "move", say: opening ? "Down to the first pass" : "Up, across, down to the next pass", dur: moveTime(prev, raised, above), from: prev, via: raised, to: above, pass });
    steps.push({ kind: "dip", say: pass.say, dur: DIP, from: above, to: axesFor(first.p, first.t), pass });
    steps.push({ kind: "cut", say: pass.say, dur: pass.dur, pass });
    const out = axesFor(lift(last).p, last.t);
    steps.push({ kind: "dip", say: pass.say, dur: DIP, from: axesFor(last.p, last.t), to: out, pass, rising: true });
    prev = out;
  }
  steps.push({ kind: "move", say: "Finished: back home", dur: moveTime(prev, { ...prev, z: 0 }, homeAxes), from: prev, via: { ...prev, z: 0 }, to: { ...homeAxes, z: 0 }, pass: null });
  steps.push({ kind: "hold", say: "Finished", dur: 1.4, from: homeAxes, pass: null });
  let start = 0;
  for (const step of steps) { step.start = start; start += step.dur; }
  // the magazine's runs: out once the head has left the work, its row index at about 4 rows a second, and in as the head
  // rises off the sensor; out and in run the sequence at an even pace (the slide and the flap ease on their own) over
  // MAG_RUN, the block at about the video's speed
  const runs = [];
  for (const step of steps) {
    if (step.mag) runs.push({ key: "m", from: step.mag[0], to: step.mag[1], t0: step.start + 0.2, t1: step.start + 0.2 + MAG_RUN, even: true });
    if (step.row) runs.push({ key: "row", from: step.row[0], to: step.row[1], t0: step.start, t1: step.start + Math.abs(step.row[1] - step.row[0]) / 4 });
  }
  const swapAt = Object.fromEntries(steps.filter((step) => step.swap).map((step) => [step.swap, step.start + step.dur / 2]));
  return { steps, len: start, passes: PASSES, runs, swapAt };
})();
export const SIM_LEN = SIM.len;
// the job's spans on the timeline (for the scrubber): the tool change, then the passes: kind, start, end
export const SIM_SPANS = [TOOL, ...PASSES].map((pass) => {
  const mine = SIM.steps.filter((step) => step.pass === pass);
  return { kind: pass.kind, start: mine[0].start, end: mine[mine.length - 1].start + mine[mine.length - 1].dur };
});
// the magazine at a time in the job: its sequence (1 in … 0 out) and how many rows it is indexed out
const magAt = (t) => {
  const out = { m: 1, row: 0 };
  for (const run of SIM.runs) {
    if (t < run.t0) continue;
    const u = Math.min(1, (t - run.t0) / (run.t1 - run.t0));
    out[run.key] = run.from + (run.to - run.from) * (run.even ? u : smooth(u));
  }
  return out;
};
// which tools are where at a time in the job: in the spindle, and in the two pockets the change swaps
const toolAt = (t) => ({ spindle: !(t >= SIM.swapAt.drop && t < SIM.swapAt.pick), [POCKETS.drop]: t >= SIM.swapAt.drop, [POCKETS.pick]: t < SIM.swapAt.pick });
// the state at a time in the job: machine axes, the magazine, the tools, the tool's tilt from the disc's normal, which
// pass, and how far each surface is finished (0 … 1 along the arch; channels 0 or 1)
export function simAt(time) {
  const t = Math.max(0, Math.min(SIM.len, time));
  let i = 0;
  while (i < SIM.steps.length - 1 && t >= SIM.steps[i].start + SIM.steps[i].dur) i++;
  const step = SIM.steps[i];
  const u = Math.min(1, (t - step.start) / step.dur);
  let axes;
  let tilt = 0;
  if (step.kind === "cut") {
    const q = step.pass.at(u);
    axes = axesFor(q.p, q.t);
    tilt = (Math.acos(Math.min(1, q.t[2])) * 180) / Math.PI;
  } else if (step.kind === "dip") axes = lerpAxes(step.from, step.to, smooth(u));
  else if (step.kind === "move") {
    // up to the raised Z first, across, then down: Z leads on the way up and lags on the way down
    const k = smooth(u);
    const zk = smooth(Math.min(1, u / 0.35));
    const dk = smooth(Math.max(0, (u - 0.65) / 0.35));
    axes = lerpAxes(step.from, step.to, k);
    axes.z = step.from.z + (step.via.z - step.from.z) * zk + (step.to.z - step.via.z) * dk;
  } else axes = { ...step.from };
  // how far each surface is finished at this time
  const done = { occlusal: 0, buccal: 0, palatal: 0 };
  for (const s2 of SIM.steps) {
    if (s2.kind !== "cut") continue;
    done[s2.pass.kind] = t >= s2.start + s2.dur ? 1 : t <= s2.start ? 0 : (t - s2.start) / s2.dur;
  }
  const kind = step.pass ? step.pass.kind : null;
  const axis = kind === "tool" ? (step.kind === "hold" ? null : "yz") : step.kind === "cut" || step.kind === "dip" ? "all" : null;
  return { ...axes, a: wrap(axes.a), ...magAt(t), tool: toolAt(t), axis, say: step.say, kind, step: step.kind, tilt, done, cutting: step.kind === "cut" };
}
// the time the pass running at `time` began, its move in included (for resuming); in the tool change, the move that
// began the stretch it is in, with the tools as they are by then (a swap since the last move resumes from the next one)
const TOOL_MOVES = SIM.steps.filter((step) => step.pass === TOOL && step.kind === "move").map((step) => step.start);
export function simPassStart(time) {
  const t = Math.max(0, Math.min(SIM.len, time));
  // once the last pass is over (on the way home, or finished), the job starts again from the top
  if (t >= SIM_SPANS[SIM_SPANS.length - 1].end - 1e-9) return 0;
  if (t < SIM_SPANS[0].end - 1e-9) {
    let best = 0;
    for (const start of TOOL_MOVES) if (start <= t + 1e-9) best = start;
    const next = TOOL_MOVES.find((start) => start > best + 1e-9);
    if (next !== undefined && Object.values(SIM.swapAt).some((at) => at > best && at <= t)) best = next;
    return best;
  }
  let best = 0;
  for (const span of SIM_SPANS) if (span.start <= t + 1e-9) best = span.start;
  return best;
}
