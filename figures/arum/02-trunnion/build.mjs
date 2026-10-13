// Fig 2 · Five axes (ARUM 5X-200): the cradle slides in and out (X), the spindle travels left and right (Y) and up and
// down (Z), the gold cradle rolls ±30° (B) and the disc holder turns 360° (A); the magazine comes out behind its flap.
// node build.mjs [--light] [--audit [--quick] [--only=a,b]] [--verify] [--artifact=path]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../../.claude/skills/anatomy/kit/lathe.mjs";
import * as A from "../../../.claude/skills/anatomy/kit/audit.mjs";
import { turning } from "../../../.claude/skills/anatomy/kit/turn-build.mjs";
import * as TA from "../../../.claude/skills/anatomy/kit/turn-audit.mjs";
import { turnScript } from "../../../.claude/skills/anatomy/scripts/inline-kit.mjs";
import { SPEC, TRAVEL, GEO, HOME, Y_DISC, wrap, magOf, zLimit, tourAt, TOUR_LEN, readoutOf, wordsOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const THEME = argv.includes("--light") ? "light" : "dark";

// World: 1 unit = 1 mm. Origin at the disc centre with every axis at 0, where A and B cross. X right (drive side),
// y toward the operator (front), Z up. Depths behind the holder are written as positive distances back (frames point back).
const W = 620;
const H = 560;
const AZIMUTH = 128; // viewer at the front left, as an operator at the open door
const ELEVATION = 30;

// Holder (disc cartridge frame, from the dealer's photos: 157 square, 25 thick, Ø98.5 disc, P1–P5 premill bar)
const { HALF, THICK, ARM_L, ARM_R, BOSS_R, WALL, TOP, WALL_Z0, KNUCKLE, TIP_Z, MAG, MAG_TOP } = GEO;
const CHAMFER = 6.5;
const DISC_R = SPEC.disc / 2;
// Chamber
const FLOOR_Z = -142;
const BACK_Y = 150;
const WALL_X = [-300, 200];
const WALL_T = 14;
const FRONT_Y = 250; // the floor reaches the door, so the cradle can come forward its full X stroke
// Spindle head: with Y at 0 the spindle axis is over the magazine's far column; Z at 0 parks the bur above everything
const HX = GEO.SPINDLE_X0;
const HY = GEO.SPINDLE_Y; // the spindle's line, in front of the B axis
const S0 = TIP_Z + GEO.TOOL; // nose-ring bottom face (tool sticks out 43, as in the photos)
const BOX = { x: HX - 56, y: HY - 68, w: 113, d: 110, r: 4 }; // spindle 42 behind the box front
const BOX_Z = [S0 + 41, S0 + 200];
const WALL_TOP = BOX_Z[1] + 24;
// Openings in the chamber's back wall: the magazine window (with its flap), the ram behind the cradle, and the slot the
// spindle column's tongue runs in
const WIN = { x: [MAG.x - 6, MAG.x + MAG.w + 6], z: [MAG_TOP - 40, 35] };
const RAM = GEO.RAM;
const SLOT = { x: [HX - 30, HX + TRAVEL.y + 30], z: [325, 345] };
// Flap: hinged along its bottom edge just in front of the wall; open, it lies flat at the window sill and the magazine
// slides over it; shut, it stands against the wall over the window
const FLAP = { y: -BACK_Y + 1.5, z: WIN.z[0] - 1.5, x: [WIN.x[0] + 1, WIN.x[1] - 1], len: WIN.z[1] - WIN.z[0] + 3 };

const P = k.fitProjection(
  [
    [WALL_X[0], FRONT_Y, FLOOR_Z - 6], [WALL_X[1], FRONT_Y, FLOOR_Z - 6], [WALL_X[1], -BACK_Y - WALL_T, FLOOR_Z - 6], [WALL_X[0], -BACK_Y - WALL_T, FLOOR_Z - 6],
    [WALL_X[0], -BACK_Y, WALL_TOP], [WALL_X[1], -BACK_Y, WALL_TOP], [BOX.x, BOX.y + BOX.d, BOX_Z[1]], [BOX.x + BOX.w + TRAVEL.y, BOX.y + BOX.d, BOX_Z[1]],
  ],
  W,
  H,
  { pad: 26, azimuth: AZIMUTH, elevation: ELEVATION },
);
const V = G.viewOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const Faded = (list, style) => k.fadedSvg(list, style);
const frameOf = (o, a, u) => {
  const axis = G.unit3(a);
  const uu = u ? G.unit3(G.sub3(u, G.mul3(axis, G.dot3(u, axis)))) : G.frameAlong(o, axis).u;
  return { o, a: axis, u: uu, v: G.cross3(axis, uu) };
};
const ALONG_X = frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0]); // u = front, v = Z (polygons below are written as [back, z] and flipped)
const ALONG_Y = frameOf([0, 0, 0], [0, -1, 0], [1, 0, 0]); // axis points back, u = X, v = Z
const backs = (poly) => poly.map(([u, v]) => [-u, v]);
const UP = (x, y) => G.frameOf([x, y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);

export const R = A.recorder(P);
const put = (item) => R.put({ ...item, shapes: (item.shapes ?? []).map((shape, index) => R.solid(Object.assign(shape, { name: shape.name ?? (index ? `${item.name}#${index + 1}` : item.name) }))) });

// ---------------------------------------------------------------- live: the five axes, the magazine and its flap
export const T = turning(P, { recorder: R });
// X: the cradle, its ram and everything on it slide toward the operator from home at the back
const gx = T.group("x", { slide: { direction: [0, 1, 0], travel: TRAVEL.x } });
const b = T.group("b", { parent: gx, hinge: { point: [0, 0, 0], axis: [0, -1, 0], range: [-SPEC.bLimit, SPEC.bLimit] } });
const a = T.group("a", { parent: b, hinge: { point: [0, 0, 0], axis: [1, 0, 0], range: [-180, 180] } });
// Y: the spindle column runs right from over the magazine; Z: the head slides down its rails from the top
const gy = T.group("y", { slide: { direction: [1, 0, 0], travel: TRAVEL.y } });
const gz = T.group("z", { parent: gy, slide: { direction: [0, 0, -1], travel: TRAVEL.z } });
// the magazine slides back through the window from out; the flap swings up from flat (0) to shut (90)
const gm = T.group("mag", { slide: { direction: [0, -1, 0], travel: GEO.MAG_STROKE } });
const gf = T.group("flap", { hinge: { point: [(WIN.x[0] + WIN.x[1]) / 2, FLAP.y, FLAP.z], axis: [1, 0, 0], range: [0, 90] } });
const live = T.layer("machine");
T.stack(["back", "machine", "front"]);
// page values { x, y, z, a, b, m } (m: magazine sequence, 0 out … 1 in and shut) to group values
export const follow = (values) => ({ x: values.x ?? 0, b: values.b ?? 0, a: values.a ?? 0, y: values.y ?? 0, z: values.z ?? 0, ...magOf(values.m ?? 1) });
// reachable states for the build: the tour, and a grid of jog states with the head as low as each allows
const reachable = () => {
  const out = [];
  for (let t = 0; t < TOUR_LEN; t += 1 / 8) out.push(follow(tourAt(t)));
  for (const x of [0, TRAVEL.x / 2, TRAVEL.x])
    for (const y of [0, 60, 120, 180, Y_DISC, 270, TRAVEL.y])
      for (const bv of [-30, -15, 0, 15, 30])
        for (let av = -180; av < 180; av += 30) {
          const m = y < 110 ? 0 : 1;
          const deep = zLimit({ x, b: bv, a: av, mag: magOf(m).mag }, y);
          if (deep < 0) continue;
          for (const z of [0, deep]) out.push(follow({ x, y, z, a: av, b: bv, m }));
        }
  return out;
};
// The build fits each cross-group plane to 24 states spread evenly through this list, so an envelope of 24 states that
// spans every relative motion (B in two passes, A round in 15° steps, Z down its rails, every X, Y and magazine step)
// sits exactly where it samples, and the reachable states fill the gaps between.
const envelope = () =>
  Array.from({ length: 24 }, (_, i) => {
    const s = { x: [0, TRAVEL.x / 2, TRAVEL.x][i % 3], y: [0, TRAVEL.y, Y_DISC, 112, 270, 60][i % 6], a: wrap(15 * i), b: -30 + (60 * (i % 12)) / 11, m: [1, 0, 0.5, 0.72, 0.86, 1][i % 6] };
    const deep = zLimit({ x: s.x, b: s.b, a: s.a, mag: magOf(s.m).mag }, s.y);
    return follow({ ...s, z: Math.max(0, Math.min(deep, (TRAVEL.z * (i % 8)) / 7)) });
  });
export const poses = () => {
  const fill = reachable();
  const k = Math.ceil(fill.length / 24) + 1;
  const out = [];
  envelope().forEach((state, i) => {
    out.push(state);
    for (let j = 1; j < k; j++) out.push(fill[Math.min(fill.length - 1, i * (k - 1) + j - 1)]);
  });
  return out;
};

const CB = { group: b, layer: live };
const CA = { group: a, layer: live };
// plane markup helpers (holder and wall faces)
const circle = (r, n = 48) => Array.from({ length: n + 1 }, (_, i) => `${i ? "L" : "M"}${(r * Math.cos((i / n) * 2 * Math.PI)).toFixed(3)} ${(r * Math.sin((i / n) * 2 * Math.PI)).toFixed(3)}`).join("") + "Z";
const roundRect = (x0, y0, x1, y1, r) => k.pathOf(k.roundedPlan({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, 4), true);
const shift = (d, x, y) => d.replace(/(-?\d+\.\d+) (-?\d+\.\d+)/g, (_, px, py) => `${(+px + x).toFixed(3)} ${(+py + y).toFixed(3)}`);
const screwHead = (x, y, r = 2.7) => `<path class="tr-screw" d="${shift(circle(r, 12), x, y)}"/>`;
const socketHead = (x, y, r) => `<path class="tr-hole" d="${shift(circle(r, 12), x, y)}"/><path class="iso-line" data-tone="lo" d="${shift(circle(r + 0.9, 16), x, y)}"/>`;

// cradle arms and back wall (gold), all one rigid U in plan
const semicircle = Array.from({ length: 25 }, (_, i) => {
  const t = -Math.PI / 2 + (i / 24) * Math.PI;
  return [-BOSS_R * Math.cos(t), BOSS_R * Math.sin(t)];
}).reverse();
T.prism({ name: "cradle.arm.left", ...CB, F: ALONG_X, polygon: backs([[WALL[0], -BOSS_R], [WALL[0], BOSS_R], ...semicircle]), s0: ARM_L[0], s1: ARM_L[1], tone: "mid", material: "gold" });
// the outer top edge is bevelled, as in the photos: it clears the tool magazine when the cradle rolls
T.prism({ name: "cradle.rise.left", ...CB, F: ALONG_Y, polygon: [[ARM_L[0], BOSS_R], [ARM_L[1], BOSS_R], [ARM_L[1], TOP], [ARM_L[0] + 18, TOP], [ARM_L[0], TOP - 18]], s0: 8, s1: WALL[0], tone: "mid", material: "gold", bevel: 0.6 });
T.prism({ name: "cradle.arm.right", ...CB, F: ALONG_X, polygon: backs([[-35, -45], [-20, -60], [WALL[0], -60], [WALL[0], TOP], [-35, TOP]]), s0: ARM_R[0], s1: ARM_R[1], tone: "mid", material: "gold", bevel: 0.8 });
const wall = T.prism({ name: "cradle.wall", ...CB, F: ALONG_X, polygon: backs([[WALL[0], WALL_Z0], [WALL[1], WALL_Z0], [WALL[1], TOP], [WALL[0], TOP]]), s0: ARM_L[0], s1: ARM_R[1], tone: "mid", material: "gold", bevel: 0.8 });
// the bolt circle on the wall's front face: five socket heads in counterbores and two open holes on the upper arc, and five
// more socket heads on the lower arc, seen in ARUM's photos through the open premill bar (count, radius and angles not
// published: measured to about ±10° and assumed on the same circle)
const bolt = (deg) => [27.5 * Math.sin((deg * Math.PI) / 180), 27.5 * Math.cos((deg * Math.PI) / 180)];
const wallFace = [...[-68, -34, 0, 34, 68, 125, 150, 180, 210, 235].map((d) => { const [x, z] = bolt(d); return `<path class="iso-line" data-tone="lo" d="${shift(circle(5, 20), x, z)}"/>${socketHead(x, z, 3.4)}`; }), ...[-105, 105].map((d) => { const [x, z] = bolt(d); return `<path class="tr-hole" d="${shift(circle(2.6, 12), x, z)}"/>`; })].join("");
T.plane({ part: wall, o: [0, -WALL[0], 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: wallFace });
T.prism({ name: "cradle.hat", ...CB, F: ALONG_Y, polygon: [[-45, TOP], [45, TOP], [33, TOP + 12], [-33, TOP + 12]], s0: WALL[0], s1: WALL[1], tone: "mid", material: "gold", bevel: 0.5 });
// B knuckle on the wall's back face, flush against the ram's front face
T.round({ name: "cradle.b-knuckle", ...CB, F: ALONG_Y, s0: KNUCKLE[0], s1: KNUCKLE[1], r: 34, tone: "mid", material: "steel" });
// hubs (silver): left end cap and bearing cap on the support arm, drive housing on the right arm
T.round({ name: "hub.left.cap", ...CB, F: ALONG_X, s0: ARM_L[0] - 5, s1: ARM_L[0], r: 29.5, tone: "mid", material: "steel", details: { bolts: [{ s: ARM_L[0] - 5, r: 22, count: 6, phase: 0, size: 0.5 }] } });
T.round({ name: "hub.left.bearing", ...CB, F: ALONG_X, s0: ARM_L[1], s1: ARM_L[1] + 6, r: 31.5, tone: "mid", material: "steel", details: { bolts: [{ s: ARM_L[1] + 6, r: 27, count: 4, phase: 0.2, size: 0.5 }] } });
const rimScrews = Array.from({ length: 6 }, (_, i) => { const t = (i / 6) * 2 * Math.PI + 0.3; return { at: [ARM_R[0] - 4, 42.5 * Math.cos(t), 42.5 * Math.sin(t)], normal: [0, Math.cos(t), Math.sin(t)], size: 0.55 }; });
T.round({ name: "hub.right.drive", ...CB, F: ALONG_X, s0: 91, s1: ARM_R[0], r: 42.5, tone: "mid", material: "steel", details: { seams: [96, ARM_R[0] - 8], dots: rimScrews } });

// holder (A): one plate; the disc, clamp ring, screws and bores are drawn in the planes of its faces
const plate = [[-HALF + CHAMFER, -HALF], [HALF - CHAMFER, -HALF], [HALF, -HALF + CHAMFER], [HALF, HALF - CHAMFER], [HALF - CHAMFER, HALF], [-HALF + CHAMFER, HALF], [-HALF, HALF - CHAMFER], [-HALF, -HALF + CHAMFER]];
// holder frame: u = −X, v = back, so markup reads with v toward the back wall at A = 0
const HF = { o: [0, 0, 0], a: [0, 0, 1], u: [-1, 0, 0], v: [0, -1, 0] };
const holder = T.prism({ name: "holder.plate", ...CA, F: HF, polygon: plate, s0: -THICK, s1: THICK, tone: "hi", crease: "lo", material: "steel" });
// Face B (up at A = 0): black clamp ring with six screws over a polished bevel, the slot by the front edge, four blind pockets,
// and the premill bar along the back edge with five seat marks (ARUM's photos show P1–P5 on this face too)
const ringScrews = Array.from({ length: 6 }, (_, i) => [56.5 * Math.cos((i * Math.PI) / 3), 56.5 * Math.sin((i * Math.PI) / 3)]);
const knurled = (x, y) => `${screwHead(x, y, 3.6)}<path class="iso-line" data-tone="faint" d="${shift(circle(2.2, 12), x, y)}"/>`;
const faceB = [
  `<path class="tr-ring" fill-rule="evenodd" d="${circle(55)}${circle(47)}"/>`,
  `<path class="tr-bevel" fill-rule="evenodd" d="${circle(47)}${circle(45.5)}"/>`,
  `<path class="iso-line" data-tone="lo" d="${circle(55)}"/>`,
  `<path class="tr-disc" d="${circle(45.5)}"/>`,
  `<path class="iso-line" data-tone="lit" d="${circle(45.5)}"/>`,
  ...ringScrews.map(([x, y]) => screwHead(x, y)),
  `<path class="iso-line" data-tone="lo" d="${roundRect(-31, -HALF + 8, 31, -HALF + 20, 6)}"/>`,
  `<path class="tr-hole" d="${roundRect(-29, -HALF + 11, 29, -HALF + 17, 3)}"/>`,
  ...[[-42, -42], [42, -42], [-42, 42], [42, 42]].map(([x, y]) => `<path class="iso-line" data-tone="lo" d="${shift(circle(5.5, 20), x, y)}"/>`),
  ...[[-70, -62], [70, -62]].map(([x, y]) => knurled(x, y)),
  ...[[-70, 66], [70, 66]].map(([x, y]) => `<path class="iso-line" data-tone="lo" d="${roundRect(x - 7, y - 7, x + 7, y + 7, 1.2)}"/>${screwHead(x, y, 2.5)}`),
  `<path class="iso-line" data-tone="lo" d="${roundRect(-56, 58, 55, 68, 2)}"/>`,
  `<path class="iso-line" data-tone="lo" data-free="end" d="${[-42, -21, 0, 21, 42].map((x) => `M${x} 68L${x} 72`).join("")}"/>`,
].join("");
T.plane({ part: holder, o: [0, 0, THICK], u: [-1, 0, 0], v: [0, -1, 0], svg: faceB });
// Face A (down at A = 0): the disc in its bore, the recessed field, the premill groove with five engraved seat marks,
// knurled screws on brackets at the bar-end corners, side-rim screws and through-holes
const faceA = [
  `<path class="iso-line" data-tone="lo" d="${roundRect(-64, -57, 63, 55, 3)}"/>`,
  `<path class="tr-gap" fill-rule="evenodd" d="${circle(DISC_R + 0.9)}${circle(DISC_R)}"/>`,
  `<path class="tr-disc" d="${circle(DISC_R)}"/>`,
  `<path class="iso-line" data-tone="lit" d="${circle(DISC_R)}"/>`,
  `<path class="iso-line" data-tone="lo" d="${roundRect(-56, 58, 55, 68, 2)}"/>`,
  `<path class="iso-line" data-tone="lo" data-free="end" d="${[-42, -21, 0, 21, 42].map((x) => `M${x} 68L${x} 72`).join("")}"/>`,
  ...ringScrews.map(([x, y]) => `<path class="iso-line" data-tone="lo" d="${shift(circle(1.6, 12), x * 1.02, y * 1.02)}"/>`),
  ...[[-42, -42], [42, -42], [-42, 42], [42, 42]].map(([x, y]) => `<path class="tr-hole" d="${shift(circle(2.2, 12), x, y)}"/>`),
  ...[-71, 71].map((x) => `<path class="iso-line" data-tone="lo" d="${roundRect(x - 8, 30, x + 8, 64, 1.5)}"/>${knurled(x, 38)}${knurled(x, 56)}`),
  ...[-71, 71].map((x) => screwHead(x, -50, 2.4)),
].join("");
T.plane({ part: holder, o: [0, 0, -THICK], u: [-1, 0, 0], v: [0, -1, 0], normal: [0, 0, -1], svg: faceA });
// premill strip on the bar edge: five bores with set screws (P1–P5) and four cap screws
const barFace = [
  `<path class="iso-line" data-tone="lo" d="${roundRect(-65.5, -8, 65.5, 8, 1.5)}"/>`,
  ...[-42, -21, 0, 21, 42].map((x) => socketHead(x, 0, 2.4)),
  ...[-63, -32, 32, 63].map((x) => screwHead(x, 0, 2.4)),
].join("");
T.plane({ part: holder, o: [0, -HALF, 0], u: [-1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0], svg: barFace });
// shafts: knuckle collars on the holder's sides, flush on the hub faces
T.round({ name: "holder.collar.left", ...CA, F: ALONG_X, s0: ARM_L[1] + 6, s1: -HALF, r: 24, tone: "mid", material: "steel", details: { seams: [-HALF - 3] } });
T.round({ name: "holder.collar.right", ...CA, F: ALONG_X, s0: HALF, s1: 91, r: 29, tone: "mid", material: "steel", details: { seams: [HALF + 4] } });
// side straps on the Face B side, from the back corner blocks to just in front of the A shaft
for (const side of [-1, 1]) T.prism({ name: `holder.strap.${side < 0 ? "left" : "right"}`, ...CA, F: HF, polygon: [[side * (HALF - 10), -40], [side * (HALF - 1), -40], [side * (HALF - 1), HALF - 15], [side * (HALF - 10), HALF - 15]], s0: THICK, s1: THICK + 3, tone: "mid", material: "steel", details: { dots: [-30, 10, 50].map((y) => ({ at: [THICK + 3, side * (HALF - 5.5), y], normal: [0, 0, 1], size: 0.5 })) } });

// ---------------------------------------------------------------- chamber: the floor is static and behind everything; the
// back wall is a set of plates around its openings, in the live layer, so the ram, the magazine and the column's tongue
// can pass behind it
const ground = (shape) => Object.assign(shape, { ground: true });
const UPF = UP(0, 0);
const block = (name, [x0, x1], [y0, y1], [z0, z1], extra = {}) => T.prism({ name, layer: live, F: UPF, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], s0: z0, s1: z1, tone: "mid", ...extra });
const WY = [-BACK_Y - WALL_T, -BACK_Y];
function chamber() {
  const FLOOR = { x: WALL_X[0], y: WY[0], w: WALL_X[1] - WALL_X[0], d: FRONT_Y - WY[0], r: 2 };
  const floorSvg = `<path class="iso-halo" d="${k.haloOf(FLOOR, FLOOR_Z - 8, 8, P)}"/>` + S(k.slabOf(FLOOR, FLOOR_Z - 8, 8, P, 3, 1.2), { tone: "lo", inner: Ln(k.sideSeam(FLOOR, FLOOR_Z - 4, P, 3), { tone: "faint" }) });
  // sheet joints across the floor, edge to edge
  const joints = [-20, 120].map((y) => Ln(k.lineOnTop([FLOOR.x, y], [FLOOR.x + FLOOR.w, y], FLOOR_Z, P), { tone: "faint" })).join("");
  const drains = [[120, 60], [150, -60], [60, 190]];
  const drainSvg = drains.map(([x, y]) => S(k.cylinder(x, y, 18, FLOOR_Z, 1.2, P, 40, 0.3), { tone: "mid" }) + Ln(k.ring(x, y, 12, FLOOR_Z + 1.2, P, 36), { tone: "lo" }) + Dots(k.dotGrid(x - 6, y - 6, 4, 4, 4, FLOOR_Z + 1.2, P), { size: 0.45, tone: "lo" }) + Dots([0, 1, 2, 3, 4, 5].map((j) => at([x + 15 * Math.cos(j * 1.047 + 0.3), y + 15 * Math.sin(j * 1.047 + 0.3), FLOOR_Z + 1.2])), { size: 0.45 })).join("");
  put({ name: "stand.floor", layer: "back", at: [0, 0, FLOOR_Z - 4], bias: -50, svg: floorSvg + joints + drainSvg, shapes: [ground(A.slab(FLOOR, FLOOR_Z - 8, 8))] });
  // the floor carries on under the side housing behind the wall, so the housing stands on something
  const STRIP = { x: WALL_X[0] - 8, y: WY[0] - 181, w: 8, d: 181, r: 0.5 };
  put({ name: "stand.floor-back", layer: "back", at: [STRIP.x + 4, STRIP.y + STRIP.d / 2, FLOOR_Z - 4], bias: -60, svg: S(k.slabOf(STRIP, FLOOR_Z - 8, 8, P, 1, 0.4), { tone: "lo" }), shapes: [ground(A.slab(STRIP, FLOOR_Z - 8, 8))] });
  // the door sill stands on the floor, so it lives with the machine's parts
  block("stand.sill", WALL_X, [FRONT_Y - 10, FRONT_Y], [FLOOR_Z, FLOOR_Z + 4], { bevel: 0.4, details: { dots: [-270, -150, -30, 90, 176].map((x) => ({ at: [FLOOR_Z + 4, x, FRONT_Y - 5], normal: [0, 0, 1], size: 0.5 })) } });

  // the wall in bands: under the openings, beside the window and the ram, the face, beside the slot, and the top
  const screwsIn = (x0, x1, z0, z1) => {
    const out = [];
    for (const x of [-284, -204, -124, 100, 140, 184]) for (let z = FLOOR_Z + 18; z < WALL_TOP - 8; z += 40) if (x > x0 + 4 && x < x1 - 4 && z > z0 + 4 && z < z1 - 4) out.push({ at: [z, x, WY[1]], normal: [0, 1, 0], size: 0.5 });
    return out;
  };
  const plate = (name, xs, zs, more = []) => block(name, xs, WY, zs, { details: { dots: [...screwsIn(xs[0], xs[1], zs[0], zs[1]), ...more] } });
  // the long bands are cut where the openings' sides fall, so no plate spans both the bay and the ram (a long plate there
  // closes a painter's cycle: plate → bay → ram → plate)
  // The base stops 0.5 under the window sill and the ram, so the bay floor, the magazine and the ram rest on their own
  // contacts and each meeting has one plane to order by (flush plates on two planes at once tie and can cycle).
  const CUTS = [WALL_X[0], WIN.x[1], RAM.x[1], WALL_X[1]];
  const SILL_Z = WIN.z[0] - 0.5;
  for (let i = 0; i < 3; i++) plate(`wall.base.${i + 1}`, [CUTS[i], CUTS[i + 1]], [FLOOR_Z, SILL_Z]);
  plate("wall.left", [WALL_X[0], WIN.x[0]], [SILL_Z, WIN.z[1]]);
  plate("wall.mid", [WIN.x[1], RAM.x[0]], [SILL_Z, WIN.z[1]]);
  plate("wall.right", [RAM.x[1], WALL_X[1]], [SILL_Z, WIN.z[1]]);
  const faces = [0, 1, 2].map((i) => plate(`wall.face.${i + 1}`, [CUTS[i], CUTS[i + 1]], [WIN.z[1], SLOT.z[0]]));
  const face = faces[1];
  plate("wall.slot-left", [WALL_X[0], SLOT.x[0]], SLOT.z);
  plate("wall.slot-right", [SLOT.x[1], WALL_X[1]], SLOT.z);
  plate("wall.top", WALL_X, [SLOT.z[1], WALL_TOP], Array.from({ length: 12 }, (_, i) => ({ at: [WALL_TOP - 12, -260 + 40 * i, WY[1]], normal: [0, 1, 0], size: 0.5 })));
  // the brushed slot just above the ram (dealer's photo 3), drawn on the face
  const slot = k.pathOf(k.roundedPlan({ x: -65, y: 36, w: 130, d: 6, r: 3 }, 4), true);
  const brush = k.pathOf(k.roundedPlan({ x: -63, y: 38, w: 126, d: 2, r: 1 }, 4), true);
  T.plane({ part: face, o: [0, WY[1], 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: `<path class="tr-hole" d="${slot}"/><path class="iso-line" data-tone="lo" d="${slot}"/><path class="iso-line" data-tone="faint" d="${brush}"/>` });
  // a ledge above the magazine window
  block("wall.ledge", [WALL_X[0] + 10, WIN.x[1] + 20], [WY[1], WY[1] + 8], [WIN.z[1] + 5, WIN.z[1] + 10], { bevel: 0.4 });
  // the magazine bay behind the window: dark, deep enough to take the whole magazine with its flap shut
  const BAY = { y: [WY[0] - 156, WY[0]], back: 5, skin: 5 };
  const dark = { tone: "lo", material: "rubber" };
  // a floor under everything, side walls standing on it and a roof capping them: each joint meets on one face
  const BX = [WIN.x[0] - BAY.skin, WIN.x[1] + BAY.skin];
  block("bay.floor", BX, BAY.y, [WIN.z[0] - BAY.skin, WIN.z[0]], dark);
  block("bay.left", [BX[0], WIN.x[0]], BAY.y, WIN.z, dark);
  block("bay.right", [WIN.x[1], BX[1]], BAY.y, WIN.z, dark);
  block("bay.roof", BX, BAY.y, [WIN.z[1], WIN.z[1] + BAY.skin], dark);
  block("bay.back", BX, [BAY.y[0] - BAY.back, BAY.y[0]], [WIN.z[0] - BAY.skin, WIN.z[1] + BAY.skin], dark);
  // the machine's side housing behind the wall's left edge: it hides the bay and the retracted magazine, which would
  // otherwise show past the edge from this viewpoint; it carries the wall's bands and screws round the corner
  const RET = { x: [WALL_X[0] - 8, WALL_X[0]], y: [BAY.y[0] - BAY.back - 15, WY[0]] };
  const retDots = [];
  for (let y = RET.y[0] + 20; y < RET.y[1] - 10; y += 50) for (let z = FLOOR_Z + 18; z < WALL_TOP - 8; z += 40) retDots.push({ at: [z, RET.x[0], y], normal: [-1, 0, 0], size: 0.5 });
  block("wall.return", RET.x, RET.y, [FLOOR_Z, WALL_TOP], { details: { seams: [SILL_Z, WIN.z[1], SLOT.z[0], SLOT.z[1]], dots: retDots } });
  // and a dark channel behind the column slot
  block("slot.back", SLOT.x, [WY[0] - 17, WY[0] - 12], [SLOT.z[0] - 4, SLOT.z[1] + 4], dark);
}

// ---------------------------------------------------------------- X: the ram behind the cradle, through the wall
function ram() {
  const y1 = -KNUCKLE[1];
  const z1 = RAM.z[1];
  // screws along its top, in pairs every 40 mm, so it reads as a carriage as it comes out of the wall
  const dots = [];
  for (let y = y1 - 12; y > y1 - RAM.len + 10; y -= 40) for (const x of [-60, 60]) dots.push({ at: [z1, x, y], normal: [0, 0, 1], size: 0.55 });
  block("ram", RAM.x, [y1 - RAM.len, y1], RAM.z, { group: gx, material: "gunmetal", details: { seams: [z1 - 6], dots } });
}

// ---------------------------------------------------------------- Y and Z: the column on the wall, the head on its rails
function spindle() {
  const F = UP(HX, HY);
  // Y: the column with two rails, and the tongue that runs in the wall slot
  const COL = { x: [HX - 45, HX + 45], z: [50, WALL_TOP - 14] };
  block("column", COL.x, [WY[1], -132], COL.z, { group: gy, details: { seams: [COL.z[1] - 10] } });
  for (const side of [-1, 1]) block(`column.rail.${side < 0 ? "left" : "right"}`, side < 0 ? [HX - 34, HX - 22] : [HX + 22, HX + 34], [-132, -126], COL.z, { group: gy, material: "steel" });
  block("column.tongue", [HX - 30, HX + 30], [WY[0] - 12, WY[1]], SLOT.z, { group: gy });
  // Z: the saddle on the rails, the head box with a 45° chamfer along its bottom front edge, the spindle and the bur
  block("head.saddle", [HX - 35, HX + 35], [-126, BOX.y], BOX_Z, { group: gz });
  const HXF = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const yb = BOX.y;
  const yf = BOX.y + BOX.d;
  const prof = [[yb, BOX_Z[0]], [yf - 10, BOX_Z[0]], [yf, BOX_Z[0] + 10], [yf, BOX_Z[1]], [yb, BOX_Z[1]]];
  const boxPaths = G.prismOf(HXF, prof, BOX.x, BOX.x + BOX.w, P);
  const frontScrews = [[BOX.x + 8, BOX_Z[0] + 24], [BOX.x + BOX.w - 8, BOX_Z[0] + 24], [BOX.x + 8, BOX_Z[1] - 10], [BOX.x + BOX.w - 8, BOX_Z[1] - 10]].map(([x, z]) => at([x, yf, z]));
  const boxSeam = k.segment([BOX.x, yf, BOX_Z[0] + 52], [BOX.x + BOX.w, yf, BOX_Z[0] + 52], P);
  const ringProfile = [[S0 + 25, 32.5], [S0 + 29, 40], [S0 + 30, 42.5], [S0 + 41, 42.5]];
  const parts = [
    { name: "head.box", svg: S(boxPaths, { tone: "mid", inner: Ln(boxSeam, { tone: "faint" }) }) + Dots(frontScrews, { size: 0.5 }), shape: A.prism(HXF, prof, BOX.x, BOX.x + BOX.w), at: [HX, BOX.y + BOX.d / 2, BOX_Z[0]] },
    { name: "head.ring", svg: S(G.solidOf(ringProfile, F, P), { tone: "hi", crease: "lo" }), shape: A.solid(F, ringProfile), at: [HX, HY, S0 + 33] },
    { name: "head.nose", svg: S(G.solidOf([[S0 + 7, 32.5], [S0 + 25, 32.5]], F, P), { tone: "mid", inner: Ln(G.arcOf(F, S0 + 12, 32.5, P), { tone: "faint" }) }), shape: A.solid(F, [[S0 + 7, 32.5], [S0 + 25, 32.5]]), at: [HX, HY, S0 + 16] },
    { name: "head.nose-ring", svg: S(G.solidOf([[S0, 17], [S0 + 2, 19], [S0 + 7, 19]], F, P), { tone: "mid" }), shape: A.solid(F, [[S0, 17], [S0 + 2, 19], [S0 + 7, 19]]), at: [HX, HY, S0 + 3.5] },
    { name: "head.shaft", svg: S(G.solidOf([[S0 - 10, 7.5], [S0, 7.5]], F, P), { tone: "mid" }), shape: A.solid(F, [[S0 - 10, 7.5], [S0, 7.5]]), at: [HX, HY, S0 - 5] },
    { name: "tool.collar", svg: S(G.solidOf([[S0 - 17, 6.5], [S0 - 10, 6.5]], F, P), { tone: "mid" }) + Faded(G.ribsOf(F, S0 - 17, S0 - 10, 6.5, 6, P, { fade: [0.1, 0.55] }), { tone: "lo" }), shape: A.solid(F, [[S0 - 17, 6.5], [S0 - 10, 6.5]]), at: [HX, HY, S0 - 13.5] },
  ];
  // the bur: Ø6 shank, neck, Ø2 ball-end cutter
  const bur = [[TIP_Z, 0], [TIP_Z + 0.4, 0.8, 1], [TIP_Z + 1, 1], [TIP_Z + 7, 1], [TIP_Z + 9, 0.8], [TIP_Z + 12, 0.8], [TIP_Z + 18, 3], [S0 - 17, 3]];
  if (!(S0 - 17 > TIP_Z + 18)) throw new Error("tool: shank shorter than its taper");
  parts.push({ name: "tool.bur", svg: S(G.solidOf(bur, F, P, {}), { tone: "hi", crease: "lo" }), shape: A.solid(F, bur), at: [HX, HY, TIP_Z + 12] });
  // coolant: on each side a hex block with a domed swivel under the head, a short rigid Ø5 tube and a black tip, aimed at a
  // point on the spindle axis 29 mm below the nose
  const aim = [HX, HY, S0 - 29];
  const top = BOX_Z[0];
  for (const side of [-1, 1]) {
    // one picture per nozzle (the head only translates), its pieces painted far to near
    const c = [HX + side * 48, HY + 33];
    const hex = Array.from({ length: 6 }, (_, j) => [c[0] + 9.8 * Math.cos((j * Math.PI) / 3), c[1] + 9.8 * Math.sin((j * Math.PI) / 3)]);
    const DF = UP(c[0], c[1]);
    const dome = [[top - 17, 0], [top - 16.4, 3, 1], [top - 14.6, 5.4, 1], [top - 12, 7, 1], [top - 10, 7.4]];
    const from = [c[0], c[1], top - 12];
    const dir = G.unit3(G.sub3(aim, from));
    const tubeEnd = G.add3(from, G.mul3(dir, 20));
    const TF = frameOf(from, dir, [0, 0, 1]);
    const tip = [[20, 4.5], [27, 4.5], [30, 2.4]];
    const pieces = [
      { at: [c[0], c[1], top - 8], svg: S(k.extrude(hex, top - 10, 10, P, { bevel: 0.3 }), { tone: "mid" }) + S(G.solidOf(dome, DF, P, {}), { tone: "mid" }) },
      { at: G.add3(from, G.mul3(dir, 12)), svg: S(G.solidOf([[4, 2.5], [20, 2.5]], TF, P, {}), { tone: "hi", crease: "lo" }) },
      { at: G.add3(tubeEnd, G.mul3(dir, 5)), svg: `<g class="tr-black">${S(G.solidOf(tip, TF, P, {}), { tone: "lo" })}</g>` },
    ].sort((u, w) => k.depthOf(u.at, P) - k.depthOf(w.at, P));
    parts.push({ name: `nozzle.${side < 0 ? "left" : "right"}`, svg: pieces.map((piece) => piece.svg).join(""), shapes: [A.extruded(hex, top - 10, 10, { name: `nozzle.hex.${side}`, owner: `nozzle.${side}` }), A.solid(DF, dome, { name: `nozzle.dome.${side}`, owner: `nozzle.${side}` }), A.solid(TF, [[4, 2.5], [20, 2.5]], { name: `nozzle.tube.${side}`, owner: `nozzle.${side}` }), A.solid(TF, tip, { name: `nozzle.tip.${side}`, owner: `nozzle.${side}` })], at: [c[0], c[1], top - 12] });
  }
  for (const part of parts) T.fixed({ name: part.name, group: gz, layer: live, svg: part.svg, anchor: part.at, shapes: part.shapes ?? [part.shape] });
}

// ---------------------------------------------------------------- the magazine, its pedestal and the flap
function magazine() {
  // one stand under the magazine, level with the open flap, with two steel guides in front of the flap that the
  // magazine runs out on
  const PX = [MAG.x + 8, MAG.x + MAG.w - 8];
  const step = FLAP.y + FLAP.len;
  const front = MAG.y + MAG.d - 8;
  block("stand.mag.pedestal", PX, [FLAP.y + 1.5, front], [FLOOR_Z, FLAP.z - 1.5], { details: { seams: [FLOOR_Z + 20] } });
  for (const [i, gx0] of [PX[0], PX[1] - 8].entries()) block(`stand.mag.guide.${i + 1}`, [gx0, gx0 + 8], [step, front], [FLAP.z - 1.5, MAG_TOP - 40], { material: "steel", details: { dots: [step + 10, front - 10].map((y) => ({ at: [MAG_TOP - 40, gx0 + 4, y], normal: [0, 0, 1], size: 0.45 })) } });
  // the magazine: 15 pockets on a 32 mm grid, with the dealer's photo's occupancy (C1R1, C2R1, C2R5 and C3R2 empty)
  const cols = [MAG.x + MAG.w - 17, MAG.x + MAG.w - 49, MAG.x + MAG.w - 81]; // C1 nearest the cradle … C3
  const rows = [0, 1, 2, 3, 4].map((i) => MAG.y + 16 + i * 32); // back … front (R5 … R1)
  const pockets = [];
  rows.forEach((y, r) => cols.forEach((x, c) => pockets.push({ x, y, c: c + 1, r: 5 - r })));
  const empty = new Set(["1/1", "2/1", "2/5", "3/2"]);
  const svg = [S(k.slabOf(MAG, MAG_TOP - 40, 40, P, 3, 1), { tone: "mid", inner: Ln(k.sideSeam(MAG, MAG_TOP - 8, P, 3), { tone: "faint" }) })];
  const sorted = pockets.slice().sort((u, w) => k.depthOf([u.x, u.y, MAG_TOP], P) - k.depthOf([w.x, w.y, MAG_TOP], P));
  for (const { x, y, c, r } of sorted) {
    svg.push(S(k.cylinder(x, y, 7, MAG_TOP, 6, P, 24, 0.3), { tone: "mid" }));
    svg.push(Ln(k.ring(x, y, 3.8, MAG_TOP + 6, P, 18), { tone: "lo" }));
    svg.push(Dots([at([x - 7.8, y + 7.8, MAG_TOP]), at([x + 7.8, y - 7.8, MAG_TOP])], { size: 0.45 }));
    if (!empty.has(`${c}/${r}`)) svg.push(S(k.cylinder(x, y, 3, MAG_TOP + 6, 27, P, 16), { tone: "mid", crease: "faint" }));
  }
  T.fixed({ name: "magazine", group: gm, layer: live, svg: svg.join(""), anchor: [MAG.x + MAG.w / 2, MAG.y + MAG.d / 2, MAG_TOP - 20], shapes: [A.slab(MAG, MAG_TOP - 40, 40 + 33)] });
  // the flap, shown open (flat): a plate on a hinge barrel along its bottom edge
  T.round({ name: "flap.barrel", group: gf, layer: live, F: frameOf([0, FLAP.y, FLAP.z], [1, 0, 0], [0, 1, 0]), s0: FLAP.x[0], s1: FLAP.x[1], r: 1.5, tone: "mid", material: "steel" });
  const flap = block("flap", FLAP.x, [FLAP.y + 1.5, FLAP.y + FLAP.len], [FLAP.z - 1.5, FLAP.z + 1.5], { group: gf, material: "steel" });
  // on its outer face: two hinge leaves with screws at the hinge edge, and a pull along the free edge
  const leaf = (x0) => `<path class="iso-line" data-tone="lo" d="${roundRect(x0, FLAP.y + 2.5, x0 + 16, FLAP.y + 10, 1)}"/>${screwHead(x0 + 4.5, FLAP.y + 6.5, 1.3)}${screwHead(x0 + 11.5, FLAP.y + 6.5, 1.3)}`;
  const pullY = FLAP.y + FLAP.len - 6;
  const flapFace = leaf(FLAP.x[0] + 7) + leaf(FLAP.x[1] - 23) + `<path class="iso-line" data-tone="lo" d="${roundRect((FLAP.x[0] + FLAP.x[1]) / 2 - 22, pullY - 2, (FLAP.x[0] + FLAP.x[1]) / 2 + 22, pullY + 2, 2)}"/>`;
  T.plane({ part: flap, o: [0, 0, FLAP.z + 1.5], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], svg: flapFace });
}

chamber();
ram();
spindle();
magazine();

const verify = argv.includes("--verify");
const out = T.build({ statics: R.items, poses, verify, fullClouds: true });
A.settle(R, P);
const layerOf = (name) => R.items.filter((item) => item.layer === name).sort((u, w) => u.key - w.key).map((item) => item.svg);

if (argv.includes("--audit")) {
  A.auditOrExit(R, P);
  TA.orbitOrExit(T, R, P, {
    sweep: { at: (x) => follow({ x: TRAVEL.x / 2, y: Y_DISC, z: 0, a: x, b: 30 * Math.sin((x * Math.PI) / 90), m: 1 }), from: -180, to: 180, frame: 0.5 },
    clips: [{ name: "tour", at: (t) => follow(tourAt(t)), from: 0, to: TOUR_LEN, frame: 1 / 10 }],
    quick: argv.includes("--quick"),
    only: argv.find((x) => x.startsWith("--only="))?.slice(7).split(",") ?? null,
    log: argv.includes("--verbose") ? (text) => console.log(`  … ${text}`) : null,
  });
}

const LABEL =
  "Inside the machining chamber of a 5-axis dental mill. A gold cradle, open at the front, holds a square disc holder on a horizontal shaft between a small hub on the left and a larger hub on the right. The holder turns all the way round on that shaft (A), and the whole cradle tilts left or right (B). The cradle slides toward the operator and back (X) on a ram through the back wall. Above it the spindle points straight down, with a coolant nozzle on each side; its column runs left and right along the back wall (Y) and the head slides up and down the column (Z). To the left a tool magazine holds burs in fifteen pockets; it slides out through a window in the wall over a flap door hinged at the bottom, and back in, when the spindle comes for a tool.";
// the five controls: each names its axis and shows its position
const AXES = [
  { key: "X", name: "cradle in and out", range: `0 to ${TRAVEL.x} mm` },
  { key: "Y", name: "spindle left and right", range: `0 to ${TRAVEL.y} mm` },
  { key: "Z", name: "spindle up and down", range: `0 to −${TRAVEL.z} mm` },
  { key: "A", name: "holder turns", range: "360°" },
  { key: "B", name: "cradle tilts", range: `±${SPEC.bLimit}°` },
];
const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: layerOf("back") });
const staticSvg = (list) => `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer" viewBox="0 0 ${W} ${H}" aria-hidden="true">${list.join("")}</svg>`;
const KEYS_HELP = "Press X, Y, Z, A or B to choose an axis, then the arrow keys to move it: up and right raise its value, down and left lower it; Page Up and Page Down take big steps; Home and End go to the axis's ends; 0 returns every axis home. With a mouse or a finger, choose an axis below and drag across the picture. The Tour button plays or pauses the tour.";
const stage = `<div class="iso-stage iso-turn tr-stage" tabindex="0" role="slider" aria-label="Y axis, spindle left and right" aria-describedby="tr-help" aria-valuemin="0" aria-valuemax="${TRAVEL.y}" aria-valuenow="${Y_DISC}" aria-valuetext="Y ${Y_DISC} millimetres, spindle over the disc centre">${backSvg}${out.layerSvg("machine", { width: W, height: H })}${staticSvg(layerOf("front"))}</div><span class="tr-help" id="tr-help">${KEYS_HELP}</span>`;
const axesRow = `<div class="tr-axes" role="group" aria-label="Axis to move">${AXES.map((ax) => `<button type="button" class="tr-axis" data-axis="${ax.key}" aria-pressed="${ax.key === "Y"}" title="${ax.key}: ${ax.name}, ${ax.range}"><span class="tr-axis-key">${ax.key}</span><span class="tr-axis-value" data-value="${ax.key}"></span></button>`).join("")}<button type="button" class="tr-axis tr-tour" aria-pressed="true" title="Play or pause the tour"><span class="tr-axis-key">Tour</span></button></div>`;

