// The milled disc on the holder's face B: the bridge standing in its roughed channel, drawn in the face's own plane. A
// plane can only carry flat markup, so depth is drawn as the 2.5D trick for prisms seen from above: everything at depth
// d is the same outline moved by d·sh, where sh is how far one millimetre down moves a point across the face on screen
// (live.js reads it from the two face planes each frame). Pure: path strings only, no DOM.
import { BRIDGE, OUTLINE, OPENING, TEETH, CHANNELS, CONNECTORS, ARCH_L, OCC_SPAN, WALL_REACH, archAt, halfWidths, bandOutline } from "./model.mjs";

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

// Line of sight. A point at p (face coordinates) and depth d shows on screen where the face-level point p + d·sh does;
// on its way up the sight line passes p + k·sh at depth d − k. The line is open while it stays inside the channel's
// opening and, below the bridge's top, outside the bridge. So the deepest a point at p can be and still be seen is the
// distance k1 to where the ray p + k·sh leaves the opening, or k2 + top where it first enters the bridge (a point over
// the bridge itself is open only above the bridge's top).
const segsOf = (pts) => pts.map((a, i) => [a, pts[(i + 1) % pts.length]]);
const MOAT_SEGS = segsOf(MOAT.pts);
const BODY_SEGS = segsOf(BODY.pts);
const insidePoly = (p, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i]; const b = pts[j]; if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
// the first k > 0 where p + k·dir crosses one of the segments (Infinity if none); u holds each segment end's offset
// across the ray's direction, so only segments that straddle p's own offset are tested
function firstHit(p, dir, segs, u) {
  let best = Infinity;
  const up = dir[0] * p[1] - dir[1] * p[0];
  for (let i = 0; i < segs.length; i++) {
    const ua = u[i];
    const ub = u[(i + 1) % segs.length];
    if ((ua > up && ub > up) || (ua < up && ub < up)) continue;
    const [a, b] = segs[i];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - p[0];
    const wy = a[1] - p[1];
    const k = (wx * ey - wy * ex) / den;
    if (k <= 1e-9 || k >= best) continue;
    const t = (wx * dir[1] - wy * dir[0]) / den;
    if (t >= 0 && t <= 1) best = k;
  }
  return best;
}
// the offsets across one direction, worked out once per direction
let SIGHT = { key: "", moat: null, body: null };
const offsetsFor = (sh) => {
  const key = `${sh[0]} ${sh[1]}`;
  if (SIGHT.key !== key) SIGHT = { key, moat: MOAT.pts.map((q) => sh[0] * q[1] - sh[1] * q[0]), body: BODY.pts.map((q) => sh[0] * q[1] - sh[1] * q[0]), seen: null };
  return SIGHT;
};
// (inChannel: the caller knows p is in the channel, off the bridge, so the two inside tests can be skipped)
export function sightDepth(p, sh, inChannel = false) {
  if (!inChannel && !insidePoly(p, MOAT.pts)) return 0;
  if (!inChannel && insidePoly(p, BODY.pts)) return BRIDGE.top;
  const o = offsetsFor(sh);
  return Math.min(firstHit(p, sh, MOAT_SEGS, o.moat), firstHit(p, sh, BODY_SEGS, o.body) + BRIDGE.top);
}

// which walls the finishing passes have reached: each edge of the outline belongs to the buccal pass (the buccal side and
// the right-hand end) or the palatal pass (the palatal side and the left-hand end)
const finishedEdge = (i, done) => (done[WALL_REACH.pass[i]] ?? 0) >= WALL_REACH.at[i] - 1e-9;

