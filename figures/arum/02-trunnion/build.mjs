// Fig 2 · Five axes (ARUM 5X-200): the cradle slides in and out (X), the spindle travels left and right (Y) and up and
// down (Z), the gold cradle rolls ±30° (B) and the disc holder turns 360° (A); for the tool change the magazine comes
// out over its flap and indexes by row, and the new bur is measured on the sensor post.
// node build.mjs [--light] [--audit [--quick] [--only=a,b]] [--verify] [--artifact=path] [--embed]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../../.claude/skills/anatomy/kit/lathe.mjs";
import * as A from "../../../.claude/skills/anatomy/kit/audit.mjs";
import { turning } from "../../../.claude/skills/anatomy/kit/turn-build.mjs";
import * as TA from "../../../.claude/skills/anatomy/kit/turn-audit.mjs";
import { turnScript } from "../../../.claude/skills/anatomy/scripts/inline-kit.mjs";
import { SPEC, TRAVEL, GEO, HOME, Y_DISC, AXES_DIR, BUR, burRadius, BRIDGE, CONNECTORS, PASS_TRACKS, NOZZLE, POCKETS, SHANK_TOP, pocketAt, leansTable, wrap, magOf, magFor, zLimit, simAt, SIM, SIM_LEN, SIM_SPANS, readoutOf, wordsOf } from "./model.mjs";
import { workSvg, underSvg } from "./work.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const THEME = argv.includes("--light") ? "light" : "dark";

// World: 1 unit = 1 mm. Origin at the disc centre with every axis at 0, where A and B cross. X right (drive side),
// y toward the operator (front), Z up. Depths behind the holder are written as positive distances back (frames point back).
const W = 620;
const H = 560;
const AZIMUTH = 128; // viewer at the front left, as an operator at the open door
const ELEVATION = 30;

// Holder (disc cartridge frame): proportions from the dealer's photos (157 square, 25 thick, P1–P5 premill bar), scaled
// to an assumed standard Ø98.5 disc
const { HALF, THICK, ARM_L, ARM_R, BOSS_R, WALL, TOP, WALL_Z0, KNUCKLE, TIP_Z, MAG, MAG_TOP, POST, PITCH } = GEO;
const CHAMFER = 6.5;
const DISC_R = SPEC.disc / 2;
// Chamber: the back wall's lower band, the ledge across it, and the dark upper band set back behind the column
const FLOOR_Z = GEO.FLOOR;
const BACK_Y = -GEO.WALL_Y;
const WALL_X = [-365, 272];
const WALL_T = 14;
const FRONT_Y = 250; // the floor reaches the door, so the cradle can come forward its full X stroke
const LEDGE = { z: [112, 137], front: -105 }; // a stainless lip across the whole wall, its face 25 tall
const UPPER_Y = -170; // the dark upper wall's face, behind the column
// Spindle head: with Y at 0 the spindle axis is over the sensor post; Z at 0 parks the bur above everything
const HX = GEO.SPINDLE_X0;
const HY = GEO.SPINDLE_Y; // the spindle's line, in front of the B axis
const S0 = TIP_Z + GEO.TOOL; // nose-ring bottom face (tool sticks out 43, as in the photos)
// the bur as drawn: model.mjs's profile from the tip, then the Ø6 shank up into the collar
export const BUR_DRAWN = [...BUR.map(([h, r, round]) => (round ? [TIP_Z + h, r, round] : [TIP_Z + h, r])), [TIP_Z + GEO.COLLET, 3]];
// the head box: 135 wide (about twice the nose's diameter, as in the video), its front 40 ahead of the spindle and its
// back against the column, 165 deep; a gold plate 7 thick between it and the spindle's flange
const BOX = { x: HX - 67.5, y: -70, w: 135, d: HY + 40 + 70, side: 2, chamfer: 15 };
const BOX_Z = [S0 + 48, S0 + 200];
const WALL_TOP = BOX_Z[1] + 24;
// the column: a silver housing about 1.3 times the head's width, from just above the ledge up past the head's top
const COL = { x: [HX - 90, HX + 90], y: [UPPER_Y, BOX.y], z: [LEDGE.z[1] + 3, WALL_TOP - 10] };
// Openings in the lower band: the magazine window (with its flap), taller than wide, and the carriage's opening inside
// a raised collar that runs down to the floor
const WIN = { x: [-250, -133], z: [-42, 90] };
const RAM = GEO.RAM;
// (6 proud of the wall, so the carriage's face is flush with it at X 0, as the video shows; the video's collar stands
// out about 10)
const COLLAR = { out: 97.5, in: 77.5, y: -KNUCKLE[1], top: 105, inTop: 90 };
// Flap: hinged along its bottom edge on two butt hinges against the wall; open, it lies flat at the window sill, level
// with the bay's floor, a shelf the magazine's tray slides out onto; shut, it stands against the wall over the window
// (3 in from the window's cradle side, so it swings clear of the cradle's left end cap with X back)
const FLAP = { y: -BACK_Y + 1.5, z: WIN.z[0] - 1.5, x: [WIN.x[0] + 1, WIN.x[1] - 3], len: WIN.z[1] - WIN.z[0] + 4.5 };
// the magazine's tray (under the block, running on back at sill level through the window as its carrier) and side bar
// (along the block's cradle side; the video shows nothing above the sill behind the block)
const TRAY = { x: [MAG.x - 2, MAG.x + MAG.w + 5], y: [MAG.y - 160, MAG.y + MAG.d + 2], z: [WIN.z[0], WIN.z[0] + 2] };
const BAR = { x: [MAG.x + MAG.w, MAG.x + MAG.w + 5], z: [WIN.z[0] + 2, MAG_TOP - 28] };
// the sensor's cable gland on the wall left of the flap (the video), and the floor cover's front with X at 0
const GLAND = { x: -272, z: -10, len: 9 };
// the floor's raised left part the post stands on (the video's floor is a formed basin: the post stands on its flat
// part, its cap level with the magazine's top, about 135 tall), with a sloped edge down to the floor under the cradle
const PAD = { x: [-210, -185], z: FLOOR_Z + 55 };
const COVER_FRONT = 90;

