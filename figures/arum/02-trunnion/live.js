const TR = __DATA__;
const follow = null;
const trStage = document.querySelector(".tr-stage");
const trReadout = document.querySelector("[data-readout]");
const trButtons = [...document.querySelectorAll(".tr-axis[data-axis]")];
const trTourButton = document.querySelector(".tr-tour");
const trValues = Object.fromEntries([...document.querySelectorAll("[data-value]")].map((el) => [el.dataset.value, el]));
const trStill = matchMedia("(prefers-reduced-motion: reduce)");
const trClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const trSmooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const trHalfTurn = (v) => { const w = wrap(v); return w <= -179.95 ? 180 : w; };
// each axis: its key in the state, its name, its ends and steps, and how it reads: Z is shown negative (down from the top)
const TR_AXES = {
  X: { key: "x", name: "cradle in and out", lo: 0, hi: TRAVEL.x, step: 5, big: 25, unit: "millimetres", sign: 1 },
  Y: { key: "y", name: "spindle left and right", lo: 0, hi: TRAVEL.y, step: 5, big: 25, unit: "millimetres", sign: 1 },
  Z: { key: "z", name: "spindle up and down", lo: 0, hi: TRAVEL.z, step: 5, big: 25, unit: "millimetres", sign: -1 },
  A: { key: "a", name: "holder turns", lo: -180, hi: 180, step: 5, big: 45, unit: "degrees", sign: 1 },
  B: { key: "b", name: "cradle tilts", lo: -SPEC.bLimit, hi: SPEC.bLimit, step: 1, big: 5, unit: "degrees", sign: 1 },
};
const trHome = () => ({ x: HOME.x, y: HOME.y, z: HOME.z, a: HOME.a, b: HOME.b });
// cur: what is drawn; want: what the reader asked for; m: the magazine sequence (0 out … 1 in, flap shut).
// stopped: the reader has taken over, so the tour waits for the Tour button.
const trState = { cur: { ...trHome(), m: 1 }, want: trHome(), mWant: 1, axis: "Y", touring: false, stopped: false, clock: 0, resumeAt: 0, blend: null, focused: false, dragging: null, pending: null, held: false, step: null };
let trFrame = 0, trLast = 0, trVisible = false, trIdle = 0, trEma = 0, trSkip = false, trHalf = false;
// true while the page itself draws, so onFrame does not echo it back; it starts true so the engine's first render at
// mount (at the build's rest pose) does not overwrite home
let trOwn = true;

// how far down the head may come in a state (−1: it would not fit even at the top)
const trRoom = (s, m = trState.cur.m) => zLimit({ x: s.x, b: s.b, a: s.a, mag: magOf(m).mag }, s.y);
// the magazine comes out while the spindle is over it, and goes back in when it leaves
const trMagFor = (y) => (y < 110 ? 0 : 1);
const trFits = (s) => trRoom(s, 0) >= 0 && trRoom(s, 1) >= 0;

const trController = TURN.mount(trStage, TR.turn, {
  follow,
  // a verification tool that sets a pose through window.__isoTurn holds the figure; the controls follow that pose
  onHold: () => { trState.touring = false; trState.held = true; clearTimeout(trIdle); trIdle = 0; },
  onFrame: (controller) => {
    if (trOwn) return;
    const v = controller.values ?? {};
    const m = typeof v.m === "number" ? v.m : (v.flap ?? 0) > 0 ? 0.72 + (0.28 * v.flap) / 90 : (0.72 * (v.mag ?? 0)) / GEO.MAG_STROKE;
    trState.cur = { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0, a: wrap(v.a ?? 0), b: v.b ?? 0, m };
    trState.want = { x: trState.cur.x, y: trState.cur.y, z: trState.cur.z, a: trState.cur.a, b: trState.cur.b };
    trState.mWant = trMagFor(trState.cur.y);
    trShow();
    trDescribe();
  },
});

