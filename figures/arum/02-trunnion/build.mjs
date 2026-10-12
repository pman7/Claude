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

// Holder (disc cartridge frame, from the dealer's photos: 157 square, 25 thick, Ø98.5 disc, P1–P5 premill bar)
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
const FLOOR_Z = -142;
const BACK_Y = 150;
// Spindle head (fixed in this figure; Z parked above the holder's swing)
const TIP_Z = 112;
const S0 = TIP_Z + 43; // nose-ring bottom face (tool sticks out 43, as in the photos)
const BOX = { x: -56, y: -68, w: 113, d: 110, r: 4 }; // spindle 42 behind the box front
const BOX_Z = [S0 + 41, S0 + 200];
// Tool magazine (15 pockets, 32 mm grid), beside the left arm
const MAG = { x: -244, y: -138, w: 100, d: 160, r: 3 };
const MAG_TOP = -4;

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
// B knuckle on the wall's back face, flush against the stainless box behind the cradle
const KNUCKLE = [WALL[1], WALL[1] + 6];
T.round({ name: "cradle.b-knuckle", ...CB, F: ALONG_Y, s0: KNUCKLE[0], s1: KNUCKLE[1], r: 34, tone: "mid", material: "steel" });
// hubs (silver): left end cap and bearing cap on the support arm, drive housing on the right arm
T.round({ name: "hub.left.cap", ...CB, F: ALONG_X, s0: ARM_L[0] - 5, s1: ARM_L[0], r: 29.5, tone: "mid", material: "steel", details: { bolts: [{ s: ARM_L[0] - 5, r: 22, count: 6, phase: 0, size: 0.5 }] } });
T.round({ name: "hub.left.bearing", ...CB, F: ALONG_X, s0: ARM_L[1], s1: ARM_L[1] + 6, r: 30, tone: "mid", material: "steel", details: { bolts: [{ s: ARM_L[1] + 6, r: 26, count: 4, phase: 0.2, size: 0.5 }] } });
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

