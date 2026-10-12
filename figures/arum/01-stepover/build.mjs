// Fig 1 · Stepover is surface finish (ARUM A3 class tool: Ø4 shank, ball-end finishing bur).
// node build.mjs [--light] [--audit]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../../.claude/skills/anatomy/kit/lathe.mjs";
import * as A from "../../../.claude/skills/anatomy/kit/audit.mjs";
import { kitScript } from "../../../.claude/skills/anatomy/scripts/inline-kit.mjs";
import { TOOLS, readoutOf, wordsOf, ridge } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";

const W = 600;
const H = 440;
const AZIMUTH = 38;
const MM = 10; // world units per millimetre

// Bench
const PLATE = { x: -176, y: -96, w: 306, d: 172, r: 8 };
const PLATE_H = 10;
const FOOT_H = 5;

// Vise and coupon (12 x 8 x 3 mm of pre-sintered zirconia cut from a disc); the passes cover 8 x 8 mm of it
const VISE = { x: -84, y: -48, w: 168, d: 94, r: 2 };
const VISE_H = 10;
const COUPON = { x: -60, y: -42, w: 12 * MM, d: 8 * MM, r: 0.6 };
const TOP = VISE_H + 30;
const JAW_H = 24;

// Spindle over the coupon
const SP = [40, -14];
const SHANK_R = 2 * MM; // Ø4 shank
const SHANK_TOP = 126;
const NUT = [132, 148];
const COLLAR = [162, 178];
const HOUSING_TOP = 198;
const COLUMN = [40, -78];

// Profilometer (drive unit with a sliding detector rod)
const DRIVE = { x: -166, y: 4, w: 72, d: 32, r: 3 };
const DRIVE_Z = [52, 88];
const PILLAR = [-130, 20];
const ROD_Y = 20;
const ROD_Z = 72;
const GLAND_X = DRIVE.x + DRIVE.w;
const ROD_TO = 56;
const TRAVEL = 24; // 2.4 mm traverse
const STYLUS_X0 = GLAND_X + ROD_TO + 4;
const WINDOW = { x0: -161, x1: -104, z0: 57, z1: 84, r: 1.8 };
const TRACE = { x0: WINDOW.x0 + 2.5, x1: WINDOW.x1 - 2.5, z0: WINDOW.z0 + 2.5, z1: WINDOW.z1 - 6.5, full: 12 }; // full scale 12 µm
const FRONT = DRIVE.y + DRIVE.d;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [COLUMN[0], COLUMN[1], HOUSING_TOP + 6], [SP[0], SP[1] + 40, HOUSING_TOP + 4], [SP[0] + 40, SP[1], HOUSING_TOP]],
  W,
  H,
  { pad: 38, azimuth: AZIMUTH },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const Faded = (list, style) => k.fadedSvg(list, style);
const up = (x, y, z = 0) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const alongX = (x, y, z) => G.frameOf([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const alongY = (x, y, z) => G.frameOf([x, y, z], [0, 1, 0], [-1, 0, 0], [0, 0, 1]);
const planeOf = (y) => k.sideMatrix([0, y], 0, P, "left");
const flat = (x0, z0, x1, z1, r, steps = 6) => k.pathOf(k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, steps).map(([u, z]) => [u, -z]), true);

const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, ...rest } = {}) {
  return R.put({ name, at: ref, bias, svg, shapes, piece: "rig", ...rest });
}
function box(name, plan, z0, z1, style = {}, { steps = 4, bevel = 0, extra = "", inner = "", bias = 0, owner, ...rest } = {}) {
  const shape = record(A.slab(plan, z0, z1 - z0, { name, owner }, steps));
  put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, ...rest });
  return shape;
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, owner, bevel = 0, steps, ...rest } = {}) {
  const paths = G.solidOf(profile, F, P, { bevel, ...(steps ? { steps } : {}) });
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner }));
  put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, ...rest });
  return shape;
}
const disc = (name, F, s0, s1, r, style, options) => turned(name, F, [[s0, r], [s1, r]], style, options);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// ---------- bench plate (static, drawn first) ----------
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 10);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
const STRIP = { x: -60, y: PLATE.y + PLATE.d - 13, w: 140, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
const ticks = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.8, 3.4], P);
back.push(Ln(ticks.minor, { tone: "lo" }), Ln(ticks.major, { tone: "mid" }));
back.push(Dots([at([STRIP.x + 2, STRIP.y + 3, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 3, 0.6])], { size: 0.45 }));
const LABEL = { x: 80, y: PLATE.y + PLATE.d - 30, w: 30, d: 13, r: 1.2 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.6), 0.8, P, 3), { tone: "faint" }));
back.push(Ln([20, 14, 17].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 3.6 + i * 2.9], [LABEL.x + 4 + w, LABEL.y + 3.6 + i * 2.9], 0.8, P)).join(""), { tone: "lo", free: true }));
back.push(Dots([at([LABEL.x + LABEL.w - 3, LABEL.y + 3, 0.8]), at([LABEL.x + LABEL.w - 3, LABEL.y + LABEL.d - 3, 0.8])], { size: 0.45 }));

