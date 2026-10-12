// Truth model for Fig 1: scallop (ridge) height left by a ball-end bur.
// Pure, no DOM. Lengths in mm unless a name says otherwise.

// ARUM A3: Ø4 shank, 60,000 rpm max (arumdentistry.com aseries4; ARUM A3 & A3L catalog, Dec 2025).
export const A3 = { shank: 4, rpm: 60000 };

// Ball-end finishing tools shown, and the stepover range each one is drawn over.
// The formula needs s < d (s/2 < r, so the cusp lies on the ball); the ranges stay far below that.
export const TOOLS = {
  1: { d: 1.0, step: [0.05, 0.2] },
  2: { d: 2.0, step: [0.05, 0.3] },
};

export const PATCH = 8; // mm: the side of the square patch the passes cover (drawn on the coupon)

// Height of the ridge left between two passes of a ball of diameter d at stepover s.
export const ridge = (d, s) => {
  const r = d / 2;
  return r - Math.sqrt(r * r - (s / 2) * (s / 2));
};

// One pass at each edge of the patch and one every stepover between: the lines the figure draws.
export const passes = (s) => Math.floor(PATCH / s + 1e-9) + 1;
export const pathLength = (s) => passes(s) * PATCH; // mm of cut over the patch

// Height of the cut surface above the pass bottoms at distance x (mm) from a pass centre.
export const profile = (d, s, x) => {
  const r = d / 2;
  const u = ((x % s) + s) % s;
  const off = Math.min(u, s - u);
  return r - Math.sqrt(r * r - off * off);
};

export const clampStep = (tool, s) => {
  const [lo, hi] = TOOLS[tool].step;
  return Math.min(hi, Math.max(lo, Math.round(s * 100) / 100));
};

const um = (mm) => mm * 1000;
const fmtUm = (mm) => (um(mm) < 1 ? um(mm).toFixed(2) : um(mm).toFixed(1));

export const settledOf = (tool, s) => `ridge ${fmtUm(ridge(TOOLS[tool].d, s))} micrometres, ${passes(s)} passes`;

export const readoutOf = (tool, s) =>
  `Ø${TOOLS[tool].d.toFixed(1)} ball · step ${s.toFixed(2)} mm · ridge ${fmtUm(ridge(TOOLS[tool].d, s))} µm · ${passes(s)} passes`;

export const wordsOf = (tool, s) =>
  `${TOOLS[tool].d.toFixed(1)} millimetre ball, stepover ${s.toFixed(2)} millimetres: ridges ${fmtUm(ridge(TOOLS[tool].d, s))} micrometres high, ${passes(s)} passes over an 8 by 8 millimetre patch`;

// Idle tour: coarse to fine.
export const TOUR = [
  [2, 0.3],
  [2, 0.15],
  [1, 0.1],
  [1, 0.05],
];
