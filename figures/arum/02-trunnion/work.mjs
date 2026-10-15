// The milled disc on the holder's face B: the bridge standing in its roughed channel, drawn in the face's own plane. A
// plane can only carry flat markup, so depth is drawn as the 2.5D trick for prisms seen from above: everything at depth
// d is the same outline moved by d·sh, where sh is how far one millimetre down moves a point across the face on screen
// (live.js reads it from the two face planes each frame). Pure: path strings only, no DOM.
import { BRIDGE, OUTLINE, OPENING, TEETH, CHANNELS, CONNECTORS, ARCH_L, OCC_SPAN, archAt, halfWidths, bandOutline } from "./model.mjs";

const n2 = (v) => Math.round(v * 100) / 100;
const pt = (p) => `${n2(p[0])} ${n2(p[1])}`;
const ring = (pts) => `M${pts.map(pt).join("L")}Z`;
const line = (pts) => `M${pts.map(pt).join("L")}`;
const circleAt = (c, r, n = 20) => ring(Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((i / n) * 2 * Math.PI), c[1] + r * Math.sin((i / n) * 2 * Math.PI)]));
const signedArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i]; const q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
// outward normals of a closed polygon's edges
const normalsOf = (pts) => {
  const ccw = signedArea(pts) > 0;
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const l = Math.hypot(ex, ey) || 1;
    return ccw ? [ey / l, -ex / l] : [-ey / l, ex / l];
  });
};

export const DISC_FACE = 45.5;
const BODY = { pts: OUTLINE.pts, s: OUTLINE.s, side: OUTLINE.side, n: normalsOf(OUTLINE.pts) };
const MOAT = { pts: OPENING.pts, n: normalsOf(OPENING.pts) };
const CONN = CONNECTORS.map((c) => ({ ...c, n: normalsOf(c.quad) }));
const THROUGH = 2 * 12.5;
const STEP_DEPTHS = [4, 7, 10, 13, 16, 19];
const MOAT_STEPS = [5, 10, 15, 20];
const OPEN_D = ring(MOAT.pts);
const BODY_D = ring(BODY.pts);

