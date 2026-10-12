// Truth model for Fig 2: the ARUM 5X-200's two rotary axes. Pure, no DOM.
// Specs: arumdentistry.com/eng/solution/milling1.php (5X-200): A 360°, B ±30°, 15 tools Ø6 shank,
// DC 3.0 kW / 60,000 rpm spindle, Disk Cartridge (ARUM's term), mounting of 5 pre-milled blanks (P1–P5).
// Ø98.5 mm disc: measured from the dealer's photos; ARUM publishes no disc diameter for the 5X-200.
// Form: from the dealer's photos of a 5X-200 chamber and ARUM's product photos (styling illustrative, not traced).

export const SPEC = { aRange: 360, bLimit: 30, tools: 15, shank: 6, rpm: 60000, kw: 3.0, disc: 98.5, premills: 5 };

// Angled screw channels on implant restorations are commonly offered up to 25–30° from the implant axis.
export const CHANNEL = [25, 30];

export const wrap = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
export const clampB = (deg) => Math.max(-SPEC.bLimit, Math.min(SPEC.bLimit, deg));

// How much of a requested tilt the B axis can give, and what is left over.
export const reach = (want) => {
  const got = clampB(want);
  return { got, short: Math.abs(want) - Math.abs(got) };
};

// round before choosing the sign, so a value settling onto zero never reads −0.0°
const deg = (v) => {
  const r = Math.round(v * 10) / 10 || 0;
  return `${r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}°`;
};
// A reads in (−180°, 180°]: a half turn is 180°, never −180°
const half = (v) => { const w = wrap(v); return w <= -179.95 ? 180 : w; };
export const readoutOf = (a, b) => `A ${deg(half(a))} · B ${deg(b)} of ±${SPEC.bLimit}°`;
export const wordsOf = (a, b) => `Disc turned ${Math.round(half(a))} degrees on A, tilted ${Math.round(b)} degrees on B, of plus or minus ${SPEC.bLimit}`;