// ---------- vise ----------
const viseBolts = [[VISE.x + 6, VISE.y + 6], [VISE.x + 6, VISE.y + VISE.d - 6], [VISE.x + VISE.w - 6, VISE.y + 6], [VISE.x + VISE.w - 6, VISE.y + VISE.d - 6]];
box("vise.base", VISE, 0, VISE_H, { tone: "mid" }, { bevel: 0.8, inner: Ln(k.sideSeam(VISE, 4, P, 4), { tone: "faint" }), owner: "vise", extra: Ln(viseBolts.map(([x, y]) => k.ring(x, y, 2.2, VISE_H, P, 16)).join(""), { tone: "lo" }) + Dots(viseBolts.map(([x, y]) => at([x, y, VISE_H])), { size: 0.5 }) });
const JAWS = [
  { name: "jaw.fixed", plan: { x: COUPON.x - 16, y: VISE.y + 2, w: 16, d: VISE.d - 4, r: 1.2 } },
  { name: "jaw.moving", plan: { x: COUPON.x + COUPON.w, y: VISE.y + 2, w: 16, d: VISE.d - 4, r: 1.2 } },
];
for (const { name, plan } of JAWS) {
  const bolts = [plan.y + 10, plan.y + plan.d - 10].map((y) => [plan.x + plan.w / 2, y]);
  const heads = bolts.map(([x, y]) => S(k.cylinder(x, y, 2.6, VISE_H + JAW_H, 1.6, P, 20), { tone: "mid" }) + Ln(k.lineOnTop([x - 2.6, y], [x + 2.6, y], VISE_H + JAW_H + 1.6, P), { tone: "lo" })).join("");
  box(name, plan, VISE_H, VISE_H + JAW_H, { tone: "mid" }, { bevel: 0.6, owner: "vise", extra: heads, inner: Ln(k.sideSeam(plan, VISE_H + JAW_H - 5, P, 4), { tone: "faint" }) });
}
// lead screw and knurled handle on the moving jaw
const SCREW = alongX(COUPON.x + COUPON.w + 16, VISE.y + VISE.d / 2, VISE_H + 12);
disc("vise.boss", SCREW, 0, 3, 5, { tone: "mid" }, { owner: "vise" });
disc("vise.screw", SCREW, 3, 18, 2.6, { tone: "mid" }, { owner: "vise", inner: Ln(G.arcOf(SCREW, 10, 2.6, P), { tone: "faint" }) });
turned("vise.handle", SCREW, [[18, 6.4], [19, 7], [27, 7], [28, 6.4]], { tone: "mid" }, { owner: "vise", extra: Faded(G.ribsOf(SCREW, 19, 27, 7, 40, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });

// ---------- coupon (the subject) ----------
const coupon = record(A.slab(COUPON, VISE_H, TOP - VISE_H, { name: "coupon", owner: "vise" }, 3));
put("coupon", [0, COUPON.y + COUPON.d / 2, (VISE_H + TOP) / 2], S(k.slabOf(COUPON, VISE_H, TOP - VISE_H, P, 3), { tone: "hi", crease: "lo", inner: Ln(k.sideSeam(COUPON, TOP - 1.2, P, 3), { tone: "faint" }) + `<g data-part="passes"></g>` }) + k.faceTextSvg(k.sideMatrix([COUPON.x + 8, COUPON.y + COUPON.d], VISE_H + 6, P, "left"), "ZrO2 · 3Y", { size: 3.2, tone: "lo" }), [coupon]);

// ---------- column, arm and spindle ----------
const colF = up(COLUMN[0], COLUMN[1]);
disc("column.foot", colF, 0, 4, 13, { tone: "mid" }, { owner: "spindle", bevel: 0.6, extra: Dots(G.dotsOf(colF, 4, 10.6, 6, P, { all: true, phase: 0.3 }), { size: 0.45 }) });
disc("column.post", colF, 4, COLLAR[0] + 1, 9, { tone: "mid" }, { owner: "spindle", inner: Ln(G.arcOf(colF, 60, 9, P) + G.arcOf(colF, 120, 9, P), { tone: "faint" }) });
disc("column.top", colF, COLLAR[1] - 1, COLLAR[1] + 12, 9, { tone: "mid" }, { owner: "spindle" });
disc("column.cap", colF, COLLAR[1] + 12, COLLAR[1] + 15, 10.4, { tone: "mid" }, { owner: "spindle", bevel: 0.5 });
const ARM = { x: SP[0] - 11, y: COLUMN[1] - 4, w: 22, d: SP[1] - COLUMN[1] - 32, r: 2 };
box("arm", ARM, COLLAR[0] + 1, COLLAR[1] - 1, { tone: "mid" }, { owner: "spindle", bevel: 0.6, extra: Dots([at([SP[0], ARM.y + 10, COLLAR[1] - 1]), at([SP[0], ARM.y + ARM.d - 6, COLLAR[1] - 1])], { size: 0.5 }) });
const spF = up(SP[0], SP[1]);
turned("housing.low", spF, [[NUT[1], 30], [NUT[1] + 2, 32], [COLLAR[0], 32]], { tone: "mid" }, { owner: "spindle", inner: Ln(G.arcOf(spF, NUT[1] + 8, 32, P), { tone: "faint" }) });
disc("collar", spF, COLLAR[0], COLLAR[1], 38, { tone: "mid" }, { owner: "spindle", bevel: 0.6, extra: Ln(k.segment([SP[0], SP[1] + 38, COLLAR[0]], [SP[0], SP[1] + 38, COLLAR[1]], P), { tone: "lo" }) });
turned("housing.high", spF, [[COLLAR[1], 32], [HOUSING_TOP - 4, 32], [HOUSING_TOP, 28], [HOUSING_TOP, 14], [HOUSING_TOP + 3, 14]], { tone: "mid" }, { owner: "spindle", inner: Ln(G.arcOf(spF, COLLAR[1] + 10, 32, P), { tone: "faint" }) });
turned("nut", spF, [[NUT[0], 25], [NUT[0] + 2, 28], [NUT[1] - 2, 28], [NUT[1], 26]], { tone: "mid" }, { owner: "spindle", extra: Faded(G.ribsOf(spF, NUT[0] + 2, NUT[1] - 2, 28, 56, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });
turned("collet", spF, [[SHANK_TOP, SHANK_R], [SHANK_TOP + 2, 22.5], [NUT[0], 23.5]], { tone: "mid" }, { owner: "spindle" });

// Burs: a ball-end finishing bur on a Ø4 shank, drawn for both tools. Two solids each:
// the cutting part (ball and fluted body) and the neck, taper and shank sitting on its shoulder.
function burProfiles(d) {
  const rb = (d / 2) * MM;
  const flute = TOP + rb + 1.5 * d * MM;
  const neck = flute + 6;
  const taper = neck + 20;
  if (!(taper < SHANK_TOP)) throw new Error(`bur ${d}: taper ends above the shank top`);
  return { rb, flute, body: [[TOP + rb, rb], [flute, rb]], shank: [[flute, rb * 0.86], [neck, rb * 0.86], [taper, SHANK_R], [SHANK_TOP, SHANK_R]] };
}
const BURS = { 1: burProfiles(TOOLS[1].d), 2: burProfiles(TOOLS[2].d) };

// One item per tool and part; the page shows one tool's pair at a time.
for (const tool of [1, 2]) {
  const { rb, flute, body, shank } = BURS[tool];
  const hide = tool === 2 ? "" : ' style="display:none"';
  // the ball is a true sphere; the fluted body's bottom rim lands on its equator
  const ballAt = [SP[0], SP[1], TOP + rb];
  put(
    `bur.cut${tool}`,
    ballAt,
    `<g data-tool="${tool}"${hide}>${S(G.sphereOf(ballAt, rb, P, { steps: 48 }), { tone: "mid" })}${S(G.solidOf(body, spF, P, {}), { tone: "mid" })}${Faded(G.ribsOf(spF, TOP + rb, flute, rb, 6, P, { twist: 1.6, fade: [0.1, 0.55] }), { tone: "lo" })}</g>`,
    [record(A.ball(ballAt, rb, { name: `bur.ball${tool}`, owner: "spindle" })), record(A.solid(spF, body, { name: `bur.cut${tool}`, owner: "spindle" }))],
  );
  put(
    `bur.shank${tool}`,
    [SP[0], SP[1], (flute + SHANK_TOP) / 2],
    `<g data-tool="${tool}"${hide}>${S(G.solidOf(shank, spF, P, {}), { tone: "mid" })}</g>`,
    [record(A.solid(spF, shank, { name: `bur.shank${tool}`, owner: "spindle" }))],
  );
}
// The two tools are never shown together, so pairs across them are not ordered.
const ALLOW = [["bur.cut1", "bur.cut2"], ["bur.shank1", "bur.shank2"], ["bur.cut1", "bur.shank2"], ["bur.cut2", "bur.shank1"]];

// ---------- profilometer ----------
const pilF = up(PILLAR[0], PILLAR[1]);
disc("gauge.foot", pilF, 0, 5, 15, { tone: "mid" }, { owner: "gauge", bevel: 0.6, extra: Dots(G.dotsOf(pilF, 5, 11.5, 3, P, { all: true, phase: 0.5 }), { size: 0.45 }) });
disc("gauge.pillar", pilF, 5, 34, 5.2, { tone: "mid" }, { owner: "gauge" });
disc("gauge.pillar.top", pilF, 42, DRIVE_Z[0], 5.2, { tone: "mid" }, { owner: "gauge" });
disc("gauge.lock", pilF, 34, 42, 8.4, { tone: "mid" }, { owner: "gauge", bevel: 0.4 });
const lockF = alongY(PILLAR[0], PILLAR[1] + 8.2, 38);
turned("gauge.knob", lockF, [[0, 2.2], [3, 2.2], [3, 4.6], [8, 4.6], [8.6, 4]], { tone: "mid" }, { owner: "gauge", extra: Faded(G.ribsOf(lockF, 3, 8, 4.6, 28, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });

// the screen sits in the plane of the drive's front face
const glassShape = flat(WINDOW.x0, WINDOW.z0, WINDOW.x1, WINDOW.z1, WINDOW.r);
const DEPTH = 1.2;
const recessSides = (() => {
  const ring = k.roundedPlan({ x: WINDOW.x0, y: WINDOW.z0, w: WINDOW.x1 - WINDOW.x0, d: WINDOW.z1 - WINDOW.z0, r: WINDOW.r }, 6);
  const cx = (WINDOW.x0 + WINDOW.x1) / 2;
  const cz = (WINDOW.z0 + WINDOW.z1) / 2;
  const { sinA } = k.cameraOf(P);
  const tops = [];
  const sides = [[], [], [], []];
  ring.forEach(([ax, az], index) => {
    const [bx, bz] = ring[(index + 1) % ring.length];
    const length = Math.hypot(bx - ax, bz - az) || 1;
    let [nx, nz] = [(bz - az) / length, -(bx - ax) / length];
    if (nx * (cx - (ax + bx) / 2) + nz * (cz - (az + bz) / 2) < 0) [nx, nz] = [-nx, -nz];
    if (nx <= 0 && nz <= 0) return;
    const quad = k.pathOf([at([ax, FRONT, az]), at([bx, FRONT, bz]), at([bx, FRONT - DEPTH, bz]), at([ax, FRONT - DEPTH, az])], true);
    if (nz >= nx) tops.push(quad);
    else sides[Math.min(3, Math.max(0, Math.floor(((nx * -sinA + 1) / 2) * 4)))].push(quad);
  });
  return `<path class="iso-top" d="${tops.join("")}"/>` + sides.map((d, shade) => (d.length ? `<path class="iso-shade" data-shade="${shade}" d="${d.join("")}"/>` : "")).join("");
})();
const fullScale = `M${TRACE.x0} ${-TRACE.z1}H${TRACE.x1}`;
const baseLine = `M${TRACE.x0} ${-TRACE.z0}H${TRACE.x1}`;
const screen = [
  `<clipPath id="so-window"><path transform="${planeOf(FRONT)}" d="${glassShape}"/></clipPath>`,
  `<g clip-path="url(#so-window)">${recessSides}`,
  `<g transform="${planeOf(FRONT - DEPTH)}">`,
  `<path class="so-glass" d="${glassShape}"/>`,
  `<path class="so-grid" d="${fullScale}${baseLine}"/>`,
  `<path class="so-trace" data-part="trace" d=""/>`,
  `<text class="so-text" data-part="screen-value" x="${TRACE.x1}" y="${-(WINDOW.z1 - 4.6)}" font-size="3.6" text-anchor="end"></text>`,
  `<text class="so-text so-dim" x="${TRACE.x0}" y="${-(WINDOW.z1 - 4.6)}" font-size="3.6">12 µm</text>`,
  `<path class="iso-line" data-tone="faint" d="${glassShape}"/>`,
  `</g></g>`,
  `<g transform="${planeOf(FRONT)}"><path class="iso-line" data-tone="lo" d="${glassShape}"/></g>`,
].join("");
const buttons = [[GLAND_X - 10, DRIVE.y + 9], [GLAND_X - 10, DRIVE.y + 21]].map(([x, y]) => S(k.cylinder(x, y, 2.8, DRIVE_Z[1], 1.4, P, 20), { tone: "mid" })).join("");
box("gauge.drive", DRIVE, DRIVE_Z[0], DRIVE_Z[1], { tone: "mid" }, {
  owner: "gauge",
  steps: 6,
  bevel: 1,
  inner: Ln(k.sideSeam(DRIVE, DRIVE_Z[0] + 1.6, P, 6), { tone: "faint" }),
  extra: screen + buttons + Ln(k.planOutline(k.insetPlan(DRIVE, 4), DRIVE_Z[1], P, 4), { tone: "faint" }),
});
const rodF = alongX(GLAND_X, ROD_Y, ROD_Z);
disc("gauge.gland", rodF, 0, 2, 5, { tone: "mid" }, { owner: "gauge", extra: Ln(G.circleOf(rodF, 2, 2.6, P), { tone: "faint" }) });

// moving detector: rod, holder, pickup, stylus (all translate together along +x)
const MOVE = [TRAVEL, 0, 0];
const ROD = G.rodOut(rodF, 2, ROD_TO, 2.2, P, { stroke: TRAVEL });
put(
  "gauge.rod",
  G.pointOf(rodF, ROD_TO / 2, 0, 0),
  `<clipPath id="so-rod"><path data-hold d="${ROD.clip}"/></clipPath><g clip-path="url(#so-rod)">${S(ROD.paths, { tone: "mid" })}</g>`,
  [record(A.slide(rodF, 2, ROD_TO, 2.2, { name: "gauge.rod", owner: "gauge" }))],
  { move: MOVE, attrs: ' data-move=""' },
);
const tipX = GLAND_X + ROD_TO;
const HOLDER = { x: tipX, y: ROD_Y - 4, w: 8, d: 8, r: 1 };
box("gauge.holder", HOLDER, ROD_Z - 9, ROD_Z + 4, { tone: "mid" }, { owner: "gauge", bevel: 0.4, move: MOVE, attrs: ' data-move=""', extra: Dots([at([tipX + 4, ROD_Y + 4, ROD_Z])], { size: 0.45 }) });
const stF = up(STYLUS_X0, ROD_Y);
turned("gauge.pickup", stF, [[TOP + 9, 2.4], [ROD_Z - 9, 2.4]], { tone: "mid" }, { owner: "gauge", move: MOVE, attrs: ' data-move=""', inner: Ln(G.arcOf(stF, TOP + 14, 2.4, P), { tone: "faint" }) });
turned("gauge.stylus", stF, [[TOP, 0], [TOP + 2.2, 0.55], [TOP + 9, 0.7]], { tone: "hi" }, { owner: "gauge", move: MOVE, attrs: ' data-move=""' });

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);

const groups = R.items.map((item) => `<g class="it" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>`);

const LABEL_TEXT =
  "A test bench: a small block of pre-sintered zirconia clamped in a vise, a spindle above it holding a ball-end finishing bur partway along a pass, and a stylus profilometer whose stylus rests on the milled surface. The pass lines on the block's top face are as far apart as the stepover; the profilometer's screen draws the ridge left between passes.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, ...groups] });

const DATA = {
  PATCH: 8 * MM,
  P,
  MM,
  TOP,
  COUPON,
  SP,
  BUR_Y: SP[1],
  TRAVEL,
  STYLUS_X0,
  TRACE,
};
const CSS = `
.iso{--so-glass:#0f1110;--so-grid:#2b302d}
.iso[data-theme="light"]{--so-glass:#e9ebe8;--so-grid:#cfd3cf}
.so-glass{fill:var(--so-glass)}
.so-grid{fill:none;stroke:var(--so-grid);stroke-width:.4}
.so-trace{fill:none;stroke:var(--anatomy-lit);stroke-width:.6;stroke-linejoin:round}
.so-text{fill:var(--anatomy-hi);font-family:ui-monospace,Menlo,monospace}
.so-dim{fill:var(--anatomy-mid)}
.so-stage{touch-action:pan-y}
.so-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.so-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:480px){.so-plate .iso-plate-corner[data-corner="readout"]{font-size:9px;letter-spacing:0}}
@media (max-width:360px){.so-plate .iso-plate-corner[data-corner="readout"]{font-size:8px}}
`;
const modelScript = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));

const START = [2, 0.3]; // the idle tour's first stop
const body =
  `<style>${CSS}</style><div class="so-plate">` +
  k.plateHtml({
    fig: "Fig 1",
    title: "Stepover is surface finish",
    hint: "← → stepover · 1 2 ball",
    readout: readoutOf(...START),
    keys: [
      { mark: "lit", label: "Profilometer trace: the ridge left between two passes, magnified vertically" },
      { mark: "raised", label: "Zirconia block: one line per pass, one stepover apart (lighter where they crowd)" },
    ],
    caption:
      `A ball-end bur leaves a small ridge between neighbouring passes. Its theoretical height, as milled and before sintering, is h = r − √(r² − (s/2)²) for ball radius r and stepover s, so it grows with roughly the square of the stepover: a Ø1.0 mm ball at 0.10 mm leaves ${(ridge(1, 0.1) * 1000).toFixed(1)} µm, at 0.05 mm only ${(ridge(1, 0.05) * 1000).toFixed(2)} µm, but twice as many passes. The passes cover an 8 × 8 mm patch, one at each edge and one every stepover between. ` +
      "The block and burs are drawn to scale (10 units per millimetre); the bench, spindle and profilometer are schematic. The trace is magnified vertically (full scale 12 µm), as profilometer traces are. Tool shown: Ø4 mm shank, as on the ARUM A3 (60,000 rpm). Product data from ARUM Dentistry (A3 & A3L catalog, Ver. 2025-Nov-EN), used with permission; form and styling illustrative.",
    body: `<div class="iso-stage so-stage" tabindex="0" role="slider" aria-label="Stepover. Left and right arrows change the stepover, Shift for bigger steps; 1 and 2 choose a 1 or 2 millimetre ball; Home and End go to the ends of the range." aria-valuemin="0.05" aria-valuemax="0.3" aria-valuenow="0.3" aria-valuetext="${wordsOf(...START)}">${svg}<span class="so-sr" role="status" aria-live="polite" data-status></span></div>`,
  }) +
  `</div>`;

const page = k.pageHtml({ title: "Stepover is surface finish", theme: THEME, body, script: kitScript() + modelScript + LIVE, width: 650 });
const name = THEME === "light" ? "stepover-light.html" : "stepover.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`);

A.auditOrExit(R, P, { allow: ALLOW });
