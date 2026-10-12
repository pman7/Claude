// Fig 2 · Two rotary axes (ARUM 5X-200): the gold cradle rolls ±30° on B, the disc holder turns 360° on A.
// node build.mjs [--light] [--audit [--quick] [--only=a,b]] [--verify]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../../.claude/skills/anatomy/kit/lathe.mjs";
import * as A from "../../../.claude/skills/anatomy/kit/audit.mjs";
import { turning } from "../../../.claude/skills/anatomy/kit/turn-build.mjs";
import * as TA from "../../../.claude/skills/anatomy/kit/turn-audit.mjs";
import { tubePieces, tubeSvg } from "../../../.claude/skills/anatomy/kit/tube.mjs";
import { turnScript } from "../../../.claude/skills/anatomy/scripts/inline-kit.mjs";
import { SPEC, readoutOf, wordsOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const THEME = argv.includes("--light") ? "light" : "dark";

// World: 1 unit = 1 mm. Origin at the disc centre, where A and B cross. X right (drive side), y toward the
// operator (front), Z up. Depths behind the holder are written as positive distances back (frames point back).
const W = 620;
const H = 560;
const AZIMUTH = 128; // viewer at the front left, as an operator at the open door
const ELEVATION = 30;

// Holder (O-type, from the dealer's photos: 157 square, 25 thick, Ø98.5 disc, P1–P5 premill bar)
const HALF = 78.5;
const THICK = 12.5;
const CHAMFER = 6.5;
const DISC_R = SPEC.disc / 2;
// Cradle (gold, rolls on B about the Y axis through the back-wall flange)
const ARM_L = [-130, -94]; // left arm X span (support side)
const ARM_R = [119, 160]; // right arm X span (A drive side)
const BOSS_R = 28.5;
const WALL = [85, 105]; // back wall Y span
const TOP = 52; // cradle top
const WALL_Z0 = -40;
// Chamber
const FLOOR_Z = -128;
const BACK_Y = 150;
// Spindle head (fixed in this figure; Z parked above the holder's swing)
const TIP_Z = 112;
const S0 = TIP_Z + 43; // nose-ring bottom face (tool sticks out 43, as in the photos)
const BOX = { x: -56, y: -68, w: 113, d: 110, r: 4 }; // spindle 42 behind the box front
const BOX_Z = [S0 + 41, S0 + 150];
// Tool magazine (15 pockets, 32 mm grid), beside the left arm
const MAG = { x: -244, y: -98, w: 100, d: 160, r: 3 };
const MAG_TOP = -14;

const P = k.fitProjection(
  [
    [-250, 110, FLOOR_Z - 6], [200, 110, FLOOR_Z - 6], [200, -BACK_Y - 15, FLOOR_Z - 6], [-250, -BACK_Y - 15, FLOOR_Z - 6],
    [-250, -BACK_Y, BOX_Z[1] + 20], [200, -BACK_Y, BOX_Z[1] + 20], [BOX.x, BOX.y + BOX.d, BOX_Z[1]], [BOX.x + BOX.w, BOX.y + BOX.d, BOX_Z[1]],
  ],
  W,
  H,
  { pad: 30, azimuth: AZIMUTH, elevation: ELEVATION },
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

// ---------------------------------------------------------------- live: cradle (B) and holder (A)
export const T = turning(P, { recorder: R });
const b = T.group("b", { hinge: { point: [0, 0, 0], axis: [0, -1, 0], range: [-SPEC.bLimit, SPEC.bLimit] } });
const a = T.group("a", { parent: b, hinge: { point: [0, 0, 0], axis: [1, 0, 0], range: [-180, 180] } });
const live = T.layer("cradle");
T.stack(["back", "cradle", "front"]);
export const follow = (values) => ({ b: values.b ?? 0, a: values.a ?? 0 });
export const poses = () => {
  const out = [];
  for (let bv = -30; bv <= 30; bv += 7.5) for (let av = -180; av < 180; av += 3) out.push(follow({ b: bv, a: av }));
  return out;
};

const CB = { group: b, layer: live };
const CA = { group: a, layer: live };
// cradle arms and back wall (gold), all one rigid U in plan
const semicircle = Array.from({ length: 25 }, (_, i) => {
  const t = -Math.PI / 2 + (i / 24) * Math.PI;
  return [-BOSS_R * Math.cos(t), BOSS_R * Math.sin(t)];
}).reverse();
T.prism({ name: "cradle.arm.left", ...CB, F: ALONG_X, polygon: backs([[WALL[0], -BOSS_R], [WALL[0], BOSS_R], ...semicircle]), s0: ARM_L[0], s1: ARM_L[1], tone: "mid", material: "gold" });
T.prism({ name: "cradle.rise.left", ...CB, F: ALONG_Y, polygon: [[ARM_L[0], BOSS_R], [ARM_L[1], BOSS_R], [ARM_L[1], TOP], [ARM_L[0] + 18, TOP], [ARM_L[0], TOP - 18]], s0: 8, s1: WALL[0], tone: "mid", material: "gold", bevel: 0.6 });
T.prism({ name: "cradle.arm.right", ...CB, F: ALONG_X, polygon: backs([[-35, -30], [-20, -45], [WALL[0], -45], [WALL[0], TOP], [-35, TOP]]), s0: ARM_R[0], s1: ARM_R[1], tone: "mid", material: "gold", bevel: 0.8 });
const wallScrews = [-68, -34, 0, 34, 68].map((d) => {
  const t = (d * Math.PI) / 180;
  return { at: [ARM_L[0], 0, 0], p: [27.5 * Math.sin(t), -WALL[0], 27.5 * Math.cos(t)] };
});
T.prism({ name: "cradle.wall", ...CB, F: ALONG_X, polygon: backs([[WALL[0], WALL_Z0], [WALL[1], WALL_Z0], [WALL[1], TOP], [WALL[0], TOP]]), s0: ARM_L[0], s1: ARM_R[1], tone: "mid", material: "gold", bevel: 0.8, details: { dots: wallScrews.map(({ p }) => ({ at: p, normal: [0, 1, 0], size: 0.55, tone: "mid" })), rings: wallScrews.map(({ p }) => ({ at: p, normal: [0, 1, 0], r: 5, tone: "lo" })) } });
T.prism({ name: "cradle.hat", ...CB, F: ALONG_Y, polygon: [[-45, TOP], [45, TOP], [33, TOP + 12], [-33, TOP + 12]], s0: WALL[0], s1: WALL[1], tone: "mid", material: "gold", bevel: 0.5 });
// B knuckle on the wall's back face, against the fixed B bearing housing
const KNUCKLE = [WALL[1], WALL[1] + 6];
T.round({ name: "cradle.b-knuckle", ...CB, F: ALONG_Y, s0: KNUCKLE[0], s1: KNUCKLE[1], r: 34, tone: "mid", material: "steel" });
// hubs (silver): left end cap and bearing cap on the support arm, drive housing on the right arm
T.round({ name: "hub.left.cap", ...CB, F: ALONG_X, s0: ARM_L[0] - 5, s1: ARM_L[0], r: 29.5, tone: "mid", material: "steel", details: { bolts: [{ s: ARM_L[0] - 5, r: 22, count: 4, phase: 0.4, size: 0.5 }] } });
T.round({ name: "hub.left.bearing", ...CB, F: ALONG_X, s0: ARM_L[1], s1: ARM_L[1] + 6, r: 30, tone: "mid", material: "steel", details: { bolts: [{ s: ARM_L[1] + 6, r: 26, count: 4, phase: 0.2, size: 0.5 }] } });
T.round({ name: "hub.right.drive", ...CB, F: ALONG_X, s0: 91, s1: ARM_R[0], r: 42.5, tone: "mid", material: "steel", details: { seams: [96], bolts: [{ s: 91, r: 36, count: 6, phase: 0.25, size: 0.5 }] } });

// holder (A): one plate; the disc, clamp ring and labels are drawn in the planes of its faces
const plate = [[-HALF + CHAMFER, -HALF], [HALF - CHAMFER, -HALF], [HALF, -HALF + CHAMFER], [HALF, HALF - CHAMFER], [HALF - CHAMFER, HALF], [-HALF + CHAMFER, HALF], [-HALF, HALF - CHAMFER], [-HALF, -HALF + CHAMFER]];
// holder frame: u = −X, v = back, so markup reads with v toward the back wall at A = 0
const HF = { o: [0, 0, 0], a: [0, 0, 1], u: [-1, 0, 0], v: [0, -1, 0] };
const barDots = [-42, -21, 0, 21, 42].map((x) => ({ at: [0, x, HALF], normal: [0, -1, 0], size: 0.6, tone: "lo" }));
const barScrews = [-63, -32, 32, 63].map((x) => ({ at: [0, x, HALF], normal: [0, -1, 0], size: 0.55, tone: "mid" }));
const holder = T.prism({
  name: "holder.plate",
  ...CA,
  F: HF,
  polygon: plate,
  s0: -THICK,
  s1: THICK,
  tone: "hi",
  crease: "lo",
  material: "steel",
  details: {
    seams: [0],
    dots: [...barDots, ...barScrews],
    rings: [...barDots.map((d) => ({ at: d.at, normal: d.normal, r: 3.2, tone: "lo" })), ...barScrews.map((d) => ({ at: d.at, normal: d.normal, r: 2.8, tone: "lo" }))],
  },
});
const circle = (r, n = 96) => Array.from({ length: n + 1 }, (_, i) => `${i ? "L" : "M"}${(r * Math.cos((i / n) * 2 * Math.PI)).toFixed(3)} ${(r * Math.sin((i / n) * 2 * Math.PI)).toFixed(3)}`).join("") + "Z";
const roundRect = (x0, y0, x1, y1, r) => k.pathOf(k.roundedPlan({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, 4), true);
const screwHead = (x, y, r = 2.7) => `<path class="tr-screw" d="${circle(r, 24).replace(/(-?\d+\.\d+) (-?\d+\.\d+)/g, (_, px, py) => `${(+px + x).toFixed(3)} ${(+py + y).toFixed(3)}`)}"/>`;
const shift = (d, x, y) => d.replace(/(-?\d+\.\d+) (-?\d+\.\d+)/g, (_, px, py) => `${(+px + x).toFixed(3)} ${(+py + y).toFixed(3)}`);
// Face B (up at A = 0): black clamp ring with six screws, the slot by the front edge, four blind pockets
const ringScrews = Array.from({ length: 6 }, (_, i) => [56.5 * Math.cos((i * Math.PI) / 3), 56.5 * Math.sin((i * Math.PI) / 3)]);
const faceB = [
  `<path class="tr-ring" fill-rule="evenodd" d="${circle(55)}${circle(45.5)}"/>`,
  `<path class="iso-line" data-tone="lo" d="${circle(55)}"/>`,
  `<path class="iso-line" data-tone="faint" d="${circle(47)}"/>`,
  `<path class="tr-disc" d="${circle(45.5)}"/>`,
  `<path class="iso-line" data-tone="lit" d="${circle(45.5)}"/>`,
  ...ringScrews.map(([x, y]) => screwHead(x, y)),
  `<path class="iso-line" data-tone="lo" d="${roundRect(-31, -HALF + 8, 31, -HALF + 20, 6)}"/>`,
  `<path class="tr-hole" d="${roundRect(-29, -HALF + 11, 29, -HALF + 17, 3)}"/>`,
  ...[[-42, -42], [42, -42], [-42, 42], [42, 42]].map(([x, y]) => `<path class="iso-line" data-tone="lo" d="${shift(circle(5.5, 32), x, y)}"/>`),
  ...[[-70, -62], [70, -62]].map(([x, y]) => `${screwHead(x, y, 3.6)}<path class="iso-line" data-tone="faint" d="${shift(circle(2.2, 24), x, y)}"/>`),
].join("");
T.plane({ part: holder, o: [0, 0, THICK], u: [-1, 0, 0], v: [0, -1, 0], svg: faceB });
// Face A (down at A = 0): the disc in its bore, the recessed field, P1–P5 labels by the premill bar
const faceA = [
  `<path class="iso-line" data-tone="lo" d="${roundRect(-64, -57, 63, 55, 3)}"/>`,
  `<path class="tr-gap" fill-rule="evenodd" d="${circle(DISC_R + 0.9)}${circle(DISC_R)}"/>`,
  `<path class="tr-disc" d="${circle(DISC_R)}"/>`,
  `<path class="iso-line" data-tone="lit" d="${circle(DISC_R)}"/>`,
  `<path class="iso-line" data-tone="lo" d="${roundRect(-56, 58, 55, 68, 2)}"/>`,
  ...ringScrews.map(([x, y]) => `<path class="iso-line" data-tone="lo" d="${shift(circle(1.6, 16), x * 1.02, y * 1.02)}"/>`),
  ...["P1", "P2", "P4", "P5"].map((label, i) => `<text class="iso-face-text" data-tone="lo" font-size="4.2" text-anchor="middle" transform="translate(${[42, 21, -21, -42][i]} 74) scale(-1 1)">${label}</text>`),
].join("");
T.plane({ part: holder, o: [0, 0, -THICK], u: [-1, 0, 0], v: [0, -1, 0], normal: [0, 0, -1], svg: faceA });
// premill strip on the bar edge
T.plane({ part: holder, o: [0, -HALF, 0], u: [-1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0], svg: `<path class="iso-line" data-tone="lo" d="${roundRect(-65.5, -8, 65.5, 8, 1.5)}"/>` });
// shafts: knuckle collars on the holder's sides, flush on the hub faces
T.round({ name: "holder.collar.left", ...CA, F: ALONG_X, s0: ARM_L[1] + 6, s1: -HALF, r: 24, tone: "mid", material: "steel", details: { seams: [-HALF - 3] } });
T.round({ name: "holder.collar.right", ...CA, F: ALONG_X, s0: HALF, s1: 91, r: 29, tone: "mid", material: "steel", details: { seams: [HALF + 4] } });
// side straps on the Face B side
for (const side of [-1, 1]) T.prism({ name: `holder.strap.${side < 0 ? "left" : "right"}`, ...CA, F: HF, polygon: [[side * (HALF - 10), -HALF + 9], [side * (HALF - 1), -HALF + 9], [side * (HALF - 1), HALF - 9], [side * (HALF - 10), HALF - 9]], s0: THICK, s1: THICK + 3, tone: "mid", material: "gunmetal", details: { dots: [-60, 0, 60].map((y) => ({ at: [THICK + 3, side * (HALF - 5.5), y], normal: [0, 0, 1], size: 0.5 })) } });

// ---------------------------------------------------------------- static: chamber, B bearing, spindle, nozzles, magazine
const ground = (shape) => Object.assign(shape, { ground: true });
function chamber() {
  const FLOOR = { x: -258, y: -BACK_Y, w: 452, d: BACK_Y + 112, r: 2 };
  const floorSvg = `<path class="iso-halo" d="${k.haloOf(FLOOR, FLOOR_Z - 8, 8, P)}"/>` + S(k.slabOf(FLOOR, FLOOR_Z - 8, 8, P, 3, 1.2), { tone: "lo", inner: Ln(k.sideSeam(FLOOR, FLOOR_Z - 4, P, 3), { tone: "faint" }) });
  const drains = [[120, 60], [150, -40]];
  const drainSvg = drains.map(([x, y]) => Ln(k.ring(x, y, 16, FLOOR_Z, P, 40) + k.ring(x, y, 11, FLOOR_Z, P, 36), { tone: "lo" }) + Dots(k.dotGrid(x - 6, y - 6, 4, 4, 4, FLOOR_Z, P), { size: 0.45, tone: "lo" })).join("");
  put({ name: "stand.floor", layer: "back", at: [0, 0, FLOOR_Z - 4], bias: -50, svg: floorSvg + drainSvg, shapes: [ground(A.slab(FLOOR, FLOOR_Z - 8, 8))] });
  const WALLP = { x: -258, y: -BACK_Y - 14, w: 452, d: 14, r: 1 };
  const wallTop = BOX_Z[1] + 24;
  const panelScrews = [];
  for (const x of [-240, -120, 0, 120, 176]) for (const z of [FLOOR_Z + 18, 60, wallTop - 16]) panelScrews.push(at([x, -BACK_Y, z]));
  // the Z slide runs in a dark recess behind the head; panel joints run floor to top; a brush-sealed slot crosses the wall
  const onWall = (x, z) => at([x, -BACK_Y, z]);
  const recess = k.pathOf([onWall(-62, 70), onWall(62, 70), onWall(62, wallTop - 8), onWall(-62, wallTop - 8)], true);
  const seams = [-150, 110].map((x) => k.segment([x, -BACK_Y, FLOOR_Z], [x, -BACK_Y, wallTop], P)).join("");
  const wallSvg =
    S(k.slabOf(WALLP, FLOOR_Z, wallTop - FLOOR_Z, P, 2, 1), { tone: "mid" }) +
    `<path class="tr-recess" d="${recess}"/>` +
    Ln(recess, { tone: "lo" }) +
    Ln(seams, { tone: "faint" }) +
    Dots(panelScrews, { size: 0.55 }) +
    Ln(k.pathOf(k.roundedPlan({ x: -236, y: 34, w: 410, d: 8, r: 4 }, 4).map(([x, z]) => onWall(x, z)), true), { tone: "lo" });
  put({ name: "stand.wall", layer: "back", at: [0, -BACK_Y - 7, 40], bias: -40, svg: wallSvg, shapes: [ground(A.slab(WALLP, FLOOR_Z, wallTop - FLOOR_Z))] });
}
function bBearing() {
  const F = ALONG_Y;
  const body = [[KNUCKLE[1], 40], [BACK_Y - 8, 40], [BACK_Y - 8, 50], [BACK_Y, 50]];
  const svg = S(G.solidOf(body, F, P, {}), { tone: "mid", inner: Ln(G.arcOf(F, KNUCKLE[1] + 10, 40, P), { tone: "faint" }) }) + Dots(G.dotsOf(F, BACK_Y - 8, 45, 8, P, { fade: [0.04, 0.42] }), { size: 0.5 });
  put({ name: "stand.b-housing", layer: "back", at: [0, -(KNUCKLE[1] + BACK_Y) / 2, 0], svg, shapes: [A.solid(F, body)] });
}
function head() {
  const F = UP(0, 0);
  const stack = [
    { name: "head.box", svg: S(k.slabOf(BOX, BOX_Z[0], BOX_Z[1] - BOX_Z[0], P, 4, 1.2), { tone: "mid", inner: Ln(k.sideSeam(BOX, BOX_Z[0] + 14, P, 4), { tone: "faint" }) }) + Ln(k.planOutline(k.insetPlan(BOX, 6), BOX_Z[1], P, 4), { tone: "faint" }) + Dots([[BOX.x + 8, BOX_Z[0] + 24], [BOX.x + BOX.w - 8, BOX_Z[0] + 24], [BOX.x + 8, BOX_Z[1] - 10], [BOX.x + BOX.w - 8, BOX_Z[1] - 10]].map(([x, z]) => at([x, BOX.y + BOX.d, z])), { size: 0.5 }), shape: A.slab(BOX, BOX_Z[0], BOX_Z[1] - BOX_Z[0]), at: [0, BOX.y + BOX.d / 2, BOX_Z[0]] },
    { name: "head.ring", svg: S(G.solidOf([[S0 + 25, 38], [S0 + 39, 40], [S0 + 41, 40]], F, P), { tone: "hi", crease: "lo" }), shape: A.solid(F, [[S0 + 25, 38], [S0 + 39, 40], [S0 + 41, 40]]), at: [0, 0, S0 + 33] },
    { name: "head.nose", svg: S(G.solidOf([[S0 + 7, 32.5], [S0 + 25, 32.5]], F, P), { tone: "mid", inner: Ln(G.arcOf(F, S0 + 12, 32.5, P), { tone: "faint" }) }), shape: A.solid(F, [[S0 + 7, 32.5], [S0 + 25, 32.5]]), at: [0, 0, S0 + 16] },
    { name: "head.nose-ring", svg: S(G.solidOf([[S0, 17], [S0 + 2, 19], [S0 + 7, 19]], F, P), { tone: "mid" }), shape: A.solid(F, [[S0, 17], [S0 + 2, 19], [S0 + 7, 19]]), at: [0, 0, S0 + 3.5] },
    { name: "head.shaft", svg: S(G.solidOf([[S0 - 10, 7.5], [S0, 7.5]], F, P), { tone: "mid" }), shape: A.solid(F, [[S0 - 10, 7.5], [S0, 7.5]]), at: [0, 0, S0 - 5] },
    { name: "tool.collar", svg: S(G.solidOf([[S0 - 17, 6.5], [S0 - 10, 6.5]], F, P), { tone: "mid" }) + Faded(G.ribsOf(F, S0 - 17, S0 - 10, 6.5, 6, P, { fade: [0.1, 0.55] }), { tone: "lo" }), shape: A.solid(F, [[S0 - 17, 6.5], [S0 - 10, 6.5]]), at: [0, 0, S0 - 13.5] },
  ];
  // the bur: Ø6 shank, neck, Ø2 ball-end cutter
  const bur = [[TIP_Z, 0], [TIP_Z + 0.4, 0.8, 1], [TIP_Z + 1, 1], [TIP_Z + 7, 1], [TIP_Z + 9, 0.8], [TIP_Z + 12, 0.8], [TIP_Z + 18, 3], [S0 - 17, 3]];
  if (!(S0 - 17 > TIP_Z + 18)) throw new Error("tool: shank shorter than its taper");
  stack.push({ name: "tool.bur", svg: S(G.solidOf(bur, F, P, {}), { tone: "hi", crease: "lo" }), shape: A.solid(F, bur), at: [0, 0, TIP_Z + 12] });
  for (const part of stack) put({ name: part.name, layer: "front", at: part.at, svg: part.svg, shapes: [part.shape] });
  // carriage arm from the head box back to the Z slide on the chamber wall
  const ARMP = { x: -40, y: -BACK_Y, w: 80, d: BOX.y + BACK_Y, r: 2 };
  put({ name: "head.carriage", layer: "front", at: [0, ARMP.y + ARMP.d / 2, BOX_Z[1] - 30], svg: S(k.slabOf(ARMP, BOX_Z[1] - 60, 60, P, 3, 0.8), { tone: "mid" }), shapes: [A.slab(ARMP, BOX_Z[1] - 60, 60)] });
}
function nozzles() {
  const aim = [0, 0, S0 - 29];
  for (const side of [-1, 1]) {
    const block = { x: side * 54 - 6, y: 16, w: 12, d: 14, r: 1.5 };
    const z1 = BOX_Z[0];
    const z0 = z1 - 10;
    put({ name: `nozzle.block.${side}`, layer: "front", at: [side * 54, 23, z0 + 5], svg: S(k.slabOf(block, z0, 10, P, 3, 0.4), { tone: "mid" }), shapes: [A.slab(block, z0, 10)] });
    const from = [side * 54, 23, z0];
    const dir = G.unit3(G.sub3(aim, from));
    const tipAt = G.add3(from, G.mul3(dir, G.len3(G.sub3(aim, from)) - 16));
    const hose = [from, G.add3(tipAt, G.mul3(dir, -8))];
    const pieces = tubePieces(hose, 2.2, P, { maxLength: 7, caps: [false, false], rings: { pitch: 3.2, fade: [0.1, 0.55], tone: "lo" } });
    pieces.forEach((piece, index) => put({ name: `nozzle.hose.${side}:${index}`, layer: "front", at: piece.mid, svg: tubeSvg(piece, { tone: "mid" }), shapes: [A.tube(piece.points, piece.radii)] }));
    const TF = frameOf(hose[1], dir, [0, 0, 1]);
    put({ name: `nozzle.tip.${side}`, layer: "front", at: G.add3(hose[1], G.mul3(dir, 4)), svg: `<g class="tr-black">${S(G.solidOf([[0, 3], [5, 3], [8, 1.6]], TF, P, {}), { tone: "lo" })}</g>`, shapes: [A.solid(TF, [[0, 3], [5, 3], [8, 1.6]])] });
  }
}
function magazine() {
  const base = { x: MAG.x + 8, y: MAG.y + 8, w: MAG.w - 16, d: MAG.d - 16, r: 2 };
  put({ name: "stand.mag.pedestal", layer: "front", at: [MAG.x + MAG.w / 2, MAG.y + MAG.d / 2, FLOOR_Z + 20], svg: S(k.slabOf(base, FLOOR_Z, MAG_TOP - 40 - FLOOR_Z, P, 3, 0.6), { tone: "lo" }), shapes: [A.slab(base, FLOOR_Z, MAG_TOP - 40 - FLOOR_Z)] });
  const cols = [MAG.x + MAG.w - 17, MAG.x + MAG.w - 49, MAG.x + MAG.w - 81];
  const rows = [0, 1, 2, 3, 4].map((i) => MAG.y + 16 + i * 32);
  const pockets = [];
  for (const y of rows) for (const x of cols) pockets.push([x, y]);
  const empty = new Set([7, 13]); // one tool is in the spindle; one pocket spare
  const parts = [S(k.slabOf(MAG, MAG_TOP - 40, 40, P, 3, 1), { tone: "mid", inner: Ln(k.sideSeam(MAG, MAG_TOP - 8, P, 3), { tone: "faint" }) })];
  const sorted = pockets.map((p, i) => ({ p, i })).sort((u, w) => k.depthOf([...u.p, MAG_TOP], P) - k.depthOf([...w.p, MAG_TOP], P));
  for (const { p: [x, y], i } of sorted) {
    parts.push(S(k.cylinder(x, y, 8, MAG_TOP, 3, P, 24, 0.3), { tone: "mid" }));
    parts.push(Ln(k.ring(x, y, 4.2, MAG_TOP + 3, P, 20), { tone: "lo" }));
    if (!empty.has(i)) {
      parts.push(S(k.cylinder(x, y, 6.5, MAG_TOP + 3, 7, P, 6), { tone: "mid" }));
      parts.push(S(k.cylinder(x, y, 3, MAG_TOP + 10, 22, P, 16), { tone: "hi", crease: "lo" }));
    }
  }
  const height = 32 + 3;
  put({ name: "stand.mag", layer: "front", at: [MAG.x + MAG.w / 2, MAG.y + MAG.d / 2, MAG_TOP - 20], svg: parts.join(""), shapes: [A.slab(MAG, MAG_TOP - 40, 40 + height)] });
}

chamber();
bBearing();
head();
nozzles();
magazine();

const verify = argv.includes("--verify");
const out = T.build({ statics: R.items, poses, verify });
A.settle(R, P);
const layerOf = (name) => R.items.filter((item) => item.layer === name).sort((u, w) => u.key - w.key).map((item) => item.svg);

if (argv.includes("--audit")) {
  A.auditOrExit(R, P);
  TA.orbitOrExit(T, R, P, {
    sweep: { at: (x) => follow({ a: x, b: 30 * Math.sin((x * Math.PI) / 90) }), from: -180, to: 180, frame: 0.5 },
    clips: [-150, -90, 0, 60, 120].map((av) => ({ name: `b@${av}`, at: (t) => follow({ a: av, b: -30 + 30 * t }), from: 0, to: 2, frame: 1 / 30 })),
    quick: argv.includes("--quick"),
    only: argv.find((x) => x.startsWith("--only="))?.slice(7).split(",") ?? null,
    log: argv.includes("--verbose") ? (text) => console.log(`  … ${text}`) : null,
  });
}

const LABEL =
  "Inside the machining chamber of a 5-axis dental mill. A gold cradle, open at the front, holds a square disc holder on a horizontal shaft between a support hub on the left and a drive hub on the right; the holder can turn all the way round on that shaft. The whole cradle can roll left or right about a front-to-back axis through a bearing in its back wall. Above it the spindle points straight down, with a coolant nozzle on each side; to the left a tool magazine holds burs standing in fifteen pockets.";
const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: layerOf("back") });
const staticSvg = (list) => `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer" viewBox="0 0 ${W} ${H}" aria-hidden="true">${list.join("")}</svg>`;
const stage = `<div class="iso-stage iso-turn tr-stage" tabindex="0" role="slider" aria-label="Disc holder. Drag sideways or press left and right to turn the holder on A; drag up and down or press up and down to roll the cradle on B; 1 and 2 show each face; Home returns to zero." aria-valuemin="-30" aria-valuemax="30" aria-valuenow="0" aria-valuetext="${wordsOf(0, 0)}">${backSvg}${out.layerSvg("cradle", { width: W, height: H })}${staticSvg(layerOf("front"))}<span class="tr-sr" role="status" aria-live="polite" data-status></span></div>`;

const CSS = `${out.css}
.iso{--tr-ring:#1c1c1e;--tr-disc:#3a3a3d;--tr-hole:#0d0d0e;--tr-screw:#8f8f94;--tr-recess:#161618}
.iso[data-theme="light"]{--tr-ring:#3b3b40;--tr-disc:#f4f4f1;--tr-hole:#55555a;--tr-screw:#b9b9bd;--tr-recess:#d3d3d6}
.tr-ring{fill:var(--tr-ring)}
.tr-disc{fill:var(--tr-disc)}
.tr-hole,.tr-gap{fill:var(--tr-hole)}
.tr-recess{fill:var(--tr-recess)}
.tr-screw{fill:var(--tr-screw);stroke:var(--anatomy-lo);stroke-width:.3}
.tr-black .iso-fill,.tr-black .iso-shade,.tr-black .iso-top{fill:var(--tr-ring)}
.tr-stage{touch-action:none}
.tr-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.tr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:480px){.tr-plate .iso-plate-corner[data-corner="readout"]{font-size:9px;letter-spacing:0}}
`;
const DATA = { turn: out.data };
const modelScript = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA)).replace("const follow = null;", `const follow = ${follow.toString()};`);
const body =
  `<style>${CSS}</style><div class="tr-plate">` +
  k.plateHtml({
    fig: "Fig 2",
    title: "Two rotary axes",
    hint: "Drag · arrows · 1 2 faces",
    readout: readoutOf(0, 0),
    keys: [
      { mark: "lit", label: "The disc: what the two axes point at the bur" },
      { mark: "raised", label: "Gold cradle (B, ±30°) carrying the holder on its A shaft (360°)" },
    ],
    caption:
      `B rolls the whole cradle up to ±${SPEC.bLimit}° about a front-to-back axis through the bearing in its back wall; A turns the holder a full ${SPEC.aRange}° on the shaft between the support hub and the drive hub. Together they tilt the disc under the fixed vertical bur, so undercuts, angled screw channels and the disc's back face can be reached without unclamping it. ` +
      `Specs: ARUM 5X-200 (A 360°, B ±30°, ${SPEC.tools} tools on Ø${SPEC.shank} mm shanks, ${SPEC.kw} kW, ${SPEC.rpm.toLocaleString("en-US")} rpm, Ø${SPEC.disc} mm discs, five premill seats P1–P5). Form from the dealer's photos of a 5X-200 chamber; proportions measured from them, styling illustrative. The B axis is inferred from the cradle's back-wall flange. Product data from ARUM Dentistry, used with permission.`,
    body: stage,
  }) +
  `</div>`;
const page = k.pageHtml({ title: "Two rotary axes", theme: THEME, body, script: turnScript() + modelScript + (verify ? `window.__isoVerify = ${JSON.stringify(out.verify)};\n` : "") + LIVE, width: 680 });
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const name = `trunnion${verify ? "-verify" : ""}${THEME === "light" ? "-light" : ""}.html`;
  writeFileSync(join(HERE, name), page);
  console.log(`wrote ${name} · ${(page.length / 1024).toFixed(0)} KB · ${out.report.parts} parts · ${out.report.layers.map((l) => `${l.name}: ${l.planar} planes, ${l.framed} framed, ${l.dynamic} dynamic`).join(" · ")} · build ${out.report.seconds.toFixed(1)} s`);
}
export { out };