function trShow() {
  const v = axesOf(trState.cur);
  for (const key of Object.keys(trValues)) if (trValues[key].textContent !== v[key]) trValues[key].textContent = v[key];
  const step = trState.touring ? trState.step : null;
  const ax = TR_AXES[trState.axis];
  const text = step ? step.say || readoutOf(trState.cur) : `${trState.axis} · ${ax.name} · ${v[trState.axis]}${ax.unit === "millimetres" ? " mm" : ""}`;
  if (trReadout.textContent !== text) trReadout.textContent = text;
  const moving = step ? step.axis : null;
  for (const btn of trButtons) {
    const on = moving === "all" || moving === btn.dataset.axis;
    if (btn.hasAttribute("data-moving") !== on) btn.toggleAttribute("data-moving", on);
  }
  // the button reads as playing while the tour runs or is about to start on its own
  const playing = String(trState.touring || trIdle !== 0);
  if (trTourButton.getAttribute("aria-pressed") !== playing) trTourButton.setAttribute("aria-pressed", playing);
}
// the slider names the chosen axis and reports its value as the readout shows it; the instructions live in the
// stage's description, so they are not read again on every change
const trValueOf = (axis, s) => {
  const ax = TR_AXES[axis];
  const v = s[ax.key];
  return ax.key === "a" ? trHalfTurn(v) : ax.sign * v;
};
const trWords = (axis, s) => {
  const ax = TR_AXES[axis];
  const n = Math.round(trValueOf(axis, s) * 10) / 10 || 0;
  const rest = {
    X: Math.abs(s.x - HOME.x) < 0.05 ? "disc centre under the spindle" : s.x < HOME.x ? "cradle toward the back" : "cradle toward the operator",
    Y: s.y < 110 ? "spindle over the magazine" : Math.abs(s.y - HOME.y) < 0.05 ? "spindle over the disc centre" : "spindle over the work",
    Z: s.z < 0.05 ? "head at the top" : "head down",
    A: "holder turned",
    B: "cradle tilted",
  }[axis];
  return `${axis} ${n} ${ax.unit}, ${rest}`;
};
function trDescribe() {
  const ax = TR_AXES[trState.axis];
  const set = (name, val) => { if (trStage.getAttribute(name) !== val) trStage.setAttribute(name, val); };
  set("aria-label", `${trState.axis} axis, ${ax.name}`);
  set("aria-valuemin", String(ax.sign < 0 ? -ax.hi : ax.lo));
  set("aria-valuemax", String(ax.sign < 0 ? -ax.lo : ax.hi));
  set("aria-valuenow", String(Math.round(trValueOf(trState.axis, trState.want) * 10) / 10 || 0));
  set("aria-valuetext", trWords(trState.axis, trState.want));
  for (const btn of trButtons) {
    const on = btn.dataset.axis === trState.axis;
    if ((btn.getAttribute("aria-pressed") === "true") !== on) btn.setAttribute("aria-pressed", String(on));
  }
}

function trDraw() {
  if (trState.held) return;
  trOwn = true;
  const c = trState.cur;
  // page values; the controller applies follow() to turn the magazine sequence into the magazine and flap groups
  const stats = trController.set({ x: c.x, y: c.y, z: c.z, a: c.a, b: c.b, m: c.m });
  trOwn = false;
  if (stats && typeof stats.ms === "number") trEma = trEma ? trEma * 0.9 + stats.ms * 0.1 : stats.ms;
  trShow();
}