const P = k.fitProjection(
  [
    [WALL_X[0], FRONT_Y, FLOOR_Z - 6], [WALL_X[1], FRONT_Y, FLOOR_Z - 6], [WALL_X[1], -BACK_Y - WALL_T, FLOOR_Z - 6], [WALL_X[0], -BACK_Y - WALL_T, FLOOR_Z - 6],
    [WALL_X[0], UPPER_Y, WALL_TOP], [WALL_X[1], UPPER_Y, WALL_TOP], [BOX.x, BOX.y + BOX.d, BOX_Z[1]], [BOX.x + BOX.w + TRAVEL.y, BOX.y + BOX.d, BOX_Z[1]],
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
const gx = T.group("x", { slide: { direction: AXES_DIR.x, travel: TRAVEL.x } });
const b = T.group("b", { parent: gx, hinge: { point: [0, 0, 0], axis: AXES_DIR.b, range: [-SPEC.bLimit, SPEC.bLimit] } });
const a = T.group("a", { parent: b, hinge: { point: [0, 0, 0], axis: AXES_DIR.a, range: [-180, 180] } });
// Y: the spindle column runs right from over the sensor post; Z: the head slides down its face from the top
const gy = T.group("y", { slide: { direction: AXES_DIR.y, travel: TRAVEL.y } });
const gz = T.group("z", { parent: gy, slide: { direction: AXES_DIR.z, travel: TRAVEL.z } });
// the magazine slides back through the window from out, and indexes toward the operator a row at a time; the flap swings
// up from flat (0) to shut (90)
const gm = T.group("mag", { slide: { direction: [0, -1, 0], travel: GEO.MAG_STROKE } });
const gr = T.group("magrow", { parent: gm, slide: { direction: [0, 1, 0], travel: 4 * PITCH } });
const gf = T.group("flap", { hinge: { point: [(WIN.x[0] + WIN.x[1]) / 2, FLAP.y, FLAP.z], axis: [1, 0, 0], range: [0, 90] } });
const live = T.layer("machine");
T.stack(["back", "machine", "front"]);
// page values { x, y, z, a, b, m, row } (m: magazine sequence, 0 out … 1 in and shut; row: rows indexed out) to group
// values
export const follow = (values) => ({ x: values.x ?? 0, b: values.b ?? 0, a: values.a ?? 0, y: values.y ?? 0, z: values.z ?? 0, ...magOf(values.m ?? 1), magrow: GEO.PITCH * (values.row ?? 0) });
// reachable states for the build: the tour, and a grid of jog states with the head as low as each allows
const reachable = () => {
  const out = [];
  for (let t = 0; t < SIM_LEN; t += 1 / 8) out.push(follow(simAt(t)));
  for (const x of [0, TRAVEL.x / 2, TRAVEL.x])
    for (const y of [0, 60, 120, 180, Y_DISC, 290, TRAVEL.y])
      for (const bv of [-30, -15, 0, 15, 30])
        for (let av = -180; av < 180; av += 30) {
          const m = magFor(y, bv);
          const deep = zLimit({ x, b: bv, a: av, mag: magOf(m).mag }, y);
          if (deep < 0) continue;
          for (const z of [0, deep]) out.push(follow({ x, y, z, a: av, b: bv, m }));
        }
  return out;
};
// The build fits each cross-group plane to 24 states spread evenly through this list, so an envelope of 24 states that
// spans every relative motion sits exactly where it samples, and the reachable states fill the gaps between: here a
// third of them from the job itself (the head low over the tilted, turning holder), a third from jog's extremes (B in
// two passes, A round in 30° steps, Z down its face, every X and Y), and a third with the magazine out or indexed, the
// cradle level and the spindle over it, as the interlock allows.
const MAG_STATES = [{ m: 0, row: 0, y: 36 }, { m: 0.5, row: 0, y: 101 }, { m: 0.86, row: 0, y: 60 }, { m: 0, row: 3, y: 101 }, { m: 0.95, row: 0, y: 112 }, { m: 0, row: 4, y: 0 }, { m: 0.3, row: 0, y: 20 }, { m: 0, row: 1.5, y: 70 }];
const CUTS = SIM.steps.filter((step) => step.kind === "cut");
const envelope = () =>
  Array.from({ length: 24 }, (_, i) => {
    const j = Math.floor(i / 3);
    if (i % 3 === 0) {
      // the job: eight times spread through its cuts
      const u = (j + 0.5) / 8;
      const total = CUTS.reduce((sum, step) => sum + step.dur, 0);
      let at = u * total;
      const step = CUTS.find((c) => (at -= c.dur) < 0) ?? CUTS[CUTS.length - 1];
      return follow(simAt(step.start + step.dur + at));
    }
    if (i % 3 === 2) {
      const mag = MAG_STATES[j];
      const s = { x: [0, TRAVEL.x / 2, TRAVEL.x][j % 3], y: mag.y, a: wrap(45 * j), b: 0, m: mag.m, row: mag.row };
      const deep = zLimit({ x: s.x, b: 0, a: s.a, mag: magOf(s.m).mag, row: s.row }, s.y);
      return follow({ ...s, z: Math.max(0, Math.min(deep, (TRAVEL.z * (j % 4)) / 3)) });
    }
    const s = { x: [0, TRAVEL.x / 2, TRAVEL.x][j % 3], y: [0, TRAVEL.y, Y_DISC, 150, 290, 60, 200, 325][j], a: wrap(30 * j - 165), b: -30 + (60 * j) / 7, m: 1, row: 0 };
    const deep = zLimit({ x: s.x, b: s.b, a: s.a, mag: magOf(1).mag }, s.y);
    return follow({ ...s, z: Math.max(0, Math.min(deep, (TRAVEL.z * ((j + 3) % 6)) / 5)) });
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
// more socket heads on the lower arc, seen in ARUM's photos through the open premill bar and in the video (count,
// radius and angles not published: measured to about ±10° and assumed on the same circle, radius 30 from the video)
const bolt = (deg) => [30 * Math.sin((deg * Math.PI) / 180), 30 * Math.cos((deg * Math.PI) / 180)];
const wallFace = [...[-68, -34, 0, 34, 68, 125, 150, 180, 210, 235].map((d) => { const [x, z] = bolt(d); return `<path class="iso-line" data-tone="lo" d="${shift(circle(5, 20), x, z)}"/>${socketHead(x, z, 3.4)}`; }), ...[-105, 105].map((d) => { const [x, z] = bolt(d); return `<path class="tr-hole" d="${shift(circle(2.6, 12), x, z)}"/>`; })].join("");
T.plane({ part: wall, o: [0, -WALL[0], 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: wallFace });
T.prism({ name: "cradle.hat", ...CB, F: ALONG_Y, polygon: [[-45, TOP], [45, TOP], [33, TOP + 12], [-33, TOP + 12]], s0: WALL[0], s1: WALL[1], tone: "mid", material: "gold", bevel: 0.5 });
// B knuckle on the wall's back face, flush against the ram's front face
T.round({ name: "cradle.b-knuckle", ...CB, F: ALONG_Y, s0: KNUCKLE[0], s1: KNUCKLE[1], r: 34, tone: "mid", material: "steel" });
// hubs (silver): left end cap and bearing cap on the support arm, drive housing on the right arm
T.round({ name: "hub.left.cap", ...CB, F: ALONG_X, s0: ARM_L[0] - 5, s1: ARM_L[0], r: 29.5, tone: "mid", material: "steel", details: { bolts: [{ s: ARM_L[0] - 5, r: 22, count: 6, phase: 0, size: 0.5 }] } });
T.round({ name: "hub.left.bearing", ...CB, F: ALONG_X, s0: ARM_L[1], s1: ARM_L[1] + 6, r: 31.5, tone: "mid", material: "steel", details: { bolts: [{ s: ARM_L[1] + 6, r: 27, count: 4, phase: 0.2, size: 0.5 }] } });
// the drive hub, Ø70 (the video), with screws round its rim
const rimScrews = Array.from({ length: 6 }, (_, i) => { const t = (i / 6) * 2 * Math.PI + 0.3; return { at: [ARM_R[0] - 4, 35 * Math.cos(t), 35 * Math.sin(t)], normal: [0, Math.cos(t), Math.sin(t)], size: 0.55 }; });
T.round({ name: "hub.right.drive", ...CB, F: ALONG_X, s0: 91, s1: ARM_R[0], r: 35, tone: "mid", material: "steel", details: { seams: [96, ARM_R[0] - 8], dots: rimScrews } });
// the A motor's white box on the right housing's outer face, on a short collar; its end is free, short of the right
// wall, and it tilts with the cradle (the video)
T.round({ name: "cradle.motor.collar", ...CB, F: ALONG_X, s0: ARM_R[1], s1: ARM_R[1] + 5, r: 16, tone: "hi" });
T.prism({ name: "cradle.motor", ...CB, F: ALONG_X, polygon: backs([[-22, -33], [22, -33], [22, 33], [-22, 33]]), round: 3, s0: ARM_R[1] + 5, s1: 258, tone: "hi", bevel: 0.6, details: { seams: [ARM_R[1] + 14] } });

// holder (A): one plate; the disc, clamp ring, screws and bores are drawn in the planes of its faces
const plate = [[-HALF + CHAMFER, -HALF], [HALF - CHAMFER, -HALF], [HALF, -HALF + CHAMFER], [HALF, HALF - CHAMFER], [HALF - CHAMFER, HALF], [-HALF + CHAMFER, HALF], [-HALF, HALF - CHAMFER], [-HALF, -HALF + CHAMFER]];
// holder frame: u = −X, v = back, so markup reads with v toward the back wall at A = 0
const HF = { o: [0, 0, 0], a: [0, 0, 1], u: [-1, 0, 0], v: [0, -1, 0] };
const holder = T.prism({ name: "holder.plate", ...CA, F: HF, polygon: plate, s0: -THICK, s1: THICK, tone: "hi", crease: "lo", material: "steel" });
// Face B (up at A = 0): black clamp ring with six screws over a polished bevel, the slot by the front edge, four blind pockets,
// and the premill bar along the back edge with five seat marks (ARUM's photos show P1–P5 on this face too)
const ringScrews = Array.from({ length: 6 }, (_, i) => [56.5 * Math.cos((i * Math.PI) / 3), 56.5 * Math.sin((i * Math.PI) / 3)]);
const knurled = (x, y) => `${screwHead(x, y, 3.6)}<path class="iso-line" data-tone="faint" d="${shift(circle(2.2, 12), x, y)}"/>`;
// The milled disc (work.mjs) is drawn for the holder at rest; live.js redraws it as the holder moves. One millimetre
// down from face B moves a point across the face by REST_SHIFT (disc frame); a wall is lit when it faces screen left.
const REST = (() => {
  const o = k.iso([0, 0, THICK], P);
  const pu = k.iso([-1, 0, THICK], P);
  const pv = k.iso([0, -1, THICK], P);
  const down = k.iso([0, 0, THICK - 1], P);
  const [a, b, c, d] = [pu[0] - o[0], pu[1] - o[1], pv[0] - o[0], pv[1] - o[1]];
  const dx = down[0] - o[0];
  const dy = down[1] - o[1];
  const det = a * d - b * c;
  const su = (dx * d - c * dy) / det;
  const sv = (a * dy - b * dx) / det;
  return { shift: [-su, -sv], m: [a, b, c, d] };
})();
const REST_SHIFT = REST.shift;
const REST_LIT = (n) => REST.m[0] * -n[0] + REST.m[2] * -n[1] < 0;
const faceB = [
  `<path class="tr-ring" fill-rule="evenodd" d="${circle(55)}${circle(47)}"/>`,
  `<path class="tr-bevel" fill-rule="evenodd" d="${circle(47)}${circle(45.5)}"/>`,
  `<path class="iso-line" data-tone="lo" d="${circle(55)}"/>`,
  workSvg(REST_SHIFT, { occlusal: 0, buccal: 0, palatal: 0 }, REST_LIT),
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
  underSvg(),
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
// back wall is a set of plates around its openings, in the live layer, so the carriage and the magazine can pass
// behind it
const ground = (shape) => Object.assign(shape, { ground: true });
const UPF = UP(0, 0);
const block = (name, [x0, x1], [y0, y1], [z0, z1], extra = {}) => T.prism({ name, layer: live, F: UPF, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], s0: z0, s1: z1, tone: "mid", ...extra });
const WY = [-BACK_Y - WALL_T, -BACK_Y];
// cross-head screws round a plate's edges on its front face, 7 in from them, about every 70 mm (the video)
const edgeScrews = ([x0, x1], [z0, z1], y = WY[1]) => {
  const out = [];
  const along = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const nx = Math.max(1, Math.round((x1 - x0 - 14) / 70));
  const nz = Math.max(1, Math.round((z1 - z0 - 14) / 70));
  for (const x of along(x0 + 7, x1 - 7, nx)) for (const z of [z0 + 7, z1 - 7]) out.push({ at: [z, x, y], normal: [0, 1, 0], size: 0.5 });
  for (const z of along(z0 + 7, z1 - 7, nz).slice(1, -1)) for (const x of [x0 + 7, x1 - 7]) out.push({ at: [z, x, y], normal: [0, 1, 0], size: 0.5 });
  return out;
};
// a filled disc on a horizontal face, projected
const discOn = (x, y, r, z, n = 40) => `M${Array.from({ length: n }, (_, j) => at([x + r * Math.cos((j / n) * 2 * Math.PI), y + r * Math.sin((j / n) * 2 * Math.PI), z]).map((v) => v.toFixed(2)).join(" ")).join("L")}Z`;
function chamber() {
  const FLOOR = { x: WALL_X[0], y: WY[0], w: WALL_X[1] - WALL_X[0], d: FRONT_Y - WY[0], r: 2 };
  const floorSvg = `<path class="iso-halo" d="${k.haloOf(FLOOR, FLOOR_Z - 8, 8, P)}"/>` + S(k.slabOf(FLOOR, FLOOR_Z - 8, 8, P, 3, 1.2), { tone: "lo", inner: Ln(k.sideSeam(FLOOR, FLOOR_Z - 4, P, 3), { tone: "faint" }) });
  // a raised strip the width of the carriage's floor cover runs from the wall to the sill, and two drains sit
  // front-right of it, one behind the other, each with a small two-screw plate beside it (the video)
  const STRIP = { x: -74, y: WY[1], w: 148, d: FRONT_Y - 10 - WY[1], r: 1 };
  const stripSvg = S(k.slabOf(STRIP, FLOOR_Z, 2, P, 1, 0.4), { tone: "lo" });
  const drainSvg = [95, 150].map((y) => {
    const x = 105;
    const plate = [[x + 35, y - 12.5], [x + 41, y - 12.5], [x + 41, y + 12.5], [x + 35, y + 12.5]].map(([px, py]) => at([px, py, FLOOR_Z]));
    return S(k.cylinder(x, y, 21, FLOOR_Z, 1.2, P, 40, 0.3), { tone: "mid" }) + Ln(k.ring(x, y, 17, FLOOR_Z + 1.2, P, 36), { tone: "faint" }) + `<path class="tr-hole" d="${discOn(x, y, 13, FLOOR_Z + 1.2)}"/>` + Ln(k.ring(x, y, 13, FLOOR_Z + 1.2, P, 36), { tone: "lo" }) + Ln(k.ring(x, y, 9, FLOOR_Z + 1.2, P, 28), { tone: "faint" }) + Ln(`M${plate.map((p) => p.map((v) => v.toFixed(2)).join(" ")).join("L")}Z`, { tone: "lo" }) + Dots([at([x + 38, y - 7, FLOOR_Z]), at([x + 38, y + 7, FLOOR_Z])], { size: 0.45 });
  }).join("");
  put({ name: "stand.floor", layer: "back", at: [0, 0, FLOOR_Z - 4], bias: -50, svg: floorSvg + stripSvg + drainSvg, shapes: [ground(A.slab(FLOOR, FLOOR_Z - 8, 8))] });
  // the magazine bay behind the window, deep enough for the magazine when it is in (its carrier bar runs on back past
  // the bay's back face), and the machine's side housing behind the wall's left edge, 15 behind the bay
  const BAY = { y: [WY[0] - 200, WY[0]], back: 5, skin: 5 };
  const RET = { x: [WALL_X[0] - 8, WALL_X[0]], y: [BAY.y[0] - BAY.back - 15, WY[0]] };
  // the floor carries on under the side housing, 5 past its back, so the housing stands on something
  const STRIP_Y = RET.y[0] - 5;
  const BACKSTRIP = { x: WALL_X[0] - 8, y: STRIP_Y, w: 8, d: WY[0] - STRIP_Y, r: 0.5 };
  put({ name: "stand.floor-back", layer: "back", at: [BACKSTRIP.x + 4, BACKSTRIP.y + BACKSTRIP.d / 2, FLOOR_Z - 4], bias: -60, svg: S(k.slabOf(BACKSTRIP, FLOOR_Z - 8, 8, P, 1, 0.4), { tone: "lo" }), shapes: [ground(A.slab(BACKSTRIP, FLOOR_Z - 8, 8))] });
  // the raised floor on the left, under the sensor post and the magazine's side
  T.prism({ name: "stand.pad", layer: live, F: ALONG_Y, polygon: [[WALL_X[0], FLOOR_Z], [PAD.x[1], FLOOR_Z], [PAD.x[0], PAD.z], [WALL_X[0], PAD.z]], s0: -(FRONT_Y - 10), s1: BACK_Y, tone: "lo", bevel: 0.4 });
  // the door sill stands on the floor, so it lives with the machine's parts
  block("stand.sill", WALL_X, [FRONT_Y - 10, FRONT_Y], [FLOOR_Z, FLOOR_Z + 4], { bevel: 0.4, details: { dots: [-330, -210, -90, 30, 150, 250].map((x) => ({ at: [FLOOR_Z + 4, x, FRONT_Y - 5], normal: [0, 0, 1], size: 0.5 })) } });

  // the wall's lower band in plates round its two openings, the window and the carriage's; the base under the window
  // stops 0.5 under its sill, so the magazine's tray passes over it with a gap, and each plate meets the next on one
  // plane (a long plate spanning the bay and the carriage closes a painter's cycle: plate → bay → carriage → plate)
  const SILL_Z = WIN.z[0] - 0.5;
  const LOW = LEDGE.z[0];
  const plate = (name, xs, zs) => block(name, xs, WY, zs, { details: { dots: edgeScrews(xs, zs) } });
  plate("wall.left", [WALL_X[0], WIN.x[0]], [FLOOR_Z, LOW]);
  plate("wall.sill", WIN.x, [FLOOR_Z, SILL_Z]);
  plate("wall.lintel", WIN.x, [WIN.z[1], LOW]);
  plate("wall.mid", [WIN.x[1], -COLLAR.in], [FLOOR_Z, LOW]);
  plate("wall.over", [-COLLAR.in, COLLAR.in], [COLLAR.inTop, LOW]);
  plate("wall.right", [COLLAR.in, WALL_X[1]], [FLOOR_Z, LOW]);
  // the raised collar the carriage comes through, down to the floor (the video)
  const CY = [WY[1], COLLAR.y];
  const collarDots = (x) => [COLLAR.top - 28, 20, -70, FLOOR_Z + 20].map((z) => ({ at: [z, x, COLLAR.y], normal: [0, 1, 0], size: 0.55 }));
  block("collar.left", [-COLLAR.out, -COLLAR.in], CY, [FLOOR_Z, COLLAR.top], { tone: "hi", bevel: 0.5, details: { dots: collarDots(-(COLLAR.out + COLLAR.in) / 2) } });
  block("collar.right", [COLLAR.in, COLLAR.out], CY, [FLOOR_Z, COLLAR.top], { tone: "hi", bevel: 0.5, details: { dots: collarDots((COLLAR.out + COLLAR.in) / 2) } });
  block("collar.top", [-COLLAR.in, COLLAR.in], CY, [COLLAR.inTop, COLLAR.top], { tone: "hi", bevel: 0.5, details: { dots: [-58, 58].map((x) => ({ at: [(COLLAR.inTop + COLLAR.top) / 2, x, COLLAR.y], normal: [0, 1, 0], size: 0.55 })) } });
  // the stainless ledge across the whole wall, the lower band's top; above it the dark upper band, set back behind the
  // column's travel, ending at the right in a fixed silver frame
  block("wall.ledge", WALL_X, [UPPER_Y - WALL_T, LEDGE.front], LEDGE.z, { material: "steel", tone: "hi", bevel: 0.4 });
  const FRAME_X = WALL_X[1] - 24;
  const upper = block("wall.upper", [WALL_X[0], FRAME_X], [UPPER_Y - WALL_T, UPPER_Y], [LEDGE.z[1], WALL_TOP], { tone: "lo", material: "rubber" });
  // horizontal grooves across it, edge to edge (the video)
  const grooves = [40, 90, 150].map((dz) => `M${WALL_X[0].toFixed(1)} ${(LEDGE.z[1] + dz).toFixed(1)}L${FRAME_X.toFixed(1)} ${(LEDGE.z[1] + dz).toFixed(1)}`).join("");
  T.plane({ part: upper, o: [0, UPPER_Y, 0], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: `<path class="iso-line" data-tone="faint" d="${grooves}"/>` });
  block("wall.upper.frame", [FRAME_X, WALL_X[1]], [UPPER_Y - WALL_T, UPPER_Y + 6], [LEDGE.z[1], WALL_TOP], { material: "steel", tone: "hi", bevel: 0.6 });
  // the magazine bay: dark, a floor, two sides, a roof and a back, all within the window's own width and height, so no
  // part of the bay reaches behind the plates beside the window (where it did, the bay, the plate and the magazine
  // passing between them closed a painter's cycle)
  const dark = { tone: "lo", material: "rubber" };
  // a floor under everything, thin side walls standing on it and a roof between them: each joint meets on one face
  const SIDE = 2;
  const BX = WIN.x;
  const bayFloor = block("bay.floor", BX, BAY.y, [WIN.z[0] - BAY.skin, WIN.z[0]], dark);
  block("bay.left", [BX[0], BX[0] + SIDE], BAY.y, [WIN.z[0], WIN.z[1]], dark);
  block("bay.right", [BX[1] - SIDE, BX[1]], BAY.y, [WIN.z[0], WIN.z[1]], dark);
  block("bay.roof", [BX[0] + SIDE, BX[1] - SIDE], BAY.y, [WIN.z[1] - SIDE, WIN.z[1]], dark);
  // the back: drawn on the floor as a dark face rather than built as a solid, so the carrier bar can run back past it
  // into the machine when the magazine is in (the flap is shut by then, and the side housing hides it from the side)
  const backO = [(BX[0] + BX[1]) / 2, BAY.y[0], (WIN.z[0] + WIN.z[1]) / 2];
  const backSvg = `<path class="tr-bay-back" d="${roundRect(BX[0] - backO[0], WIN.z[0] - BAY.skin - backO[2], BX[1] - backO[0], WIN.z[1] - backO[2], 0.5)}"/>`;
  T.plane({ part: bayFloor, o: backO, u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: backSvg });
  // the machine's side housing behind the wall's left edge: it hides the bay and the retracted magazine, which would
  // otherwise show past the edge from this viewpoint; it carries the wall's screws round the corner
  const retDots = [];
  for (let y = RET.y[0] + 20; y < RET.y[1] - 10; y += 70) for (const z of [FLOOR_Z + 7, LOW - 7]) retDots.push({ at: [z, RET.x[0], y], normal: [-1, 0, 0], size: 0.5 });
  block("wall.return", RET.x, RET.y, [FLOOR_Z, LOW], { details: { seams: [SILL_Z, WIN.z[1]], dots: retDots } });
  // two fittings on the wall left of the flap (the video): a push-in port, and under it the gland the sensor's cable
  // comes in by
  const along = (x, z) => frameOf([x, WY[1], z], [0, 1, 0], [1, 0, 0]);
  const port = T.round({ name: "wall.port", layer: live, F: along(GLAND.x, GLAND.z + 18), s0: 0, s1: 7, r: 4.5, tone: "mid", material: "steel" });
  T.plane({ part: port, o: [GLAND.x, WY[1] + 7, GLAND.z + 18], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: `<path class="tr-hole" d="${circle(2, 16)}"/>` });
  T.round({ name: "wall.gland", layer: live, F: along(GLAND.x, GLAND.z), s0: 0, s1: GLAND.len, r: 5.5, tone: "mid", material: "gunmetal", owner: "post.cable" });
}

// ---------------------------------------------------------------- X: the carriage behind the cradle, through the collar
function ram() {
  const y1 = -KNUCKLE[1];
  const y0 = y1 - RAM.len;
  const z1 = RAM.z[1] - 3;
  // a tall light-grey box from the floor strip to above the cradle, its plain front plate held by four small screws, and
  // bristles lying front to back on its top (the video); with X at 0 its face is flush with the collar
  const dots = [[z1 - 8, -68], [z1 - 8, 68], [FLOOR_Z + 30, -68], [FLOOR_Z + 30, 68]].map(([z, x]) => ({ at: [z, x, y1], normal: [0, 1, 0], size: 0.5 }));
  block("ram", RAM.x, [y0, y1], [FLOOR_Z + 2, z1], { group: gx, tone: "hi", details: { dots } });
  const brush = block("ram.brush", [RAM.x[0] + 3, RAM.x[1] - 3], [y0, y1 - 3], [z1, RAM.z[1]], { group: gx, tone: "lo", material: "rubber" });
  const bristles = Array.from({ length: 13 }, (_, i) => -66 + 11 * i).map((x) => `M${x} ${(y0 + 4).toFixed(1)}L${x} ${(y1 - 7).toFixed(1)}`).join("");
  T.plane({ part: brush, o: [0, 0, RAM.z[1]], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], svg: `<path class="iso-line" data-tone="faint" data-free="end" d="${bristles}"/>` });
  // the floor cover in front of it, under the cradle: a gable-topped way cover the width of the carriage, its front
  // moving out with X (the video: level with the rear drain at X 0), riding on the floor strip
  const cover = [[-74, FLOOR_Z + 2], [74, FLOOR_Z + 2], [74, FLOOR_Z + 22], [0, FLOOR_Z + 32], [-74, FLOOR_Z + 22]];
  T.prism({ name: "ram.cover", group: gx, layer: live, F: ALONG_Y, polygon: cover, s0: -COVER_FRONT, s1: -y1, tone: "mid", material: "steel", bevel: 0.4, details: { seams: [-COVER_FRONT + 70, -COVER_FRONT + 140] } });
}

// ---------------------------------------------------------------- Y and Z: the column along the wall, the head on its face
function spindle() {
  const F = UP(HX, HY);
  // Y: the column, a silver housing standing out from the dark upper wall; beside the head its face shows a dark recess,
  // where the head's guides run (the video shows no rails or saddle)
  const col = block("column", COL.x, COL.y, COL.z, { group: gy, tone: "hi", material: "steel", details: { seams: [COL.z[1] - 10] } });
  const recess = [-1, 1].map((side) => { const x0 = side * (BOX.w / 2 + 1); const x1 = side * (BOX.w / 2 + 7); return `<path class="tr-hole" d="${roundRect(Math.min(x0, x1), COL.z[0] + 6 - (COL.z[0] + COL.z[1]) / 2, Math.max(x0, x1), COL.z[1] - 12 - (COL.z[0] + COL.z[1]) / 2, 1)}"/>`; }).join("");
  T.plane({ part: col, o: [HX, COL.y[1], (COL.z[0] + COL.z[1]) / 2], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: recess });
  // Z: the head box, 45° chamfers down its front corners; its front a plain silver cover, its right side a gold plate and
  // its left a black one with a brass L along its bottom and back edges (the video)
  const [x0, x1] = [BOX.x, BOX.x + BOX.w];
  const yb = BOX.y;
  const yf = BOX.y + BOX.d;
  const c = BOX.chamfer;
  const t = BOX.side;
  const HZ = { group: gz, layer: live };
  const chamferDots = [BOX_Z[0] + 22, BOX_Z[1] - 18].map((z) => ({ at: [z, x1 - c / 2 - 1, yf - c / 2 + 1], normal: [Math.SQRT1_2, Math.SQRT1_2, 0], size: 0.5 }));
  const box = T.prism({ name: "head.box", ...HZ, F: UPF, polygon: [[x0 + t, yb], [x1 - t, yb], [x1 - t, yf - c + t], [x1 - c, yf], [x0 + c, yf], [x0 + t, yf - c + t]], s0: BOX_Z[0], s1: BOX_Z[1], tone: "hi", material: "steel", details: { dots: chamferDots } });
  // the chamfer along its bottom front edge shows as a light band
  T.plane({ part: box, o: [HX, yf, BOX_Z[0]], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: `<path class="iso-line" data-tone="faint" d="M${(-(BOX.w / 2 - c)).toFixed(1)} 12L${(BOX.w / 2 - c).toFixed(1)} 12"/>` });
  T.prism({ name: "head.side.right", ...HZ, F: UPF, polygon: [[x1 - t, yb], [x1, yb], [x1, yf - c], [x1 - t, yf - c + t]], s0: BOX_Z[0], s1: BOX_Z[1], tone: "mid", material: "gold" });
  T.prism({ name: "head.side.left", ...HZ, F: UPF, polygon: [[x0, yb], [x0 + t, yb], [x0 + t, yf - c + t], [x0, yf - c]], s0: BOX_Z[0], s1: BOX_Z[1], tone: "lo", material: "rubber" });
  const L = 10;
  const lBottom = T.prism({ name: "head.l.bottom", ...HZ, F: UPF, polygon: [[x0 - 1.5, yb + L], [x0, yb + L], [x0, yf - c - 4], [x0 - 1.5, yf - c - 4]], s0: BOX_Z[0], s1: BOX_Z[0] + L, tone: "mid", material: "brass" });
  T.plane({ part: lBottom, o: [x0 - 1.5, yf - c - 12, BOX_Z[0] + L / 2], u: [0, -1, 0], v: [0, 0, 1], normal: [-1, 0, 0], svg: `<path class="tr-hole" d="${circle(3.5, 16)}"/>` });
  T.prism({ name: "head.l.back", ...HZ, F: UPF, polygon: [[x0 - 1.5, yb], [x0, yb], [x0, yb + L], [x0 - 1.5, yb + L]], s0: BOX_Z[0], s1: BOX_Z[1], tone: "mid", material: "brass" });
  // the gold plate between the box and the spindle's flange
  T.prism({ name: "head.plate", ...HZ, plan: { x: HX - 42, y: HY - 46, w: 84, d: 82, r: 6 }, z: S0 + 41, h: 7, tone: "mid", material: "gold" });
  // the spindle: a flat flange with a small lip, the nose, the grooved nose ring, the shaft and the collet nut
  const flange = [[S0 + 25, 41], [S0 + 26.5, 42.5], [S0 + 41, 42.5]];
  const parts = [
    { name: "head.ring", svg: S(G.solidOf(flange, F, P), { tone: "hi", crease: "lo" }), shape: A.solid(F, flange), at: [HX, HY, S0 + 33] },
    { name: "head.nose", svg: S(G.solidOf([[S0 + 7, 32.5], [S0 + 25, 32.5]], F, P), { tone: "mid", inner: Ln(G.arcOf(F, S0 + 12, 32.5, P), { tone: "faint" }) }), shape: A.solid(F, [[S0 + 7, 32.5], [S0 + 25, 32.5]]), at: [HX, HY, S0 + 16] },
    { name: "head.nose-ring", svg: S(G.solidOf([[S0, 17], [S0 + 2, 19], [S0 + 7, 19]], F, P), { tone: "mid" }), shape: A.solid(F, [[S0, 17], [S0 + 2, 19], [S0 + 7, 19]]), at: [HX, HY, S0 + 3.5] },
    { name: "head.shaft", svg: S(G.solidOf([[S0 - 10, 7.5], [S0, 7.5]], F, P), { tone: "mid" }), shape: A.solid(F, [[S0 - 10, 7.5], [S0, 7.5]]), at: [HX, HY, S0 - 5] },
    { name: "tool.collar", svg: S(G.solidOf([[S0 - 17, 6.5], [S0 - 10, 6.5]], F, P), { tone: "mid" }) + Faded(G.ribsOf(F, S0 - 17, S0 - 10, 6.5, 6, P, { fade: [0.1, 0.55] }), { tone: "lo" }), shape: A.solid(F, [[S0 - 17, 6.5], [S0 - 10, 6.5]]), at: [HX, HY, S0 - 13.5] },
  ];
  // the bur: the finishing tool, a Ø1.0 ball on a long neck (ARUM's ZB-86: 20 mm reach) tapering to the Ø6 shank
  const bur = BUR_DRAWN;
  if (!(S0 - 17 > TIP_Z + BUR[BUR.length - 1][0])) throw new Error("tool: shank shorter than its taper");
  // its depth-sorting shape stops 9 mm above the tip: the cutting reach is down in the channel it cuts, which the holder
  // plate's solid (a plain block) does not model
  const sortBur = [[TIP_Z + 9, 0], [TIP_Z + 9.05, burRadius(9.05)], ...BUR.filter(([h]) => h > 9.05).map(([h, r]) => [TIP_Z + h, r]), [S0 - 17, 3]];
  parts.push({ name: "tool.bur", svg: S(G.solidOf(bur, F, P, {}), { tone: "hi", crease: "lo" }), shape: A.solid(F, sortBur), at: [HX, HY, TIP_Z + 14] });
  // coolant: on each side a black upright block under the head box ends in a swivel eye; from it a Ø5 tube and a flat
  // black Ø10 tip aim in and down at the tool (model.mjs NOZZLE)
  const aim = [HX, HY, TIP_Z + NOZZLE.aim];
  for (const side of [-1, 1]) {
    // one picture per nozzle (the head only translates), its pieces painted far to near
    const e = [HX + side * NOZZLE.dx, HY + NOZZLE.dy, TIP_Z + NOZZLE.h];
    const EF = UP(e[0], e[1]);
    const dir = G.unit3(G.sub3(aim, e));
    const TF = frameOf(e, dir, [0, 0, 1]);
    const boltProfile = [[e[2] + 3.5, 4.5], [BOX_Z[0], 4.5]];
    const eyeProfile = [[e[2] - 3.5, NOZZLE.eye], [e[2] + 3.5, NOZZLE.eye]];
    const tubeProfile = [[NOZZLE.tube[0], NOZZLE.r[0]], [NOZZLE.tube[1], NOZZLE.r[0]]];
    const tipProfile = [[NOZZLE.tip[0], NOZZLE.r[1]], [NOZZLE.tip[1], NOZZLE.r[1]]];
    const mid = (span) => G.add3(e, G.mul3(dir, (span[0] + span[1]) / 2));
    const pieces = [
      { at: [e[0], e[1], (e[2] + BOX_Z[0]) / 2], svg: `<g class="tr-black">${S(G.solidOf(boltProfile, EF, P, {}), { tone: "lo" })}</g>` },
      { at: e, svg: S(G.solidOf(eyeProfile, EF, P, {}), { tone: "hi", crease: "lo" }) },
      { at: mid(NOZZLE.tube), svg: S(G.solidOf(tubeProfile, TF, P, {}), { tone: "hi", crease: "lo" }) },
      { at: mid(NOZZLE.tip), svg: `<g class="tr-black">${S(G.solidOf(tipProfile, TF, P, {}), { tone: "lo" })}</g>` },
    ].sort((u, w) => k.depthOf(u.at, P) - k.depthOf(w.at, P));
    const owner = `nozzle.${side}`;
    parts.push({ name: `nozzle.${side < 0 ? "left" : "right"}`, svg: pieces.map((piece) => piece.svg).join(""), shapes: [A.solid(EF, boltProfile, { name: `nozzle.bolt.${side}`, owner }), A.solid(EF, eyeProfile, { name: `nozzle.eye.${side}`, owner }), A.solid(TF, tubeProfile, { name: `nozzle.tube.${side}`, owner }), A.solid(TF, tipProfile, { name: `nozzle.tip.${side}`, owner })], at: e });
  }
  for (const part of parts) T.fixed({ name: part.name, group: gz, layer: live, svg: part.svg, anchor: part.at, shapes: part.shapes ?? [part.shape] });
}

// ---------------------------------------------------------------- the magazine and the flap
function magazine() {
  const MR = { group: gr, layer: live };
  // under the block a tray that runs on back through the window as the carrier, so the block is never without a plate
  // under it (the video), and along its cradle side a bar; the tray slides on the bay's floor, then on the open flap
  block("magazine.tray", TRAY.x, TRAY.y, TRAY.z, { ...MR, material: "steel" });
  const barDots = [];
  for (let y = MAG.y + MAG.d - 15; y > MAG.y + 10; y -= 40) barDots.push({ at: [(BAR.z[0] + BAR.z[1]) / 2, BAR.x[1], y], normal: [1, 0, 0], size: 0.5 });
  block("magazine.bar", BAR.x, [MAG.y, MAG.y + MAG.d], BAR.z, { ...MR, tone: "hi", material: "steel", details: { dots: barDots } });
  // the block: 50 tall, its front in two tiers, a plain cover plate 25 tall on top and below it a brushed strip set back
  // 2, with two black knurled fittings 60 apart and a hex stud between them (the video)
  const cx = MAG.x + MAG.w / 2;
  const front = MAG.y + MAG.d;
  const lower = { ...MAG, d: MAG.d - 2 };
  const svg = [S(k.slabOf(lower, MAG_TOP - 50, 25, P, 3, 0.6), { tone: "mid" }), S(k.slabOf(MAG, MAG_TOP - 25, 25, P, 3, 1), { tone: "hi" })];
  const fittingZ = MAG_TOP - 37.5;
  const FF = (x) => frameOf([x, front - 2, fittingZ], [0, 1, 0], [1, 0, 0]);
  for (const x of [cx - 30, cx + 30]) svg.push(`<g class="tr-black">${S(G.solidOf([[0, 5.5], [10, 5.5]], FF(x), P, {}), { tone: "lo" })}</g>`);
  svg.push(S(G.solidOf([[0, 2.2], [3, 2.2]], frameOf([cx, front - 2, fittingZ + 3], [0, 1, 0], [1, 0, 0]), P, {}), { tone: "mid" }));
  // the pockets: a steel collar round each bore, held by two small screws diagonally opposite
  const pockets = [];
  for (let c = 1; c <= 3; c++) for (let r = 1; r <= 5; r++) { const [x, y] = pocketAt(c, r); pockets.push({ x, y, c, r }); }
  for (const { x, y } of pockets.slice().sort((u, w) => k.depthOf([u.x, u.y, MAG_TOP], P) - k.depthOf([w.x, w.y, MAG_TOP], P))) {
    svg.push(S(k.cylinder(x, y, 7, MAG_TOP, 5, P, 24, 0.3), { tone: "mid" }));
    svg.push(Ln(k.ring(x, y, 3.8, MAG_TOP + 5, P, 18), { tone: "lo" }));
    svg.push(Dots([at([x - 7.8, y + 7.8, MAG_TOP]), at([x + 7.8, y - 7.8, MAG_TOP])], { size: 0.45 }));
  }
  const fittings = A.slab({ x: cx - 36, y: front, w: 72, d: 8, r: 0.5 }, fittingZ - 6, 12);
  T.fixed({ name: "magazine", ...MR, svg: svg.join(""), anchor: [cx, MAG.y + MAG.d / 2, MAG_TOP - 25], shapes: [A.slab(MAG, MAG_TOP - 50, 55), fittings] });
  // the tools, shank up, 24 out of their collars: each its own part, so the spindle's bur sorts against them when it comes
  // down to a pocket; the two the tool change swaps sort on a stub under the bur (live.js shows and hides them)
  for (const { x, y, c, r } of pockets) {
    const key = `${c}/${r}`;
    if (POCKETS.empty.includes(key)) continue;
    const Fp = UP(x, y);
    const shank = [[MAG_TOP + 5, 3], [SHANK_TOP - 0.6, 3], [SHANK_TOP, 2.4]];
    const swapped = key === POCKETS.drop || key === POCKETS.pick;
    T.fixed({ name: `pocket.${c}.${r}`, ...MR, svg: S(G.solidOf(shank, Fp, P, {}), { tone: "mid", crease: "faint" }), anchor: [x, y, MAG_TOP + 17], shapes: [A.solid(Fp, swapped ? [[MAG_TOP + 5, 3], [MAG_TOP + 13, 3]] : shank)] });
  }
  // the flap, shown open (flat): a plate on two spring butt hinges along its bottom edge
  const span = FLAP.x[1] - FLAP.x[0];
  const hinges = [[0.05, 0.36], [0.68, 0.96]].map(([u0, u1]) => [FLAP.x[0] + u0 * span, FLAP.x[0] + u1 * span]);
  hinges.forEach(([h0, h1], i) => T.round({ name: `flap.hinge.${i + 1}`, group: gf, layer: live, F: frameOf([0, FLAP.y, FLAP.z], [1, 0, 0], [0, 1, 0]), s0: h0, s1: h1, r: 1.5, tone: "mid", material: "steel", details: { seams: [(h0 + h1) / 2] } }));
  const flap = block("flap", FLAP.x, [FLAP.y + 1.5, FLAP.y + FLAP.len], [FLAP.z - 1.5, FLAP.z + 1.5], { group: gf, tone: "hi", material: "steel" });
  // its inner face (up when open) dark inside a light rim, as the video shows: open, the flap is a shallow tray under the
  // magazine
  const field = roundRect(FLAP.x[0] + 5, FLAP.y + 7, FLAP.x[1] - 5, FLAP.y + FLAP.len - 5, 1.5);
  const inner = `<path class="tr-bay-back" d="${field}"/><path class="iso-line" data-tone="lo" d="${field}"/>`;
  T.plane({ part: flap, o: [0, 0, FLAP.z + 1.5], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], svg: inner });
  // on its outer face (underneath when open, toward the chamber when shut) the hinges' leaves, two screws each
  const leaf = ([h0, h1]) => `<path class="iso-line" data-tone="lo" d="${roundRect(h0, FLAP.y + 2.5, h1, FLAP.y + 11, 1)}"/>${screwHead(h0 + (h1 - h0) * 0.25, FLAP.y + 7, 1.3)}${screwHead(h0 + (h1 - h0) * 0.75, FLAP.y + 7, 1.3)}`;
  T.plane({ part: flap, o: [0, 0, FLAP.z - 1.5], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, -1], svg: hinges.map(leaf).join("") });
}

// ---------------------------------------------------------------- the tool-length sensor post
function post() {
  const { x, y, r, top } = POST;
  const half = 10;
  const capZ = top - 8;
  // an aluminium bar of square section on an L foot, a round contact cap on top, and an orange LED on its front face
  // 17 below the cap's top (the video)
  const bar = block("post.bar", [x - half, x + half], [y - half, y + half], [PAD.z + 3, capZ], { tone: "hi", material: "steel" });
  T.plane({ part: bar, o: [x, y + half, top - 17], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0], svg: `<path class="tr-led" d="${circle(2.5, 16)}"/><path class="iso-line" data-tone="lo" d="${circle(2.5, 16)}"/>` });
  const cap = T.round({ name: "post.cap", layer: live, F: UP(x, y), s0: capZ, s1: top, r, tone: "hi", material: "steel" });
  T.plane({ part: cap, o: [x, y, top], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], svg: `<path class="tr-ring" fill-rule="evenodd" d="${circle(8, 32)}${circle(6.5, 32)}"/><path class="iso-line" data-tone="lo" d="${circle(1.5, 12)}"/>` });
  block("post.foot", [x - 22, x + half], [y - 13, y + 13], [PAD.z, PAD.z + 3], { material: "steel", details: { dots: [y - 7, y + 7].map((v) => ({ at: [PAD.z + 3, x - 17, v], normal: [0, 0, 1], size: 0.5 })) } });
  block("post.leg", [x - half - 4, x - half], [y - half, y + half], [PAD.z + 3, PAD.z + 30], { material: "steel" });
  // its cable: out of a strain relief on the bar's back face, sagging back to the gland on the wall
  const from = [x, y - half, top - 30];
  // (a shallow sag, level where it leaves the post and where it enters the gland, so the cable's pieces sort cleanly
  // and it never slopes near the line of sight)
  const end = [GLAND.x, WY[1] + 12, GLAND.z];
  const out = [from[0], from[1] - 8, from[2]];
  const route = [from, ...Array.from({ length: 17 }, (_, i) => i / 16).map((u) => [out[0] + (end[0] - out[0]) * u, out[1] + (end[1] - out[1]) * u, out[2] + (end[2] - out[2]) * u - 11 * Math.sin(Math.PI * u) ** 2]), [GLAND.x, WY[1], GLAND.z]];
  const total = G.pathLength(G.resample(route, 0.8));
  T.round({ name: "post.relief", layer: live, F: frameOf(from, [0, -1, 0], [1, 0, 0]), s0: 0, s1: 6, r: 3.6, tone: "lo", material: "rubber", owner: "post.cable" });
  T.tube({ name: "post.cable", layer: live, route, r: 2.5, gaps: [[0, 6], [total - GLAND.len, total]], tone: "mid", material: "rubber" });
}