// the occlusal pass's reveal: a broad stroke along the path the tool follows, drawn on as it goes (mask dash)
const REVEAL = (() => {
  const pts = [];
  for (let s = OCC_SPAN[0]; s <= OCC_SPAN[1] + 1e-9; s += 0.5) {
    const c = archAt(s);
    const [hb, hl] = halfWidths(Math.max(-ARCH_L, Math.min(ARCH_L, s)));
    const o = (hb - hl) / 2;
    pts.push([c.p[0] + o * c.n[0], c.p[1] + o * c.n[1]]);
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let widest = 0;
  for (let s = 0; s <= ARCH_L; s += 1) widest = Math.max(widest, ...halfWidths(s));
  return { d: line(pts), len: Math.ceil(len), width: 2 * widest + 4 };
})();

// the finished occlusal anatomy: crown outlines, cusp tips, fissures and incisal edges (in the arch's own coordinates:
// along the arch from the midline, across it toward buccal)
const toXY = (side, s, o) => { const c = archAt(side * s); return [c.p[0] + o * c.n[0], c.p[1] + o * c.n[1]]; };
const anatomy = (() => {
  const outlines = [];
  const lines = [];
  const dots = [];
  for (const tooth of TEETH) {
    const { side, index, md, bl } = tooth;
    const s0 = Math.min(Math.abs(tooth.s[0]), Math.abs(tooth.s[1]));
    const at = (f, g) => toXY(side, s0 + f * md, g * bl);
    outlines.push(ring(tooth.outline));
    if (index <= 1) lines.push(line([at(0.18, 0.2), at(0.5, 0.24), at(0.82, 0.2)]));
    else if (index === 2) { dots.push(at(0.5, 0.12)); lines.push(line([at(0.15, 0.05), at(0.5, 0.12), at(0.85, 0.05)])); }
    else if (index <= 4) { dots.push(at(0.5, 0.22), at(0.5, -0.2)); lines.push(line([at(0.2, 0.02), at(0.5, 0), at(0.8, 0.02)])); }
    else {
      dots.push(at(0.28, 0.24), at(0.72, 0.24), at(0.3, -0.22), at(0.74, -0.24));
      lines.push(line([at(0.15, 0.02), at(0.5, -0.02), at(0.85, 0.03)]), line([at(0.3, -0.22), at(0.72, 0.24)]));
    }
  }
  return { outlines: outlines.join(""), lines: lines.join(""), dots: dots.map((d) => circleAt(d, 0.45, 10)).join("") };
})();
// the roughed top before finishing: the roughing ball's terraces, inset from the outline
const TERRACES = [-1.3, -2.6].map((g) => ring(bandOutline(g, 1.2).pts)).join("");
const HOLES = CHANNELS.map((c) => circleAt(c.p, BRIDGE.channel / 2, 18)).join("");
const HOLE_RIMS = CHANNELS.map((c) => circleAt(c.p, BRIDGE.channel / 2 + 0.7, 22)).join("");

const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
// the swept sides of a prism outline between two depths: one quad per edge facing the viewer (n·sh > 0, or < 0 for a
// pocket's far walls), all wound the same way so the union fills under nonzero
function sides(poly, d0, d1, sh, pick) {
  let out = "";
  for (let i = 0; i < poly.pts.length; i++) {
    if (!pick(i)) continue;
    const p = poly.pts[i];
    const q = poly.pts[(i + 1) % poly.pts.length];
    const quad = [add(p, sh, d0), add(q, sh, d0), add(q, sh, d1), add(p, sh, d1)];
    if (signedArea(quad) < 0) quad.reverse();
    out += ring(quad);
  }
  return out;
}
// lines along the picked edges at one depth, joined into runs
function runs(poly, depth, sh, pick) {
  let out = "";
  let open = false;
  for (let i = 0; i < poly.pts.length; i++) {
    if (!pick(i)) { open = false; continue; }
    const p = add(poly.pts[i], sh, depth);
    const q = add(poly.pts[(i + 1) % poly.pts.length], sh, depth);
    out += open ? `L${pt(q)}` : `M${pt(p)}L${pt(q)}`;
    open = true;
  }
  return out;
}

// which edges each finishing pass has passed: the buccal pass runs −L → +L on the buccal side, the palatal pass +L → −L
// on the palatal side; a round end counts as done once the pass that ends there is done
function finishedEdge(i, done) {
  const s = BODY.s[i];
  const side = BODY.side[i];
  if (side > 0) return s <= -ARCH_L + done.buccal * 2 * ARCH_L;
  if (side < 0) return s >= ARCH_L - done.palatal * 2 * ARCH_L;
  return s > 0 ? done.buccal >= 1 : done.palatal >= 1;
}

// Everything that moves with the view and the job. sh: depth shift per mm (disc frame); done: the passes' progress;
// lit(n): whether a wall with outward normal n faces the light.
export function workShapes(sh, done, lit) {
  const facing = (poly, sign = 1) => (i) => sign * (poly.n[i][0] * sh[0] + poly.n[i][1] * sh[1]) > 1e-6;
  const bodyFacing = facing(BODY);
  const body = { roughLit: "", roughShade: "", finLit: "", finShade: "" };
  for (const fin of [false, true]) for (const isLit of [true, false]) {
    const key = `${fin ? "fin" : "rough"}${isLit ? "Lit" : "Shade"}`;
    body[key] = sides(BODY, BRIDGE.top, BRIDGE.base, sh, (i) => bodyFacing(i) && finishedEdge(i, done) === fin && lit(BODY.n[i]) === isLit);
  }
  const roughFacing = (i) => bodyFacing(i) && !finishedEdge(i, done);
  const bodySteps = STEP_DEPTHS.map((d) => runs(BODY, d, sh, roughFacing)).join("");
  // the channel's far walls (seen from inside the pocket) and their roughing steps
  const moatFar = facing(MOAT, -1);
  const moatSteps = MOAT_STEPS.map((d) => runs(MOAT, d, sh, moatFar)).join("");
  // connectors: those on walls facing away sit behind the bridge, the rest in front of it
  const conn = { farTop: "", farSide: "", nearTop: "", nearSide: "" };
  for (const c of CONN) {
    const out = archAt(c.s).n;
    const toward = c.wall * (out[0] * sh[0] + out[1] * sh[1]) > 0;
    const k = toward ? "near" : "far";
    conn[`${k}Top`] += ring(c.quad.map((p) => add(p, sh, c.depth[0])));
    conn[`${k}Side`] += sides({ pts: c.quad, n: c.n }, c.depth[0], c.depth[1], sh, (i) => c.n[i][0] * sh[0] + c.n[i][1] * sh[1] > 1e-6);
  }
  return {
    floor: `translate(${n2(sh[0] * THROUGH)} ${n2(sh[1] * THROUGH)})`,
    top: `translate(${n2(sh[0] * BRIDGE.top)} ${n2(sh[1] * BRIDGE.top)})`,
    moatSteps,
    body,
    bodySteps,
    conn,
    reveal: n2(REVEAL.len * (1 - done.occlusal)),
  };
}

// the markup, with each live piece tagged data-w so live.js can find it; filled for one view and state
export function workSvg(sh, done, lit, id = "tr") {
  const w = workShapes(sh, done, lit);
  const P = (k, cls, d, extra = "") => `<path data-w="${k}" class="${cls}"${extra} d="${d}"/>`;
  const box = 'maskUnits="userSpaceOnUse" x="-60" y="-60" width="120" height="120"';
  const stroke = `class="tr-reveal" fill="none" stroke-width="${REVEAL.width}" stroke-dasharray="${REVEAL.len} ${REVEAL.len}" d="${REVEAL.d}"`;
  return (
    `<g class="tr-work" transform="scale(-1 -1)">` +
    `<defs><clipPath id="${id}-open"><path d="${OPEN_D}"/></clipPath>` +
    `<mask id="${id}-fin" ${box}><path data-w="reveal" stroke="#fff" ${stroke} stroke-dashoffset="${w.reveal}"/></mask>` +
    `<mask id="${id}-raw" ${box}><rect x="-60" y="-60" width="120" height="120" fill="#fff"/><path data-w="reveal" stroke="#000" ${stroke} stroke-dashoffset="${w.reveal}"/></mask></defs>` +
    `<path class="tr-disc" fill-rule="evenodd" d="${circleAt([0, 0], DISC_FACE, 96)}${OPEN_D}"/>` +
    `<g clip-path="url(#${id}-open)">` +
    `<path class="tr-moat" d="${OPEN_D}"/>` +
    P("floor", "tr-void", OPEN_D, ` transform="${w.floor}"`) +
    P("moatSteps", "iso-line", w.moatSteps, ' data-tone="faint" data-free="both"') +
    P("connFarSide", "tr-conn-side", w.conn.farSide) +
    P("connFarTop", "tr-conn", w.conn.farTop) +
    P("roughShade", "tr-wall tr-rough", w.body.roughShade) +
    P("roughLit", "tr-wall tr-rough", w.body.roughLit, ' data-lit=""') +
    P("finShade", "tr-wall tr-fin", w.body.finShade) +
    P("finLit", "tr-wall tr-fin", w.body.finLit, ' data-lit=""') +
    P("bodySteps", "iso-line", w.bodySteps, ' data-tone="faint" data-free="both"') +
    P("connNearSide", "tr-conn-side", w.conn.nearSide) +
    P("connNearTop", "tr-conn", w.conn.nearTop) +
    `<g data-w="top" transform="${w.top}">` +
    `<path class="tr-top" d="${BODY_D}"/>` +
    `<g mask="url(#${id}-raw)"><path class="iso-line" data-tone="faint" d="${TERRACES}"/></g>` +
    `<g mask="url(#${id}-fin)"><path class="tr-crowns" d="${anatomy.dots}"/><path class="iso-line" data-tone="lo" d="${anatomy.outlines}"/><path class="iso-line" data-tone="lo" data-free="both" d="${anatomy.lines}"/></g>` +
    `<path class="tr-hole" d="${HOLES}"/><path class="iso-line" data-tone="faint" d="${HOLE_RIMS}"/>` +
    `<path class="iso-line" data-tone="mid" d="${BODY_D}"/>` +
    `</g></g>` +
    `<path class="iso-line" data-tone="lit" d="${circleAt([0, 0], DISC_FACE, 96)}"/>` +
    `<path class="iso-line" data-tone="lo" d="${OPEN_D}"/>` +
    `</g>`
  );
}

// face A (the underside at A = 0): the channel goes through, so the bridge's intaglio side shows in it, held by the
// connectors; drawn flat (that face is only seen when the holder is turned over)
export function underSvg() {
  // face A's u and v are face B's, so the same disc frame holds
  const flipped = (pts) => pts;
  return (
    `<g class="tr-work" transform="scale(-1 -1)">` +
    `<path class="tr-disc" fill-rule="evenodd" d="${circleAt([0, 0], 49.25, 96)}${ring(flipped(MOAT.pts))}"/>` +
    `<path class="tr-void" d="${ring(flipped(MOAT.pts))}"/>` +
    `<path class="tr-conn" d="${CONN.map((c) => ring(flipped(c.quad))).join("")}"/>` +
    `<path class="tr-top" d="${ring(flipped(BODY.pts))}"/>` +
    `<path class="tr-hole" d="${CHANNELS.map((c) => circleAt(c.p, BRIDGE.channel / 2 + 0.6, 18)).join("")}"/>` +
    `<path class="iso-line" data-tone="mid" d="${ring(flipped(BODY.pts))}"/>` +
    `<path class="iso-line" data-tone="lit" d="${circleAt([0, 0], 49.25, 96)}"/>` +
    `</g>`
  );
}
