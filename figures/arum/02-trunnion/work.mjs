// The milled disc on the holder's face B: the bridge standing in its roughed channel, drawn in the face's own plane. A
// plane can only carry flat markup, so depth is drawn as the 2.5D trick for prisms seen from above: everything at depth
// d is the same outline moved by d·sh, where sh is how far one millimetre down moves a point across the face on screen
// (live.js reads it from the two face planes each frame). Pure: path strings only, no DOM.
import { GEO, BRIDGE, OUTLINE, OPENING, TEETH, CHANNELS, CONNECTORS, ARCH_L, OCC_SPAN, WALL_REACH, archAt, halfWidths, bandOutline } from "./model.mjs";

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
// the offsets across one direction, worked out once per direction and kept for the last few (the main view, the part
// view and the bur's clip all ask in the same frame); the one used longest ago goes first
const SIGHTS = new Map();
const offsetsFor = (sh) => {
  const key = `${sh[0]} ${sh[1]}`;
  let S = SIGHTS.get(key);
  if (S) SIGHTS.delete(key);
  else {
    if (SIGHTS.size >= 4) SIGHTS.delete(SIGHTS.keys().next().value);
    S = { moat: MOAT.pts.map((q) => sh[0] * q[1] - sh[1] * q[0]), body: BODY.pts.map((q) => sh[0] * q[1] - sh[1] * q[0]), seen: null };
  }
  SIGHTS.set(key, S);
  return S;
};
// (inChannel: the caller knows p is in the channel, off the bridge, so the two inside tests can be skipped)
export function sightDepth(p, sh, inChannel = false) {
  if (!inChannel && !insidePoly(p, MOAT.pts)) return 0;
  if (!inChannel && insidePoly(p, BODY.pts)) return BRIDGE.top;
  const o = offsetsFor(sh);
  return Math.min(firstHit(p, sh, MOAT_SEGS, o.moat), firstHit(p, sh, BODY_SEGS, o.body) + BRIDGE.top);
}

// The bur (tip p, axis t, holder frame) goes into the channel through face B: from the face down it shows only as far as
// its sight line stays in the channel. Its cut: the depth below face B where it goes out of sight, and the point on its
// axis there; null when nothing of it is hidden (above the face, turned away, in the open over the magazine or off the
// disc's edge, or in sight all the way to its tip).
export function burCut(p, t, sh) {
  const tipDepth = GEO.THICK - p[2];
  if (tipDepth <= 0 || !sh || t[2] < 0.2) return null;
  const at = (e) => { const k = (GEO.THICK - e - p[2]) / t[2]; return [p[0] + k * t[0], p[1] + k * t[1]]; };
  if (sightDepth(at(0), sh) <= 0) return null;
  for (let e = 0.05; e < tipDepth; e += 0.1) {
    if (e >= sightDepth(at(e), sh)) { const cut = Math.max(0, e - 0.05); return { cut, at: at(cut) }; }
  }
  return null;
}