chamber();
ram();
spindle();
magazine();
post();

const verify = argv.includes("--verify");
const out = T.build({ statics: R.items, poses, verify, fullClouds: true });
A.settle(R, P);
const layerOf = (name) => R.items.filter((item) => item.layer === name).sort((u, w) => u.key - w.key).map((item) => item.svg);

if (argv.includes("--audit")) {
  A.auditOrExit(R, P);
  TA.orbitOrExit(T, R, P, {
    sweep: { at: (x) => follow({ x: TRAVEL.x / 2, y: Y_DISC, z: 0, a: x, b: 30 * Math.sin((x * Math.PI) / 90), m: 1 }), from: -180, to: 180, frame: 0.5 },
    // the job in 0.1 s frames, but its two magazine runs in 1/120 s frames: there the 3 mm flap swings its own thickness
    // and more within an eighth of a 0.1 s frame, so the halving test, which counts the pixels that change owner, sees
    // its thin edges saturate rather than shrink with the step; at twice the page's frame rate they shrink as they should
    clips: (() => {
      const at = (t) => follow(simAt(t));
      const runs = SIM.runs.filter((run) => run.key === "m");
      const cuts = [0, ...runs.flatMap((run) => [run.t0, run.t1]), SIM_LEN];
      const out = [];
      for (let i = 0; i + 1 < cuts.length; i++) out.push({ name: i % 2 ? `magazine ${(i + 1) / 2}` : `sim ${i / 2 + 1}`, at, from: cuts[i], to: cuts[i + 1], frame: i % 2 ? 1 / 120 : 1 / 10 });
      return out;
    })(),
    // the two tools the change swaps sort on a stub under the spindle's bur (see magazine()), so their shapes cover only
    // the foot of their drawing
    cover: [POCKETS.drop, POCKETS.pick].map((key) => `pocket.${key.replace("/", ".")}`),
    quick: argv.includes("--quick"),
    only: argv.find((x) => x.startsWith("--only="))?.slice(7).split(",") ?? null,
    log: argv.includes("--verbose") ? (text) => console.log(`  … ${text}`) : null,
  });
}