// ask for a new value on one axis: the head must fit at that state at least at the top, so back off toward the current
// request when it would not; Z never asks for deeper than the state allows
function trRequest(axis, value) {
  const ax = TR_AXES[axis];
  const from = trState.want[ax.key];
  let to = ax.key === "a" ? value : trClamp(value, ax.lo, ax.hi);
  const test = (v) => trFits({ ...trState.want, [ax.key]: v });
  if (ax.key !== "z" && !test(to)) {
    let ok = from;
    let bad = to;
    for (let i = 0; i < 12; i++) { const mid = (ok + bad) / 2; if (test(mid)) ok = mid; else bad = mid; }
    to = ok;
  }
  const next = { ...trState.want, [ax.key]: to };
  next.z = trClamp(next.z, 0, Math.max(0, Math.min(trRoom(next, 0), trRoom(next, 1))));
  trState.want = next;
  trState.mWant = trMagFor(next.y);
}

// the tour: it plays on its own at first; once the reader takes over it waits for the Tour button, and resumes from the
// start of the step it left, after a blend from wherever the reader left the machine
// with reduced motion the tour never starts on its own, but the Tour button still plays it
function trStartTour(asked = false) {
  trIdle = 0;
  if ((trStill.matches && !asked) || trState.focused || trState.dragging || trState.held || trState.stopped) return;
  trState.clock = tourStepStart(trState.resumeAt);
  trState.blend = { from: { ...trState.cur }, t: 0 };
  trState.touring = true;
  trShow();
  trRun();
}
function trArmResume(delay = 3600) {
  clearTimeout(trIdle);
  trIdle = 0;
  if (trStill.matches || trState.focused || trState.dragging || trState.held || trState.stopped) return;
  trIdle = setTimeout(trStartTour, delay);
  trShow();
}
function trStopTour({ sticky = true } = {}) {
  trState.held = false;
  if (sticky) trState.stopped = true;
  if (trState.touring) {
    trState.touring = false;
    trState.blend = null;
    trState.resumeAt = trState.clock;
    const c = trState.cur;
    trState.want = { x: c.x, y: c.y, z: c.z, a: c.a, b: c.b };
    trState.mWant = trMagFor(c.y);
  }
  clearTimeout(trIdle);
  trIdle = 0;
  trShow();
}

function trTick(now) {
  const dt = trLast ? Math.min((now - trLast) / 1000, 1 / 30) : 1 / 60;
  trLast = now;
  const calm = trStill.matches;
  const c = trState.cur;
  let next;
  let changed = false;
  if (trState.touring) {
    // the tour's clock starts once the blend into it is done
    if (!trState.blend) trState.clock += dt;
    const p = tourAt(trState.clock);
    // during the blend the readout tracks all five axes rather than the first step's line
    trState.step = trState.blend ? { ...p, say: "", axis: "all" } : p;
    if (trState.blend) {
      // 0.8 s to level B and lift Z, then 1.2 s to blend the rest into the tour
      const bl = trState.blend;
      bl.t += dt;
      const f = bl.from;
      const k1 = trSmooth(bl.t / 0.8);
      const k2 = trSmooth((bl.t - 0.8) / 1.2);
      const lerp = (u, v, k) => u + (v - u) * k;
      const mid = { x: f.x, y: f.y, z: lerp(f.z, 0, k1), a: f.a, b: lerp(f.b, 0, k1), m: f.m };
      next = { x: lerp(mid.x, p.x, k2), y: lerp(mid.y, p.y, k2), z: lerp(mid.z, p.z, k2), a: wrap(mid.a + wrap(p.a - mid.a) * k2), b: lerp(mid.b, p.b, k2), m: lerp(mid.m, p.m, k2) };
      if (bl.t >= 2) trState.blend = null;
    } else next = { x: p.x, y: p.y, z: p.z, a: p.a, b: p.b, m: p.m };
  } else {
    trState.step = null;
    const k = calm ? 1 : 1 - Math.exp(-dt / 0.18);
    const w = trState.want;
    next = { x: c.x + (w.x - c.x) * k, y: c.y + (w.y - c.y) * k, z: c.z + (w.z - c.z) * k, a: wrap(c.a + wrap(w.a - c.a) * k), b: c.b + (w.b - c.b) * k, m: c.m };
    for (const key of ["x", "y", "z", "b"]) if (Math.abs(w[key] - next[key]) < 0.01) next[key] = w[key];
    if (Math.abs(wrap(w.a - next.a)) < 0.01) next.a = w.a;
    // the magazine runs its sequence at the tour's pace, and only comes out once the head is clear of its path
    if (next.m !== trState.mWant) {
      const step = calm ? 1 : dt / 2.2;
      const m2 = trState.mWant < next.m ? Math.max(trState.mWant, next.m - step) : Math.min(trState.mWant, next.m + step);
      if (trRoom(next, m2) >= next.z) next.m = m2;
      else { trState.want.z = Math.min(trState.want.z, Math.max(0, trRoom(next, m2))); changed = true; }
    }
  }
  // never draw the head inside anything: lift the drawn head when the state needs it (the request stands, so the head
  // comes back down to it once there is room), and stop when even the top is not clear
  const room = trRoom(next, next.m);
  if (room < 0 && !trState.touring) {
    trState.want = { x: c.x, y: c.y, z: c.z, a: c.a, b: c.b };
    next = { ...c };
    changed = true;
  } else if (next.z > room) next.z = Math.max(0, room);
  trState.cur = next;
  // half rate on slow devices: alternate frames once renders average over 14 ms, every frame again under 9 ms
  if (trEma > 14) trHalf = true;
  else if (trEma < 9) trHalf = false;
  trSkip = trHalf ? !trSkip : false;
  const w = trState.want;
  const settled = !trState.touring && next.x === w.x && next.y === w.y && Math.abs(next.z - Math.min(w.z, Math.max(0, room))) < 0.01 && next.a === w.a && next.b === w.b && next.m === trState.mWant;
  if (!trSkip || settled) trDraw();
  if (changed || settled) trDescribe();
  trFrame = trVisible && (trState.touring || !settled) ? requestAnimationFrame(trTick) : 0;
}
const trRun = () => { if (!trFrame && trVisible) { trLast = 0; trFrame = requestAnimationFrame(trTick); } };