// ---------------------------------------------------------------- static: chamber, rear box, spindle, nozzles, magazine
const ground = (shape) => Object.assign(shape, { ground: true });
function chamber() {
  const FLOOR = { x: -258, y: -BACK_Y - 14, w: 452, d: BACK_Y + 14 + 112, r: 2 };
  const floorSvg = `<path class="iso-halo" d="${k.haloOf(FLOOR, FLOOR_Z - 8, 8, P)}"/>` + S(k.slabOf(FLOOR, FLOOR_Z - 8, 8, P, 3, 1.2), { tone: "lo", inner: Ln(k.sideSeam(FLOOR, FLOOR_Z - 4, P, 3), { tone: "faint" }) });
  // a sheet joint across the floor, edge to edge, and a soft shadow under the cradle
  const joint = Ln(k.lineOnTop([FLOOR.x, -20], [FLOOR.x + FLOOR.w, -20], FLOOR_Z, P), { tone: "faint" });
  const shadow = `<path class="iso-halo tr-shade" d="${k.haloOf({ x: -150, y: -100, w: 320, d: 150, r: 40 }, FLOOR_Z, 0.1, P)}" style="filter:blur(10px)"/>`;
  const drains = [[120, 60], [150, -60]];
  const drainSvg = drains.map(([x, y]) => S(k.cylinder(x, y, 18, FLOOR_Z, 1.2, P, 40, 0.3), { tone: "mid" }) + Ln(k.ring(x, y, 12, FLOOR_Z + 1.2, P, 36), { tone: "lo" }) + Dots(k.dotGrid(x - 6, y - 6, 4, 4, 4, FLOOR_Z + 1.2, P), { size: 0.45, tone: "lo" }) + Dots([0, 1, 2, 3, 4, 5].map((j) => at([x + 15 * Math.cos(j * 1.047 + 0.3), y + 15 * Math.sin(j * 1.047 + 0.3), FLOOR_Z + 1.2])), { size: 0.45 })).join("");
  const SILL = { x: FLOOR.x, y: 112 - 10, w: FLOOR.w, d: 10, r: 1 };
  const sillSvg = S(k.slabOf(SILL, FLOOR_Z, 4, P, 2, 0.4), { tone: "mid" }) + Dots([-230, -120, 0, 120, 176].map((x) => at([x, 107, FLOOR_Z + 4])), { size: 0.5 });
  put({ name: "stand.floor", layer: "back", at: [0, 0, FLOOR_Z - 4], bias: -50, svg: floorSvg + joint + shadow + drainSvg + sillSvg, shapes: [ground(A.slab(FLOOR, FLOOR_Z - 8, 8)), A.slab(SILL, FLOOR_Z, 4)] });
  const WALLP = { x: -258, y: -BACK_Y - 14, w: 452, d: 14, r: 1 };
  const wallTop = BOX_Z[1] + 24;
  const onWall = (x, z) => at([x, -BACK_Y, z]);
  const panelScrews = [];
  // the window behind the tool magazine (ARUM's photo of the magazine and the dealer's photo 5): a framed opening onto
  // the machine's interior, its lower part hidden by the magazine (size and height read from the photos, not published)
  const WIN = { x: [-205, -130], z: [-4, 50] };
  const inWindow = (x, z) => x > WIN.x[0] - 4 && x < WIN.x[1] + 4 && z > WIN.z[0] - 4 && z < WIN.z[1] + 4;
  for (const x of [-240, -160, -140, 100, 120, 176]) for (let z = FLOOR_Z + 18; z < wallTop - 10; z += 40) if (!inWindow(x, z)) panelScrews.push(onWall(x, z));
  for (let x = -220; x < 180; x += 40) panelScrews.push(onWall(x, wallTop - 12));
  // the Z slide runs in a recess behind the head: its floor and right side are visible, with two rails inside
  const RX = [-62, 62];
  const RZ = [70, wallTop - 8];
  const DEEP = 12;
  const recessOutline = k.pathOf([onWall(RX[0], RZ[0]), onWall(RX[1], RZ[0]), onWall(RX[1], RZ[1]), onWall(RX[0], RZ[1])], true);
  const recessBack = k.pathOf([[RX[0], RZ[0]], [RX[1], RZ[0]], [RX[1], RZ[1]], [RX[0], RZ[1]]].map(([x, z]) => at([x, -BACK_Y - DEEP, z])), true);
  const recessFloor = k.pathOf([[RX[0], -BACK_Y], [RX[1], -BACK_Y], [RX[1], -BACK_Y - DEEP], [RX[0], -BACK_Y - DEEP]].map(([x, y]) => at([x, y, RZ[0]])), true);
  const recessSide = k.pathOf([[RZ[0], -BACK_Y], [RZ[1], -BACK_Y], [RZ[1], -BACK_Y - DEEP], [RZ[0], -BACK_Y - DEEP]].map(([z, y]) => at([RX[1], y, z])), true);
  const rails = [-48, 30].map((x) => S(k.slabOf({ x, y: -BACK_Y - DEEP, w: 18, d: 6, r: 1 }, RZ[0], RZ[1] - RZ[0], P, 2, 0.4), { tone: "mid" })).join("");
  const recessSvg = `<g clip-path="url(#tr-recess)"><path class="tr-recess" d="${recessBack}"/><path class="iso-top" d="${recessFloor}"/><path class="iso-shade" data-shade="1" d="${recessSide}"/>${rails}</g>` + Ln(recessOutline, { tone: "lo" });
  // panel seams, the left one broken by the window
  const seams = [[-150, FLOOR_Z, WIN.z[0]], [-150, WIN.z[1], wallTop], [110, FLOOR_Z, wallTop]].map(([x, z0, z1]) => k.segment([x, -BACK_Y, z0], [x, -BACK_Y, z1], P)).join("");
  const box = ([x0, x1], [z0, z1]) => k.pathOf([onWall(x0, z0), onWall(x1, z0), onWall(x1, z1), onWall(x0, z1)], true);
  const winOuter = box(WIN.x, WIN.z);
  const winInner = box([WIN.x[0] + 3, WIN.x[1] - 3], [WIN.z[0] + 3, WIN.z[1] - 3]);
  const LEDGE = { x: -258, y: -BACK_Y, w: 190, d: 8, r: 1 };
  // the brushed slot sits centred just above the stainless box (dealer's photo 3); from this high view the box mostly hides it
  const slot = k.pathOf(k.roundedPlan({ x: -65, y: 41, w: 130, d: 8, r: 4 }, 4).map(([x, z]) => onWall(x, z)), true);
  const brush = k.pathOf(k.roundedPlan({ x: -63, y: 43.5, w: 126, d: 3, r: 1.5 }, 4).map(([x, z]) => onWall(x, z)), true);
  const wallSvg =
    `<defs><clipPath id="tr-recess"><path d="${recessOutline}"/></clipPath></defs>` +
    S(k.slabOf(WALLP, FLOOR_Z, wallTop - FLOOR_Z, P, 2, 1), { tone: "mid" }) +
    recessSvg +
    Ln(seams, { tone: "faint" }) +
    Dots(panelScrews, { size: 0.5 }) +
    `<path class="tr-recess" d="${winInner}"/>` + Ln(winOuter, { tone: "lo" }) + Ln(winInner, { tone: "lo" }) +
    `<path class="tr-hole" d="${slot}"/>` + Ln(slot, { tone: "lo" }) + Ln(brush, { tone: "faint" }) +
    S(k.slabOf(LEDGE, 56, 5, P, 2, 0.4), { tone: "mid" });
  put({ name: "stand.wall", layer: "back", at: [0, -BACK_Y - 7, 40], bias: -40, svg: wallSvg, shapes: [ground(A.slab(WALLP, FLOOR_Z, wallTop - FLOOR_Z)), A.slab(LEDGE, 56, 5)] });
}
// the stainless box behind the cradle (the B drive itself is hidden inside the machine)
function rearBox() {
  const BOXR = { x: -77.5, y: -BACK_Y, w: 155, d: BACK_Y - KNUCKLE[1], r: 1.5 };
  const z0 = -40;
  const z1 = 35;
  const screws = [[-52, -BACK_Y + 8, z1], [52, -BACK_Y + 8, z1], [-57, -KNUCKLE[1], z0 + 8], [57, -KNUCKLE[1], z0 + 8]].map((p) => at(p));
  const svg = S(k.slabOf(BOXR, z0, z1 - z0, P, 2, 0.8), { tone: "mid", inner: Ln(k.sideSeam(BOXR, z1 - 6, P, 2), { tone: "faint" }) }) + Dots(screws, { size: 0.55 });
  put({ name: "stand.rear-box", layer: "back", at: [0, -(KNUCKLE[1] + BACK_Y) / 2, 0], svg, shapes: [A.slab(BOXR, z0, z1 - z0)] });
}
function head() {
  const F = UP(0, 0);
  // the head box, with a 45° chamfer along its bottom front edge
  const HXF = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const yb = BOX.y;
  const yf = BOX.y + BOX.d;
  const prof = [[yb, BOX_Z[0]], [yf - 10, BOX_Z[0]], [yf, BOX_Z[0] + 10], [yf, BOX_Z[1]], [yb, BOX_Z[1]]];
  const boxPaths = G.prismOf(HXF, prof, BOX.x, BOX.x + BOX.w, P);
  const frontScrews = [[BOX.x + 8, BOX_Z[0] + 24], [BOX.x + BOX.w - 8, BOX_Z[0] + 24], [BOX.x + 8, BOX_Z[1] - 10], [BOX.x + BOX.w - 8, BOX_Z[1] - 10]].map(([x, z]) => at([x, yf, z]));
  const boxSeam = k.segment([BOX.x, yf, BOX_Z[0] + 52], [BOX.x + BOX.w, yf, BOX_Z[0] + 52], P);
  const ringProfile = [[S0 + 25, 32.5], [S0 + 29, 40], [S0 + 30, 42.5], [S0 + 41, 42.5]];
  const stack = [
    { name: "head.box", svg: S(boxPaths, { tone: "mid", inner: Ln(boxSeam, { tone: "faint" }) }) + Dots(frontScrews, { size: 0.5 }), shape: A.prism(HXF, prof, BOX.x, BOX.x + BOX.w), at: [0, BOX.y + BOX.d / 2, BOX_Z[0]] },
    { name: "head.ring", svg: S(G.solidOf(ringProfile, F, P), { tone: "hi", crease: "lo" }), shape: A.solid(F, ringProfile), at: [0, 0, S0 + 33] },
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
  const armScrews = [[-30, BOX.y - 10], [30, BOX.y - 10], [-30, -BACK_Y + 10], [30, -BACK_Y + 10]].map(([x, y]) => at([x, y, BOX_Z[1]]));
  put({ name: "head.carriage", layer: "front", at: [0, ARMP.y + ARMP.d / 2, BOX_Z[1] - 30], svg: S(k.slabOf(ARMP, BOX_Z[1] - 60, 60, P, 3, 0.8), { tone: "mid", inner: Ln(k.sideSeam(ARMP, BOX_Z[1] - 46, P, 3), { tone: "faint" }) }) + Dots(armScrews, { size: 0.5 }), shapes: [A.slab(ARMP, BOX_Z[1] - 60, 60)] });
}
// coolant: on each side a hex block with a domed swivel under the head, a short rigid Ø5 tube and a black tip,
// aimed at a point on the spindle axis 29 mm below the nose
function nozzles() {
  const aim = [0, 0, S0 - 29];
  const top = BOX_Z[0];
  for (const side of [-1, 1]) {
    const c = [side * 48, 33];
    const hex = Array.from({ length: 6 }, (_, j) => [c[0] + 9.8 * Math.cos((j * Math.PI) / 3), c[1] + 9.8 * Math.sin((j * Math.PI) / 3)]);
    const hexSvg = S(k.extrude(hex, top - 10, 10, P, { bevel: 0.3 }), { tone: "mid" });
    const DF = UP(c[0], c[1]);
    const dome = [[top - 17, 0], [top - 16.4, 3, 1], [top - 14.6, 5.4, 1], [top - 12, 7, 1], [top - 10, 7.4]];
    put({ name: `nozzle.block.${side}`, layer: "front", at: [c[0], c[1], top - 8], svg: hexSvg + S(G.solidOf(dome, DF, P, {}), { tone: "mid" }), shapes: [A.extruded(hex, top - 10, 10, { name: `nozzle.hex.${side}`, owner: `nozzle.${side}` }), A.solid(DF, dome, { name: `nozzle.dome.${side}`, owner: `nozzle.${side}` })] });
    const from = [c[0], c[1], top - 12];
    const dir = G.unit3(G.sub3(aim, from));
    const tubeEnd = G.add3(from, G.mul3(dir, 20));
    const TF = frameOf(from, dir, [0, 0, 1]);
    put({ name: `nozzle.tube.${side}`, layer: "front", at: G.add3(from, G.mul3(dir, 12)), svg: S(G.solidOf([[4, 2.5], [20, 2.5]], TF, P, {}), { tone: "hi", crease: "lo" }), shapes: [A.solid(TF, [[4, 2.5], [20, 2.5]], { owner: `nozzle.${side}` })] });
    const tip = [[20, 4.5], [27, 4.5], [30, 2.4]];
    put({ name: `nozzle.tip.${side}`, layer: "front", at: G.add3(tubeEnd, G.mul3(dir, 5)), svg: `<g class="tr-black">${S(G.solidOf(tip, TF, P, {}), { tone: "lo" })}</g>`, shapes: [A.solid(TF, tip, { owner: `nozzle.${side}` })] });
  }
}
function magazine() {
  const base = { x: MAG.x + 8, y: MAG.y + 8, w: MAG.w - 16, d: MAG.d - 16, r: 2 };
  put({ name: "stand.mag.pedestal", layer: "front", at: [MAG.x + MAG.w / 2, MAG.y + MAG.d / 2, FLOOR_Z + 20], svg: S(k.slabOf(base, FLOOR_Z, MAG_TOP - 40 - FLOOR_Z, P, 3, 0.6), { tone: "lo", inner: Ln(k.sideSeam(base, FLOOR_Z + 20, P, 3), { tone: "faint" }) }), shapes: [A.slab(base, FLOOR_Z, MAG_TOP - 40 - FLOOR_Z)] });
  const cols = [MAG.x + MAG.w - 17, MAG.x + MAG.w - 49, MAG.x + MAG.w - 81]; // C1 nearest the cradle … C3
  const rows = [0, 1, 2, 3, 4].map((i) => MAG.y + 16 + i * 32); // back … front (R5 … R1)
  const pockets = [];
  rows.forEach((y, r) => cols.forEach((x, c) => pockets.push({ x, y, c: c + 1, r: 5 - r })));
  // occupancy as in the dealer's photo: C1R1, C2R1, C2R5 and C3R2 empty
  const empty = new Set(["1/1", "2/1", "2/5", "3/2"]);
  const parts = [S(k.slabOf(MAG, MAG_TOP - 40, 40, P, 3, 1), { tone: "mid", inner: Ln(k.sideSeam(MAG, MAG_TOP - 8, P, 3), { tone: "faint" }) })];
  const sorted = pockets.slice().sort((u, w) => k.depthOf([u.x, u.y, MAG_TOP], P) - k.depthOf([w.x, w.y, MAG_TOP], P));
  for (const { x, y, c, r } of sorted) {
    parts.push(S(k.cylinder(x, y, 7, MAG_TOP, 6, P, 24, 0.3), { tone: "mid" }));
    parts.push(Ln(k.ring(x, y, 3.8, MAG_TOP + 6, P, 18), { tone: "lo" }));
    parts.push(Dots([at([x - 7.8, y + 7.8, MAG_TOP]), at([x + 7.8, y - 7.8, MAG_TOP])], { size: 0.45 }));
    if (!empty.has(`${c}/${r}`)) parts.push(S(k.cylinder(x, y, 3, MAG_TOP + 6, 27, P, 16), { tone: "mid", crease: "faint" }));
  }
  put({ name: "stand.mag", layer: "front", at: [MAG.x + MAG.w / 2, MAG.y + MAG.d / 2, MAG_TOP - 20], svg: parts.join(""), shapes: [A.slab(MAG, MAG_TOP - 40, 40 + 33)] });
}

chamber();
rearBox();
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
  "Inside the machining chamber of a 5-axis dental mill. A gold cradle, open at the front, holds a square disc holder on a horizontal shaft between a support hub on the left and a drive hub on the right; the holder can turn all the way round on that shaft. The whole cradle can also roll left or right, shown here about a front-to-back axis through the bolt circle in its back wall (that axis is inferred from photos). Above it the spindle points straight down, with a coolant nozzle on each side; to the left a tool magazine holds burs standing in fifteen pockets.";
const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: layerOf("back") });
const staticSvg = (list) => `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer" viewBox="0 0 ${W} ${H}" aria-hidden="true">${list.join("")}</svg>`;
const stage = `<div class="iso-stage iso-turn tr-stage" tabindex="0" role="slider" aria-label="Disc holder. Left and right arrows turn the holder on A (Shift for 45 degrees); up and down arrows roll the cradle on B (Shift for 5 degrees); 1 and 2 show each face; Home returns to zero; End goes to the B limit. With a mouse, drag sideways for A and up or down for B." aria-valuemin="-30" aria-valuemax="30" aria-valuenow="0" aria-valuetext="${wordsOf(0, 0)}">${backSvg}${out.layerSvg("cradle", { width: W, height: H })}${staticSvg(layerOf("front"))}</div>`;

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
      { mark: "raised", label: "Cradle (gold): rolls ±30° on B, carrying the holder on its A shaft (360°)" },
    ],
    caption:
      `A turns the holder a full ${SPEC.aRange}° on the shaft between the support hub and the drive hub. B rolls the whole cradle up to ±${SPEC.bLimit}°; we show it about a front-to-back axis through the centre of the bolt circle in the cradle's back wall, an inference from the photos rather than published data. Together they tilt the disc under the bur, which never tilts, so undercuts, angled screw channels and the disc's back face can be reached without unclamping it. ` +
      `Specs: ARUM 5X-200 (A 360°, B ±30°, ${SPEC.tools} tools on Ø${SPEC.shank} mm shanks, DC ${SPEC.kw.toFixed(1)} kW, ${SPEC.rpm.toLocaleString("en-US")} rpm, five premill seats P1–P5 on the holder's back edge). Holder (Ø${SPEC.disc} mm disc), cradle, hubs, nozzles and the magazine grid measured from the dealer's photos of a 5X-200 and ARUM's product photos; spindle head, rear box and chamber schematic; styling illustrative. Product data from ARUM Dentistry, used with permission.`,
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