const LABEL =
  "Inside the machining chamber of a 5-axis dental mill, finishing an illustrative full-arch zirconia bridge. A gold cradle, open at the front, holds a square disc holder on a horizontal shaft; in the disc a horseshoe-shaped twelve-tooth bridge stands in a channel cut through it, held by small connectors, with four screw holes. Above it the spindle points straight down and never tilts. The job opens with a tool change at the left: behind a flap door hinged at the bottom is the tool magazine, which slides out through its window over the open flap while the spindle touches its last tool down on a sensor post beside it; the spindle returns that tool to a pocket, the magazine indexes a few rows toward the operator to bring the next pocket under the spindle, the spindle takes the finishing bur, and it measures the bur on the sensor post. Then, as the bur works round the arch, the holder turns (A) and the cradle tilts (B) to lean the part against the tool, while the cradle slides toward the operator and back on a tall carriage that comes out of a collar in the back wall (X), the spindle column runs left and right (Y) and the head moves up and down (Z). Behind the bur the rough terraces left by roughing give way to finished teeth.";
const AXES = [
  { key: "X", name: "cradle in and out", range: `0 to ${TRAVEL.x} mm` },
  { key: "Y", name: "spindle left and right", range: `0 to ${TRAVEL.y} mm` },
  { key: "Z", name: "spindle up and down", range: `0 to −${TRAVEL.z} mm` },
  { key: "A", name: "holder turns", range: "360°" },
  { key: "B", name: "cradle tilts", range: `±${SPEC.bLimit}°` },
];
const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: layerOf("back") });
const staticSvg = (list) => `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer" viewBox="0 0 ${W} ${H}" aria-hidden="true">${list.join("")}</svg>`;
const KEYS_HELP = "In the simulation, Space plays or pauses, the arrow keys step through the job a second at a time (with Shift, five), Page Up and Page Down jump between the tool change and the passes, and Home and End go to its start and end. Press X, Y, Z, A or B to jog that axis yourself: the arrow keys then move it, up and right raising its value; Page Up and Page Down take big steps; Home and End go to the axis's ends (A turns all the way round, so it has none); 0 returns every axis home; Space goes back to the simulation. With a mouse, drag sideways across the picture to scrub through the job; in jog, drag sideways for Y and A and up and down for X, Z and B. With a finger, drag sideways for all of them.";
const stage = `<div class="iso-stage iso-turn tr-stage" data-mode="sim" tabindex="0" role="slider" aria-label="Milling simulation: finishing a full-arch bridge" aria-describedby="tr-help" aria-valuemin="0" aria-valuemax="${Math.round(SIM_LEN)}" aria-valuenow="0" aria-valuetext="0 of ${Math.round(SIM_LEN)} seconds">${backSvg}${out.layerSvg("machine", { width: W, height: H })}${staticSvg(layerOf("front"))}</div><span class="tr-help" id="tr-help">${KEYS_HELP}</span><span class="tr-help" aria-live="polite" data-say=""></span>`;
// the part view: the disc from above (front at the bottom), drawn flat with the walls just showing, the current pass's
// tool path (done part darker) and the bur's tip with a line along its lean
const INSET_SH = [0, 0.45];
const insetLit = (n) => n[0] < 0;
const trackD = (pts) => `M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L")}`;
const inset = `<div class="tr-inset" aria-hidden="true"><svg class="iso-svg" viewBox="-51 -51 102 102"><g transform="scale(-1 -1)">${workSvg(INSET_SH, { occlusal: 0, buccal: 0, palatal: 0 }, insetLit, "tri")}</g>${PASS_TRACKS.map((t) => `<path class="tr-track" data-track="${t.kind}" d="${trackD(t.pts)}"/><path class="tr-track-done" data-track-done="${t.kind}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" d="${trackD(t.pts)}"/>`).join("")}<g class="tr-tool" data-tool="" opacity="0"><path class="tr-tool-lean" d="M0 0L0 0"/><circle class="tr-tool-tip" r="1.5"/></g></svg><span class="tr-inset-name">Part · from above</span></div>`;
// the job's timeline (pointer only: the stage is the slider), then the controls: play, the two modes, and the five axes
const PASS_NAME = { tool: "Tool", occlusal: "Occlusal", buccal: "Buccal", palatal: "Palatal" };
const pct = (t) => `${((100 * t) / SIM_LEN).toFixed(2)}%`;
const timeline = `<div class="tr-line" aria-hidden="true">${SIM_SPANS.map((span) => `<span class="tr-line-seg" style="left:${pct(span.start)};width:${pct(span.end - span.start)}"><span class="tr-line-name">${PASS_NAME[span.kind]}</span></span>`).join("")}<span class="tr-line-head" style="left:0%"></span></div>`;
const axesRow = `<div class="tr-axes" role="group" aria-label="Controls"><button type="button" class="tr-axis tr-play" title="Play or pause the simulation">Pause</button><span class="tr-modes" role="group" aria-label="Mode"><button type="button" class="tr-axis tr-mode tr-mode-sim" aria-pressed="true" title="Run the finishing job">Simulate</button><button type="button" class="tr-axis tr-mode tr-mode-jog" aria-pressed="false" title="Move the axes yourself">Jog</button></span>${AXES.map((ax) => `<button type="button" class="tr-axis" data-axis="${ax.key}" aria-pressed="false" aria-label="Jog ${ax.key}: ${ax.name}" title="${ax.key}: ${ax.name}, ${ax.range}"><span class="tr-axis-key" aria-hidden="true">${ax.key}</span><span class="tr-axis-value" data-value="${ax.key}" aria-hidden="true"></span></button>`).join("")}</div>`;