function trSelect(axis) {
  if (!TR_AXES[axis]) return;
  trState.axis = axis;
  trDescribe();
  trShow();
}
// jog the chosen axis by `delta` in its displayed sense (up and right raise the value, as on any slider)
function trJog(axis, delta) {
  trStopTour();
  trSelect(axis);
  const ax = TR_AXES[axis];
  trRequest(axis, trState.want[ax.key] + ax.sign * delta);
  trDescribe();
  trRun();
}
// Home and End go to the low and high ends of the value as shown (for Z the low end is the deepest)
function trSetEnd(axis, high) {
  trStopTour();
  const ax = TR_AXES[axis];
  trRequest(axis, high !== ax.sign < 0 ? ax.hi : ax.lo);
  trDescribe();
  trRun();
}

new IntersectionObserver((entries) => { trVisible = entries[entries.length - 1].isIntersecting; if (trVisible) trRun(); }, { rootMargin: "120px 0px" }).observe(trStage);

// the axis buttons choose what a drag or the arrow keys move; choosing one takes over from the tour
for (const btn of trButtons) btn.addEventListener("click", () => { trStopTour(); trSelect(btn.dataset.axis); });
trTourButton.addEventListener("click", () => {
  if (trState.touring) { trStopTour(); return; }
  trState.stopped = false;
  trState.held = false;
  trStartTour(true);
});