const CSS = `${out.css}
.iso{--tr-ring:#1c1c1e;--tr-disc:#ffffff;--tr-disc-a:.10;--tr-bevel:#9a9aa0;--tr-hole:#0d0d0e;--tr-screw:#8f8f94;--tr-recess:#161618}
.iso[data-theme="light"]{--tr-ring:#4a4a50;--tr-disc:#ffffff;--tr-disc-a:.5;--tr-bevel:#e4e4e6;--tr-hole:#55555a;--tr-screw:#b9b9bd;--tr-recess:#d3d3d6}
.tr-ring{fill:var(--tr-ring)}
.tr-disc{fill:var(--tr-disc);fill-opacity:var(--tr-disc-a)}
.tr-bevel{fill:var(--tr-bevel)}
.tr-shade{opacity:.3}
.tr-hole,.tr-gap{fill:var(--tr-hole)}
.tr-recess{fill:var(--tr-recess)}
.tr-screw{fill:var(--tr-screw);stroke:var(--anatomy-lo);stroke-width:.3}
.tr-black .iso-fill,.tr-black .iso-shade,.tr-black .iso-top{fill:var(--tr-ring)}
.tr-stage{touch-action:pan-y pinch-zoom;cursor:grab}
.tr-stage[data-drag]{cursor:grabbing}
.tr-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.tr-axes{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:12px 0 10px}
.tr-axis{display:inline-flex;align-items:baseline;gap:7px;padding:6px 10px;border:0;border-radius:3px;background:transparent;box-shadow:inset 0 0 0 1px var(--anatomy-lo);color:var(--anatomy-muted);font:10.5px/1 var(--anatomy-mono);letter-spacing:.04em;font-variant-numeric:tabular-nums;cursor:pointer;transition:box-shadow .2s var(--anatomy-ease),color .2s var(--anatomy-ease)}
.tr-axis-key{color:var(--anatomy-text);font-weight:600}
.tr-axis-value{flex:none;letter-spacing:0;text-align:right}
[data-value="A"]{width:7ch}
[data-value="Z"],[data-value="B"]{width:6ch}
[data-value="X"],[data-value="Y"]{width:5ch}
.tr-help{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tr-axis[aria-pressed="true"]{box-shadow:inset 0 0 0 1px var(--anatomy-hi);color:var(--anatomy-strong)}
.tr-axis[data-moving]{color:var(--anatomy-strong)}
.tr-axis[data-moving] .tr-axis-key{color:var(--anatomy-lit)}
.tr-axis:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
@media (max-width:480px){.tr-axes{gap:4px}.tr-axis{padding:6px 5px;gap:4px;font-size:9.5px;letter-spacing:0}}
@media (prefers-reduced-motion: reduce){.tr-axis{transition:none}}
`;
const DATA = { turn: out.data };
const modelScript = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA)).replace("const follow = null;", `const follow = ${follow.toString()};`);
const body =
  `<style>${CSS}</style><div class="tr-plate">` +
  k.plateHtml({
    fig: "Fig 2",
    title: "Five axes",
    hint: "Drag · arrows · X Y Z A B",
    readout: readoutOf(HOME),
    keys: [
      { mark: "lit", label: "The disc: X, A and B move it; Y and Z bring the bur to it" },
      { mark: "raised", label: "Cradle (gold): slides in and out on X, tilts ±30° on B, and turns the holder 360° on A" },
    ],
    caption:
      `Three straight moves and two turns. X slides the cradle toward the operator and back on a ram through the back wall (${TRAVEL.x} mm, from the disc's front edge to past the premill bar at its back edge); Y runs the spindle column left and right along the wall (${TRAVEL.y} mm), far enough to reach the magazine's columns; Z lowers the head down the column (${TRAVEL.z} mm). A turns the holder a full ${SPEC.aRange}° between the small hub on the left and the larger one on the right, and B tilts the whole cradle up to ±${SPEC.bLimit}°, shown about a front-to-back axis through the bolt circle in the cradle's back wall (inferred from the photos, not published). The bur never tilts: the cradle brings the disc to it. When the spindle goes for a tool, the magazine slides out over its flap door, which is hinged at the bottom, and goes back in after; how the spindle reaches the back four rows (perhaps the magazine stopping row by row) is not shown. The figure holds the head clear of the cradle, its ram and the magazine, as the machine's limits would. ` +
      `Specs: ARUM 5X-200 (5 axes; travel X, Y, Z ${TRAVEL.y} × ${TRAVEL.x} × ${TRAVEL.z} mm as ARUM lists them; A 360°, B ±30°; ${SPEC.tools} tools on Ø${SPEC.shank} mm shanks; DC ${SPEC.kw.toFixed(1)} kW, ${SPEC.rpm.toLocaleString("en-US")} rpm; five premill seats P1–P5). Which part moves on which axis, and the letters, are the dealer's: ARUM's sheet lists the ${TRAVEL.y} mm stroke as X, and here it is Y, the spindle's left-right move and the only one long enough to reach the magazine; ARUM's ${TRAVEL.x} mm is the cradle's X. Proportions from the dealer's photos of a 5X-200 and ARUM's product photos, scaled to a standard Ø${SPEC.disc} mm disc (ARUM publishes no disc size for the 5X-200); column, ram, flap and chamber schematic; styling illustrative. Product data from ARUM Dentistry, used with permission.`,
    body: stage + axesRow,
  }) +
  `</div>`;