// Connectors, row by row. Each is a small prism across the channel that runs 0.4 into the bridge and 0.4 into the disc.
// Its top face and its two long sides are cut into thin rows, and along each row the stretch that can be seen is worked
// out exactly: the part out in the channel (fixed), less every stretch whose sight line crosses the opening's edge on
// its way up, or the bridge's edge while it is still below the bridge's top.
const cross2 = (u, v) => u[0] * v[1] - u[1] * v[0];
const sub = (u, v) => [u[0] - v[0], u[1] - v[1]];
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
// the stretches of the line a→b (as fractions of it) that lie in the channel: inside the opening, outside the bridge
function channelRuns(a, b) {
  const w = sub(b, a);
  const us = [0, 1];
  for (const segs of [MOAT_SEGS, BODY_SEGS]) {
    for (const [e0, e1] of segs) {
      const ev = sub(e1, e0);
      const den = cross2(w, ev);
      if (Math.abs(den) < 1e-12) continue;
      const d = sub(e0, a);
      const u = cross2(d, ev) / den;
      const t = cross2(d, w) / den;
      if (u > 0 && u < 1 && t >= 0 && t <= 1) us.push(u);
    }
  }
  us.sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i + 1 < us.length; i++) {
    if (us[i + 1] - us[i] < 1e-9) continue;
    const m = lerp(a, b, (us[i] + us[i + 1]) / 2);
    if (!insidePoly(m, MOAT.pts) || insidePoly(m, BODY.pts)) continue;
    if (out.length && us[i] - out[out.length - 1][1] < 1e-9) out[out.length - 1][1] = us[i + 1];
    else out.push([us[i], us[i + 1]]);
  }
  return out;
}
const CONN_ROWS = 12;
const SIDE_ROWS = 6;
// a connector's quad runs a (bridge side) → b (disc side) along one long edge and e → f back along the other; rows run
// parallel to a→b at fractions v of the way from a to f (the long sides are the rows at v = 0 and v = 1)
const CONN_PARTS = CONN.map((c) => {
  const [a, b, e, f] = c.quad;
  const row = (v) => [lerp(a, f, v), lerp(b, e, v)];
  const top = Array.from({ length: CONN_ROWS }, (_, j) => ({ v: (j + 0.5) / CONN_ROWS, runs: channelRuns(...row((j + 0.5) / CONN_ROWS)), lo: row(j / CONN_ROWS), hi: row((j + 1) / CONN_ROWS) }));
  const long = [{ s: 0, v: 0 }, { s: 2, v: 1 }].map((x) => ({ ...x, line: row(x.v), runs: channelRuns(...row(x.v)) }));
  return { top, long };
});
// runs less the union of the cut intervals
function minus(runs, cut) {
  cut.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [r0, r1] of runs) {
    let u = r0;
    for (const [c0, c1] of cut) {
      if (c1 <= u) continue;
      if (c0 >= r1) break;
      if (c0 > u) out.push([u, c0]);
      u = Math.max(u, c1);
      if (u >= r1) break;
    }
    if (u < r1) out.push([u, r1]);
  }
  return out.filter(([u0, u1]) => u1 - u0 > 1e-4);
}
// fallback for a sight line running along the rows: sample each row, then pin each change down
function sampledRuns(A, B, runs, d, sh) {
  const open = (u) => sightDepth(lerp(A, B, u), sh, true) > d;
  const out = [];
  for (const [r0, r1] of runs) {
    const N = 24;
    let prev = open(r0);
    let start = prev ? r0 : null;
    for (let i = 1; i <= N; i++) {
      const u = r0 + ((r1 - r0) * i) / N;
      const now = open(Math.min(u, r1 - 1e-9));
      if (now === prev) continue;
      let lo = r0 + ((r1 - r0) * (i - 1)) / N;
      let hi = u;
      for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (open(m) === prev) lo = m; else hi = m; }
      if (now) start = hi;
      else { out.push([start, lo]); start = null; }
      prev = now;
    }
    if (start !== null) out.push([start, r1]);
  }
  return out;
}
// The seen parts of every connector for one view: top faces and the long sides facing the viewer, painted over the
// bridge's walls (what the bridge hides of them is already cut away here). A sight line from the row at v, at the point a
// fraction u along it, passes that point + k·sh; in a connector's own (u, k) frame every edge of the opening and the
// bridge is a segment, and the part of it within the blocking range of k casts its u-range as cut off.
function connectorsSeen(sh) {
  const conn = { top: "", side: "" };
  for (const [ci, c] of CONN.entries()) {
    const part = CONN_PARTS[ci];
    const [a, b, , f] = c.quad;
    const w = sub(b, a);
    const fv = sub(f, a);
    const det = cross2(w, sh);
    const along = Math.abs(det) < 1e-9 * (Math.hypot(w[0], w[1]) * Math.hypot(sh[0], sh[1]) + 1e-12);
    // moving to the row at v shifts every edge by −v·du in u and −v·dk in k
    const du = along ? 0 : cross2(fv, sh) / det;
    const dk = along ? 0 : cross2(w, fv) / det;
    const frame = (segs, kmax) => {
      const out = [];
      if (along || kmax <= 0) return out;
      for (const [e0, e1] of segs) {
        const r0 = sub(e0, a);
        const r1 = sub(e1, a);
        const u0 = cross2(r0, sh) / det;
        const u1 = cross2(r1, sh) / det;
        const k0 = cross2(w, r0) / det;
        const k1 = cross2(w, r1) / det;
        if (Math.max(u0, u1) - Math.min(0, du) < 0 || Math.min(u0, u1) - Math.max(0, du) > 1) continue;
        if (Math.max(k0, k1) - Math.min(0, dk) < 0 || Math.min(k0, k1) - Math.max(0, dk) > kmax) continue;
        out.push([u0, k0, u1, k1]);
      }
      return out;
    };
    const moat = frame(MOAT_SEGS, c.depth[1]);
    const body = frame(BODY_SEGS, c.depth[1] - BRIDGE.top);
    const seenAt = (v, line, runs, d) => {
      if (!runs.length) return runs;
      if (along) return sampledRuns(line[0], line[1], runs, d, sh);
      const cut = [];
      const cast = (list, hi) => {
        if (hi <= 0) return;
        const su = v * du;
        const sk = v * dk;
        for (const [u0, k0, u1, k1] of list) {
          const ka = k0 - sk;
          const kb = k1 - sk;
          let t0 = 0;
          let t1 = 1;
          if (Math.abs(kb - ka) < 1e-12) { if (ka < 0 || ka > hi) continue; }
          else {
            const ta = -ka / (kb - ka);
            const tb = (hi - ka) / (kb - ka);
            t0 = Math.max(0, Math.min(ta, tb));
            t1 = Math.min(1, Math.max(ta, tb));
            if (t0 > t1) continue;
          }
          const ua = u0 + (u1 - u0) * t0 - su;
          const ub = u0 + (u1 - u0) * t1 - su;
          cut.push(ua < ub ? [ua, ub] : [ub, ua]);
        }
      };
      cast(moat, d);
      cast(body, d - BRIDGE.top);
      return minus(runs, cut);
    };
    for (const row of part.top) {
      for (const [u0, u1] of seenAt(row.v, [lerp(row.lo[0], row.hi[0], 0.5), lerp(row.lo[1], row.hi[1], 0.5)], row.runs, c.depth[0])) {
        const q = [lerp(row.lo[0], row.lo[1], u0), lerp(row.lo[0], row.lo[1], u1), lerp(row.hi[0], row.hi[1], u1), lerp(row.hi[0], row.hi[1], u0)].map((p) => add(p, sh, c.depth[0]));
        if (signedArea(q) < 0) q.reverse();
        conn.top += ring(q);
      }
    }
    for (const side of part.long) {
      if (!(c.n[side.s][0] * sh[0] + c.n[side.s][1] * sh[1] > 1e-6)) continue;
      const [A, B] = side.line;
      for (let j = 0; j < SIDE_ROWS; j++) {
        const d0 = c.depth[0] + ((c.depth[1] - c.depth[0]) * j) / SIDE_ROWS;
        const d1 = c.depth[0] + ((c.depth[1] - c.depth[0]) * (j + 1)) / SIDE_ROWS;
        for (const [u0, u1] of seenAt(side.v, side.line, side.runs, (d0 + d1) / 2)) {
          const q = [add(lerp(A, B, u0), sh, d0), add(lerp(A, B, u1), sh, d0), add(lerp(A, B, u1), sh, d1), add(lerp(A, B, u0), sh, d1)];
          if (signedArea(q) < 0) q.reverse();
          conn.side += ring(q);
        }
      }
    }
  }
  return conn;
}