// drag: Y and A follow the pointer sideways; X, Z and B follow a mouse up and down (down brings the cradle forward,
// lowers the head and tilts B negative). A touch drag works sideways only, and only once it is clearly sideways, so a
// page scroll that starts on the figure scrolls and leaves the tour alone.
const TR_DRAG = { X: ["y", 220], Y: ["x", 400], Z: ["y", 200], A: ["x", 360], B: ["y", -90] };
function trBegin(event) {
  trStopTour();
  const ax = TR_AXES[trState.axis];
  trState.dragging = { id: event.pointerId, touch: event.pointerType === "touch", x: event.clientX, y: event.clientY, start: trState.want[ax.key] };
  trStage.setAttribute("data-drag", "");
  trStage.setPointerCapture?.(event.pointerId);
}
function trRelease(event) {
  if (trState.pending && event.pointerId === trState.pending.id) trState.pending = null;
  const d = trState.dragging;
  if (!d || event.pointerId !== d.id) return;
  trState.dragging = null;
  trStage.removeAttribute("data-drag");
  if (trStage.hasPointerCapture?.(event.pointerId)) trStage.releasePointerCapture(event.pointerId);
  trDescribe();
}
trStage.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || trState.dragging) return;
  if (event.pointerType === "touch") { trState.pending = { id: event.pointerId, x: event.clientX, y: event.clientY }; return; }
  if (event.button !== 0) return;
  trBegin(event);
});
trStage.addEventListener("pointermove", (event) => {
  const p = trState.pending;
  if (p && event.pointerId === p.id) {
    const dx = event.clientX - p.x;
    const dy = event.clientY - p.y;
    if (Math.abs(dx) >= 8 && Math.abs(dx) > Math.abs(dy)) {
      trState.pending = null;
      trBegin(event);
    } else if (Math.abs(dy) >= 8) trState.pending = null;
    return;
  }
  const d = trState.dragging;
  if (!d || event.pointerId !== d.id) return;
  if (event.pointerType === "mouse" && event.buttons === 0) { trRelease(event); return; }
  const box = trStage.getBoundingClientRect();
  const [dir, span] = TR_DRAG[trState.axis];
  const ax = TR_AXES[trState.axis];
  // a sideways touch drag raises the value to the right, like the right arrow
  const along = d.touch ? ((event.clientX - d.x) / box.width) * Math.abs(span) * ax.sign : dir === "x" ? ((event.clientX - d.x) / box.width) * span : ((event.clientY - d.y) / box.height) * span;
  trRequest(trState.axis, d.start + along);
  trRun();
});
trStage.addEventListener("pointerup", trRelease);
trStage.addEventListener("pointercancel", trRelease);
trStage.addEventListener("lostpointercapture", trRelease);
trStage.addEventListener("contextmenu", () => { if (trState.dragging) trRelease({ pointerId: trState.dragging.id }); });
// keyboard focus (not a mouse press) pauses the tour while the stage has it
trStage.addEventListener("focus", () => {
  trState.focused = trStage.matches(":focus-visible");
  if (!trState.focused) return;
  trStopTour({ sticky: false });
  trDescribe();
  trRun();
});
trStage.addEventListener("blur", () => { trState.focused = false; trArmResume(); });
trStage.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const letter = event.key.length === 1 ? event.key.toUpperCase() : "";
  if (TR_AXES[letter]) {
    trStopTour();
    trSelect(letter);
    event.preventDefault();
    return;
  }
  const ax = TR_AXES[trState.axis];
  const step = event.shiftKey ? ax.big : ax.step;
  if (event.key === "ArrowUp" || event.key === "ArrowRight") trJog(trState.axis, step);
  else if (event.key === "ArrowDown" || event.key === "ArrowLeft") trJog(trState.axis, -step);
  else if (event.key === "PageUp") trJog(trState.axis, ax.big);
  else if (event.key === "PageDown") trJog(trState.axis, -ax.big);
  else if (event.key === "Home") trSetEnd(trState.axis, false);
  else if (event.key === "End") trSetEnd(trState.axis, true);
  else if (event.key === "0") {
    trStopTour();
    trState.want = trHome();
    trState.mWant = 1;
    trDescribe();
    trRun();
  } else return;
  event.preventDefault();
});
trStill.addEventListener("change", () => { if (trStill.matches) trStopTour({ sticky: false }); else trArmResume(1400); trRun(); });

trArmResume(1400);
trDescribe();
trDraw();