// Everything that moves with the view and the job. sh: depth shift per mm (disc frame); done: the passes' progress;
// lit(n): whether a wall with outward normal n faces the light.
export function workShapes(sh, done, lit) {
  const facing = (poly, sign = 1) => (i) => sign * (poly.n[i][0] * sh[0] + poly.n[i][1] * sh[1]) > 1e-6;
  const bodyFacing = facing(BODY);
  // how deep each facing wall's corner can be seen (from just outside the wall, where its sight line starts)
  const cache = offsetsFor(sh);
  if (!cache.seen) {
    cache.seen = BODY.pts.map((p, i) => (bodyFacing(i) || bodyFacing((i + BODY.pts.length - 1) % BODY.pts.length) ? Math.max(BRIDGE.top, Math.min(BRIDGE.base, sightDepth(add(p, sh, 0.03), sh, true))) : BRIDGE.top));
    cache.moatSeen = MOAT.pts.map((p) => sightDepth(add(p, sh, 0.03), sh, true));
    cache.conn = CONN.map((c) => { const [a, b, e, f] = c.quad; const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2]; return [mid(mid(a, b), mid(e, f)), mid(a, f), mid(b, e)].some((p) => sightDepth(p, sh, true) > c.depth[0]); });
  }
  const seen = cache.seen;
  const body = { roughLit: "", roughShade: "", finLit: "", finShade: "" };
  const n = BODY.pts.length;
  for (let i = 0; i < n; i++) {
    if (!bodyFacing(i)) continue;
    const j = (i + 1) % n;
    if (seen[i] <= BRIDGE.top + 1e-6 && seen[j] <= BRIDGE.top + 1e-6) continue;
    const p = BODY.pts[i];
    const q = BODY.pts[j];
    const quad = [add(p, sh, BRIDGE.top), add(q, sh, BRIDGE.top), add(q, sh, seen[j]), add(p, sh, seen[i])];
    if (signedArea(quad) < 0) quad.reverse();
    body[`${finishedEdge(i, done) ? "fin" : "rough"}${lit(BODY.n[i]) ? "Lit" : "Shade"}`] += ring(quad);
  }
  const roughFacing = (i) => bodyFacing(i) && !finishedEdge(i, done);
  const bodySteps = STEP_DEPTHS.map((d) => runs(BODY, d, sh, (i) => roughFacing(i) && d < Math.min(seen[i], seen[(i + 1) % n]))).join("");
  // the channel's far walls, swept all the way down: anything deeper seen inside the opening lies behind one of them,
  // so painting them over the void keeps the far side of the horseshoe from showing through; their roughing steps only
  // as deep as each can be seen
  const moatFar = facing(MOAT, -1);
  const moatWalls = sides(MOAT, 0, THROUGH, sh, moatFar);
  const moatSeen = cache.moatSeen;
  const moatSteps = MOAT_STEPS.map((d) => runs(MOAT, d, sh, (i) => moatFar(i) && d < Math.min(moatSeen[i], moatSeen[(i + 1) % MOAT.pts.length]))).join("");
  // connectors: those on walls facing away sit behind the bridge, the rest in front of it
  const conn = { farTop: "", farSide: "", nearTop: "", nearSide: "" };
  // only connectors whose top face can be seen (its middle or either end, at the connector's depth)
  for (const [ci, c] of CONN.entries()) {
    if (!cache.conn[ci]) continue;
    const out = archAt(c.s).n;
    const toward = c.wall * (out[0] * sh[0] + out[1] * sh[1]) > 0;
    const k = toward ? "near" : "far";
    conn[`${k}Top`] += ring(c.quad.map((p) => add(p, sh, c.depth[0])));
    conn[`${k}Side`] += sides({ pts: c.quad, n: c.n }, c.depth[0], c.depth[1], sh, (i) => c.n[i][0] * sh[0] + c.n[i][1] * sh[1] > 1e-6);
  }
  return {
    floor: `translate(${n2(sh[0] * THROUGH)} ${n2(sh[1] * THROUGH)})`,
    top: `translate(${n2(sh[0] * BRIDGE.top)} ${n2(sh[1] * BRIDGE.top)})`,
    moatWalls,
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
    P("moatWalls", "tr-moat", w.moatWalls) +
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
    `<path class="tr-hole" d="${CHANNELS.map((c) => { const k = (BRIDGE.base - BRIDGE.top) / c.axis[2]; return circleAt([c.p[0] - k * c.axis[0], c.p[1] - k * c.axis[1]], BRIDGE.channel / 2 + 0.6, 18); }).join("")}"/>` +
    `<path class="iso-line" data-tone="mid" d="${ring(flipped(BODY.pts))}"/>` +
    `<path class="iso-line" data-tone="lit" d="${circleAt([0, 0], 49.25, 96)}"/>` +
    `</g>`
  );
}