const CSS = `${out.css}
.iso{--tr-bay-back:#0e0e10;--tr-ring:#1c1c1e;--tr-disc:#ffffff;--tr-disc-a:.10;--tr-bevel:#9a9aa0;--tr-hole:#0d0d0e;--tr-screw:#8f8f94;--tr-recess:#161618;--tr-led:#e8742a}
.iso[data-theme="light"]{--tr-bay-back:#3f4247;--tr-ring:#4a4a50;--tr-disc:#ffffff;--tr-disc-a:.5;--tr-bevel:#e4e4e6;--tr-hole:#55555a;--tr-screw:#b9b9bd;--tr-recess:#d3d3d6;--tr-led:#e0611a}
.iso{--tr-zr-top:#5d5d61;--tr-zr-lit:#4b4b4f;--tr-zr-shade:#3b3b3f;--tr-zr-fin-lit:#55555a;--tr-zr-fin-shade:#444449;--tr-moat:#2f2f33;--tr-void:#0b0b0c}
.iso[data-theme="light"]{--tr-zr-top:#ffffff;--tr-zr-lit:#f0f0ee;--tr-zr-shade:#e0e0dd;--tr-zr-fin-lit:#f7f7f5;--tr-zr-fin-shade:#e9e9e6;--tr-moat:#d7d7d4;--tr-void:#4a4a50}
.tr-top{fill:var(--tr-zr-top)}
.tr-wall{fill:var(--tr-zr-shade)}
.tr-wall[data-lit]{fill:var(--tr-zr-lit)}
.tr-wall.tr-fin{fill:var(--tr-zr-fin-shade)}
.tr-wall.tr-fin[data-lit]{fill:var(--tr-zr-fin-lit)}
.tr-moat{fill:var(--tr-moat)}
.tr-void{fill:var(--tr-void)}
.tr-conn{fill:var(--tr-zr-lit)}
.tr-conn-side{fill:var(--tr-zr-shade)}
.tr-crowns{fill:var(--anatomy-lo)}
.iso-svg .tr-reveal{vector-effect:none;stroke-linecap:butt}
.tr-ring{fill:var(--tr-ring)}
.tr-disc{fill:var(--tr-disc);fill-opacity:var(--tr-disc-a)}
.tr-bevel{fill:var(--tr-bevel)}
.tr-shade{opacity:.3}
.tr-hole,.tr-gap{fill:var(--tr-hole)}
.tr-recess{fill:var(--tr-recess)}
.tr-led{fill:var(--tr-led)}
.tr-bay-back{fill:var(--tr-bay-back)}
.tr-screw{fill:var(--tr-screw);stroke:var(--anatomy-lo);stroke-width:.3}
.tr-black .iso-fill,.tr-black .iso-shade,.tr-black .iso-top{fill:var(--tr-ring)}
.tr-stage{touch-action:pan-y pinch-zoom;cursor:grab;overflow:hidden}
.tr-stage>svg{overflow:hidden}
.tr-stage[data-drag]{cursor:grabbing}
.tr-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.tr-axes{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:12px 0 10px}
.tr-axis{display:inline-flex;align-items:baseline;gap:7px;padding:6px 10px;border:0;border-radius:3px;background:transparent;box-shadow:inset 0 0 0 1px var(--anatomy-lo);color:var(--anatomy-text);font:10.5px/1 var(--anatomy-mono);letter-spacing:.04em;font-variant-numeric:tabular-nums;cursor:pointer;transition:box-shadow .2s var(--anatomy-ease),color .2s var(--anatomy-ease)}
.tr-axis-key{color:var(--anatomy-text);font-weight:600}
.tr-axis-value{flex:none;letter-spacing:0;text-align:right}
[data-value="A"]{width:7ch}
[data-value="Z"],[data-value="B"]{width:6ch}
[data-value="X"],[data-value="Y"]{width:5ch}
.tr-stagewrap{position:relative}
.tr-inset{position:absolute;left:1.5%;top:1.5%;width:31%;aspect-ratio:1;border-radius:4px;background:var(--anatomy-card);box-shadow:inset 0 0 0 1px var(--anatomy-faint);opacity:0;pointer-events:none;transition:opacity .5s var(--anatomy-ease)}
.tr-stagewrap[data-close] .tr-inset{opacity:1}
.tr-inset>svg{position:absolute;inset:4%;width:92%;height:92%}
.tr-inset-name{position:absolute;left:9px;top:8px;font:9px/1 var(--anatomy-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--anatomy-text)}
.tr-track,.tr-track-done{fill:none;stroke-linecap:round;stroke-linejoin:round;display:none}
.tr-track{stroke:var(--anatomy-mid);stroke-width:.7;stroke-dasharray:1.5 2.5}
.tr-track-done{stroke:var(--anatomy-strong);stroke-width:1.1;stroke-opacity:.8}
.iso-svg .tr-track-done{vector-effect:none;stroke-width:.7}
.tr-track[data-on],.tr-track-done[data-on]{display:inline}
.tr-tool-tip{fill:var(--anatomy-strong);stroke:var(--anatomy-card);stroke-width:1}
.tr-tool-lean{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4;stroke-linecap:round}
@media (prefers-reduced-motion: reduce){.tr-inset{transition:none}}
.tr-modes{display:inline-flex;gap:0}
.tr-mode:first-child{border-radius:3px 0 0 3px}
.tr-mode:last-child{border-radius:0 3px 3px 0;margin-left:-1px}
.tr-play{min-width:6.2ch;justify-content:center;color:var(--anatomy-text)}
.tr-line{position:relative;height:22px;margin:10px 4px 0;cursor:pointer;touch-action:none}
.tr-line-seg{position:absolute;top:4px;height:3px;background:var(--anatomy-faint);border-radius:1px}
.tr-line-name{position:absolute;top:7px;left:0;font:9px/1 var(--anatomy-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--anatomy-text);white-space:nowrap}
.tr-line-head{position:absolute;top:0;width:1px;height:11px;margin-left:-.5px;background:var(--anatomy-strong)}
.tr-stagewrap[data-mode="jog"]~.tr-line{opacity:.45}
.tr-help{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tr-axis[aria-pressed="true"]{box-shadow:inset 0 0 0 1px var(--anatomy-hi);color:var(--anatomy-strong)}
.tr-axis[data-moving]{color:var(--anatomy-strong)}
.tr-axis[data-moving] .tr-axis-key{color:var(--anatomy-lit)}
.tr-axis:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
@media (max-width:480px){.tr-axes{gap:4px}.tr-axis{padding:6px 5px;gap:4px;font-size:9.5px;letter-spacing:0}}
@media (prefers-reduced-motion: reduce){.tr-axis{transition:none}}
`;
// the tool change's view: in on the magazine, the sensor post and the head's underside over them
const DATA = { turn: out.data, magFocus: k.iso([MAG.x + 10, MAG.y + 90, 70], P).map((v) => Math.round(v * 100) / 100), magZoom: 2.2 };
// the model as the page runs it: its wall-lean table written in (worked out here, once, rather than on every load)
const modelSource = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/\/\/ LEANS:begin\n[\s\S]*?\/\/ LEANS:end\n/, () => `const LEANS = ${JSON.stringify(leansTable())};\n`);
if (!modelSource.includes("const LEANS = {")) throw new Error("build: the wall-lean table was not written into the page");
const modelScript = [modelSource, readFileSync(join(HERE, "work.mjs"), "utf8").replace(/^import [^;]+;\n/gm, "")].join("\n").replace(/^export /gm, "");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA)).replace("const follow = null;", `const follow = ${follow.toString()};`);
const body =
  `<style>${CSS}</style><div class="tr-plate">` +
  k.plateHtml({
    fig: "Fig 2",
    title: "Five-axis finishing",
    hint: "Play · scrub · jog",
    readout: "Finishing a full-arch bridge",
    keys: [
      { mark: "lit", label: "The bridge: zirconia, milled about 20% large; finished teeth appear behind the bur" },
      { mark: "raised", label: "Cradle (gold): X in and out, B tilts ±30°, A turns the holder 360°" },
    ],
    caption:
      `An illustrative full-arch bridge: twelve units, screw-retained on four implants (channels at the lateral incisors and second premolars), nested occlusal side up in a 25 mm pre-sintered zirconia disc after roughing and milled about 20% large for the shrinkage in sintering. It stands in a channel through the disc as wide as the Ø2.0 mm roughing ball plus 0.7 mm, held by ${CONNECTORS.length} connectors at its equator; the sintering support a bridge this long would also carry is left out. The job opens with a tool change, as a 5X-200 does it in a video filmed for this figure: the head touches the last job's tool down on the sensor post beside the magazine while the magazine comes out through its window over the flap, which folds down into a shelf; the spindle returns that tool to the front row; the magazine indexes three rows toward the operator to bring the finishing bur's pocket under the spindle (the spindle never moves front to back); the spindle takes the bur and touches it down on the sensor to measure its length while the magazine indexes back; and the magazine goes back in as the head leaves for the first pass. The swap itself is drawn as the tool passing between pocket and collet, with the collet just above the shank. Each finishing pass is thinned for clarity, a zig-zag every few millimetres across the occlusal surface and one line round each wall, where the machine steps about 0.1 mm, so on the machine the job takes far longer. The Ø1.0 mm ball stays nearly upright on the occlusal surface (3°), then leans 15° out from the wall on one contour round the buccal side and the right-hand end, and one round the palatal side and the left-hand end. The spindle never tilts, so the disc is tilted to the tool: at the incisors the lean is on A, at the molars on B, and between them A and B share it, both changing as the tool goes round (simultaneous 5-axis motion, as hyperDENT's 5X cycles drive it). With the head and cradle in the video's proportions, nothing comes inside the clearance kept round the head (as a CAM program keeps one), so the lean holds at 15° all the way round. The screw channels are indexed jobs of their own and are shown done. Jog hands you the axes: X slides the cradle on a tall carriage through a raised collar in the back wall (${TRAVEL.x} mm), Y runs the spindle column along the wall (${TRAVEL.y} mm, from over the sensor post past the disc), Z lowers the head (${TRAVEL.z} mm), A turns the holder ${SPEC.aRange}° and B tilts the cradle ±${SPEC.bLimit}° about a front-to-back axis (inferred from the photos and the video, not published); when the spindle comes over the magazine or the sensor post, the magazine slides out over the open flap, but only with the cradle level, and the cradle tilts only with the magazine in. ` +
      `Specs: ARUM 5X-200 (5 axes; travel X, Y, Z ${TRAVEL.y} × ${TRAVEL.x} × ${TRAVEL.z} mm as ARUM lists them; A 360°, B ±30°; ${SPEC.tools} tools on Ø${SPEC.shank} mm shanks; DC ${SPEC.kw.toFixed(1)} kW, ${SPEC.rpm.toLocaleString("en-US")} rpm); finishing tool as ARUM's ZB-86 (Ø1.0 mm ball, 20 mm reach, 60 mm long). Tilts after the guidance of hyperDENT, a CAM ARUM supplies 5X-200 machine data for: 5° at most (3° preferred) where nothing is undercut, 10° or more on walls. ARUM shows its own 5X-200 screw-retained work in metal; zirconia is among the machine's listed materials. Which part moves on which axis, and the letters, are the dealer's: ARUM's sheet lists the ${TRAVEL.y} mm stroke as X. Machine proportions from the dealer's photos, ARUM's product photos and the video, scaled to a standard Ø${SPEC.disc} mm disc; bridge from typical tooth widths and arch form, drawn at one height; column, carriage, flap and chamber schematic, with the chamber's side walls, door and lights left off for the cutaway; styling illustrative. Product data from ARUM Dentistry, used with permission.`,
    body: `<div class="tr-stagewrap">${stage}${inset}</div>` + timeline + axesRow,
  }) +
  `</div>`;