const page = k.pageHtml({ title: "Five axes", theme: THEME, body, script: turnScript() + modelScript + (verify ? `window.__isoVerify = ${JSON.stringify(out.verify)};\n` : "") + LIVE, width: 680 });
// A claude.ai Artifact page (--artifact=path): no document skeleton of its own (the host adds it), and the figure follows
// the viewer's theme: an explicit data-theme on <html>, else the system setting
const THEME_HOST = `{
  const root = document.documentElement;
  const host = document.querySelector(".tr-host");
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => { const t = root.getAttribute("data-theme"); host.setAttribute("data-theme", t === "light" || t === "dark" ? t : dark.matches ? "dark" : "light"); };
  apply();
  dark.addEventListener("change", apply);
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
}
`;
const artifactPage = () =>
  `<title>ARUM 5X-200 Axes</title><style>${k.ISO_CSS}
:root{--page:#0b0b0b;color-scheme:dark}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--page:#f2f2ef;color-scheme:light}}
:root[data-theme="light"]{--page:#f2f2ef;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--page);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.tr-host{background:var(--anatomy-page);color:var(--anatomy-text);padding-inline:16px;padding-block:40px 64px}
.tr-host .iso-page{width:min(680px,100%);margin:0 auto}
</style><div class="iso tr-host" data-theme="dark"><main class="iso-page">${body}</main></div><script type="module">${(THEME_HOST + turnScript() + modelScript + LIVE).replace(/<\/(script)/gi, "<\\/$1")}</script>`;
const artifactOut = argv.find((a) => a.startsWith("--artifact="))?.slice("--artifact=".length);
if (artifactOut && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = artifactPage();
  writeFileSync(artifactOut, html);
  console.log(`wrote ${artifactOut} · ${(html.length / 1024).toFixed(0)} KB (artifact page)`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const name = `trunnion${verify ? "-verify" : ""}${THEME === "light" ? "-light" : ""}.html`;
  writeFileSync(join(HERE, name), page);
  console.log(`wrote ${name} · ${(page.length / 1024).toFixed(0)} KB · ${out.report.parts} parts · ${out.report.layers.map((l) => `${l.name}: ${l.planar} planes, ${l.framed} framed, ${l.dynamic} dynamic`).join(" · ")} · build ${out.report.seconds.toFixed(1)} s`);
}
export { out };