// which walls the finishing passes have reached: each edge of the outline belongs to the buccal pass (the buccal side and
// the right-hand end) or the palatal pass (the palatal side and the left-hand end)
const finishedEdge = (i, done) => (done[WALL_REACH.pass[i]] ?? 0) >= WALL_REACH.at[i] - 1e-9;

// Everything that moves with the view and the job. sh: depth shift per mm (disc frame); done: the passes' progress;
// lit(n): whether a wall with outward normal n faces the light.
export function workShapes(sh, done, lit) {
  const facing = (poly, sign = 1) => (i) => sign * (poly.n[i][0] * sh[0] + poly.n[i][1] * sh[1]) > 1e-6;
  const bodyFacing = facing(BODY);
  // how deep each facing wall's corner can be seen: measured from a step up its sight line (clear of the wall the line
  // starts on), plus that step
  const cache = offsetsFor(sh);
  const fromCorner = (p) => sightDepth(add(p, sh, 0.03), sh, true) + 0.03;
  if (!cache.seen) {
    cache.seen = BODY.pts.map((p, i) => (bodyFacing(i) || bodyFacing((i + BODY.pts.length - 1) % BODY.pts.length) ? Math.max(BRIDGE.top, Math.min(BRIDGE.base, fromCorner(p))) : BRIDGE.top));
    cache.moatSeen = MOAT.pts.map(fromCorner);
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
  // the channel's far walls, swept all the way down: the floor seen inside the opening lies behind one of them, so
  // painting them over the void keeps it from showing through; their roughing steps only as deep as each can be seen
  // (the bridge's walls and the connectors carry their own line of sight)
  const moatFar = facing(MOAT, -1);
  const moatWalls = sides(MOAT, 0, THROUGH, sh, moatFar);
  const moatSeen = cache.moatSeen;
  const moatSteps = MOAT_STEPS.map((d) => runs(MOAT, d, sh, (i) => moatFar(i) && d < Math.min(moatSeen[i], moatSeen[(i + 1) % MOAT.pts.length]))).join("");
  return {
    floor: `translate(${n2(sh[0] * THROUGH)} ${n2(sh[1] * THROUGH)})`,
    top: `translate(${n2(sh[0] * BRIDGE.top)} ${n2(sh[1] * BRIDGE.top)})`,
    moatWalls,
    moatSteps,
    body,
    bodySteps,
    // the connectors only when asked for (the part view has none)
    get conn() { return (cache.conn ??= connectorsSeen(sh)); },
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
    P("roughShade", "tr-wall tr-rough", w.body.roughShade) +
    P("roughLit", "tr-wall tr-rough", w.body.roughLit, ' data-lit=""') +
    P("finShade", "tr-wall tr-fin", w.body.finShade) +
    P("finLit", "tr-wall tr-fin", w.body.finLit, ' data-lit=""') +
    P("bodySteps", "iso-line", w.bodySteps, ' data-tone="faint" data-free="both"') +
    P("connSide", "tr-conn-side", w.conn.side) +
    P("connTop", "tr-conn", w.conn.top) +
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