const page = k.pageHtml({ title: "Five-axis finishing", theme: THEME, body, script: turnScript() + modelScript + (verify ? `window.__isoVerify = ${JSON.stringify(out.verify)};\n` : "") + LIVE, width: 680 });
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
  `<title>ARUM 5X-200 Finishing</title><style>${k.ISO_CSS}
:root{--page:#0b0b0b;color-scheme:dark}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--page:#f2f2ef;color-scheme:light}}
:root[data-theme="light"]{--page:#f2f2ef;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--page);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.tr-host{background:var(--anatomy-page);color:var(--anatomy-text);padding-inline:16px;padding-block:40px 64px}
.tr-host .iso-page{width:min(680px,100%);margin:0 auto}
</style><div class="iso tr-host" data-theme="dark"><main class="iso-page">${body}</main></div><script type="module">${(THEME_HOST + turnScript() + modelScript + LIVE).replace(/<\/(script)/gi, "<\\/$1")}</script>`;
// The page for embedding on another site in an iframe: a whole document on its own (no outside requests). ?theme=light
// or ?theme=dark pins the theme (else it follows the reader's system), ?bg=none drops the page colour round the card,
// ?caption=none keeps only the credit line under it, and in a frame it posts its height to the host page
// ({ type: "iso-figure:height", height }) so the frame can fit it.
const EMBED_HOST = `{
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme");
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  if (query.get("bg") === "none") document.querySelector(".tr-host").style.background = "transparent";
  if (query.get("caption") === "none") {
    document.querySelector(".tr-host .iso-keys")?.remove();
    const caption = document.querySelector(".tr-host .iso-caption");
    if (caption) caption.textContent = "Product data from ARUM Dentistry, used with permission.";
  }
  if (window.parent !== window) {
    let last = 0;
    const post = () => { const height = Math.ceil(document.documentElement.getBoundingClientRect().height); if (height !== last) { last = height; window.parent.postMessage({ type: "iso-figure:height", height }, "*"); } };
    new ResizeObserver(post).observe(document.documentElement);
    post();
  }
}
`;
const embedPage = () =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARUM 5X-200 Finishing</title><style>${k.ISO_CSS}
:root{color-scheme:dark}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){color-scheme:light}}
:root[data-theme="light"]{color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.tr-host{background:var(--anatomy-page);color:var(--anatomy-text);padding:16px}
.tr-host .iso-page{width:min(680px,100%);margin:0 auto}
</style></head><body><div class="iso tr-host" data-theme="dark"><main class="iso-page">${body}</main></div><script type="module">${(EMBED_HOST + THEME_HOST + turnScript() + modelScript + LIVE).replace(/<\/(script)/gi, "<\\/$1")}</script></body></html>`;
const artifactOut = argv.find((a) => a.startsWith("--artifact="))?.slice("--artifact=".length);
if (artifactOut && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = artifactPage();
  writeFileSync(artifactOut, html);
  console.log(`wrote ${artifactOut} · ${(html.length / 1024).toFixed(0)} KB (artifact page)`);
}
if (argv.includes("--embed") && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = embedPage();
  writeFileSync(join(HERE, "trunnion-embed.html"), html);
  console.log(`wrote trunnion-embed.html · ${(html.length / 1024).toFixed(0)} KB (embed page)`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const name = `trunnion${verify ? "-verify" : ""}${THEME === "light" ? "-light" : ""}.html`;
  writeFileSync(join(HERE, name), page);
  console.log(`wrote ${name} · ${(page.length / 1024).toFixed(0)} KB · ${out.report.parts} parts · ${out.report.layers.map((l) => `${l.name}: ${l.planar} planes, ${l.framed} framed, ${l.dynamic} dynamic`).join(" · ")} · build ${out.report.seconds.toFixed(1)} s`);
}
export { out };
