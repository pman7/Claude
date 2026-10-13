const TR = __DATA__;
const follow = null;
const trStage = document.querySelector(".tr-stage");
const trReadout = document.querySelector("[data-readout]");
const trButtons = [...document.querySelectorAll(".tr-axis")];
const trValues = Object.fromEntries([...document.querySelectorAll("[data-value]")].map((el) => [el.dataset.value, el]));
const trStill = matchMedia("(prefers-reduced-motion: reduce)");
const trClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const trSmooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const TR_AXES = {
  X: { key: "x", name: "cradle in and out", lo: 0, hi: TRAVEL.x, step: 5, big: 25, unit: "mm" },
  Y: { key: "y", name: "spindle left and right", lo: 0, hi: TRAVEL.y, step: 5, big: 25, unit: "mm" },
  Z: { key: "z", name: "spindle up and down", lo: 0, hi: TRAVEL.z, step: 5, big: 25, unit: "mm" },
  A: { key: "a", name: "holder turns", lo: -Infinity, hi: Infinity, step: 5, big: 45, unit: "°" },
  B: { key: "b", name: "cradle tilts", lo: -SPEC.bLimit, hi: SPEC.bLimit, step: 1, big: 5, unit: "°" },
};
const trHome = () => ({ x: HOME.x, y: HOME.y, z: HOME.z, a: HOME.a, b: HOME.b });
// cur: what is drawn; want: what the reader asked for; m: the magazine sequence (0 out … 1 in, flap shut)
const trState = { cur: { ...trHome(), m: 1 }, want: trHome(), mWant: 1, axis: "Y", touring: false, clock: 0, blend: null, focused: false, dragging: null, held: false, step: null };
let trFrame = 0, trLast = 0, trVisible = false, trIdle = 0, trOwn = false, trEma = 0, trSkip = false, trHalf = false;

// how far down the head may come in a state (−1: it would not fit even at the top)
const trRoom = (s, m = trState.cur.m) => zLimit({ x: s.x, b: s.b, a: s.a, mag: magOf(m).mag }, s.y);
// the magazine comes out while the spindle is over it, and goes back in when it leaves
const trMagFor = (y) => (y < 110 ? 0 : 1);
const trFits = (s) => trRoom(s, 0) >= 0 && trRoom(s, 1) >= 0;

const trController = TURN.mount(trStage, TR.turn, {
  follow,
  // a verification tool that sets a pose through window.__isoTurn holds the figure; the controls follow that pose
  onHold: () => { trState.touring = false; trState.held = true; clearTimeout(trIdle); },
  onFrame: (controller) => {
    if (trOwn) return;
    const v = controller.values ?? {};
    const m = typeof v.m === "number" ? v.m : (v.flap ?? 0) > 0 ? 0.72 + (0.28 * v.flap) / 90 : (0.72 * (v.mag ?? 0)) / GEO.MAG_STROKE;
    trState.cur = { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0, a: wrap(v.a ?? 0), b: v.b ?? 0, m };
    trState.want = { x: trState.cur.x, y: trState.cur.y, z: trState.cur.z, a: trState.cur.a, b: trState.cur.b };
    trShow();
  },
});

function trShow() {
  const v = axesOf(trState.cur);
  for (const key of Object.keys(trValues)) if (trValues[key].textContent !== v[key]) trValues[key].textContent = v[key];
  const touring = trState.touring && trState.step;
  const ax = TR_AXES[trState.axis];
  const text = touring ? trState.step.say || readoutOf(trState.cur) : `${trState.axis} · ${ax.name} · ${v[trState.axis]}${ax.unit === "mm" ? " mm" : ""}`;
  if (trReadout.textContent !== text) trReadout.textContent = text;
  const moving = touring ? trState.step.axis : null;
  for (const btn of trButtons) {
    const on = moving === "all" || moving === btn.dataset.axis;
    if (btn.hasAttribute("data-moving") !== on) btn.toggleAttribute("data-moving", on);
  }
}
function trDescribe() {
  const ax = TR_AXES[trState.axis];
  const value = trState.want[ax.key];
  const set = (name, val) => { if (trStage.getAttribute(name) !== val) trStage.setAttribute(name, val); };
  set("aria-label", `${trState.axis}: ${ax.name}. Press X, Y, Z, A or B to choose an axis, then the arrow keys to move it (Shift for bigger steps); Home returns every axis home. With a mouse or a finger, choose an axis below and drag across the picture.`);
  set("aria-valuemin", String(Number.isFinite(ax.lo) ? ax.lo : -180));
  set("aria-valuemax", String(Number.isFinite(ax.hi) ? ax.hi : 180));
  set("aria-valuenow", String(Math.round(ax.key === "a" ? wrap(value) : value)));
  set("aria-valuetext", wordsOf(trState.want));
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

function trStartTour() {
  if (trStill.matches || trState.focused || trState.dragging || trState.held) return;
  // join the tour at its start: first bring B level and Z up, then blend into the tour's opening state
  trState.clock = 0;
  trState.blend = { from: { ...trState.cur }, t: 0 };
  trState.touring = true;
  trRun();
}
function trArmResume(delay = 3600) {
  clearTimeout(trIdle);
  if (trStill.matches || trState.focused || trState.dragging || trState.held) return;
  trIdle = setTimeout(trStartTour, delay);
}
function trStopTour() {
  trState.held = false;
  if (trState.touring) {
    trState.touring = false;
    trState.blend = null;
    const c = trState.cur;
    trState.want = { x: c.x, y: c.y, z: c.z, a: c.a, b: c.b };
    trState.mWant = c.m > 0.5 ? 1 : 0;
  }
  clearTimeout(trIdle);
}

function trTick(now) {
  const dt = trLast ? Math.min((now - trLast) / 1000, 1 / 30) : 1 / 60;
  trLast = now;
  const calm = trStill.matches;
  const c = trState.cur;
  let next;
  if (trState.touring && !calm) {
    // the tour's clock starts once the blend into it is done
    if (!trState.blend) trState.clock += dt;
    const p = tourAt(trState.clock);
    trState.step = p;
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
      else trState.want.z = Math.min(trState.want.z, Math.max(0, trRoom(next, m2)));
    }
  }
  // never draw the head inside anything: lift Z when the state needs it, and stop when even the top is not clear
  const room = trRoom(next, next.m);
  if (room < 0 && !trState.touring) {
    trState.want = { x: c.x, y: c.y, z: c.z, a: c.a, b: c.b };
    next = { ...c };
  } else if (next.z > room) {
    next.z = Math.max(0, room);
    if (!trState.touring) trState.want.z = Math.min(trState.want.z, next.z);
  }
  trState.cur = next;
  // half rate on slow devices: alternate frames once renders average over 14 ms, every frame again under 9 ms
  if (trEma > 14) trHalf = true;
  else if (trEma < 9) trHalf = false;
  trSkip = trHalf ? !trSkip : false;
  const w = trState.want;
  const settled = !trState.touring && next.x === w.x && next.y === w.y && next.z === w.z && next.a === w.a && next.b === w.b && next.m === trState.mWant;
  if (!trSkip || settled) trDraw();
  trFrame = trVisible && (trState.touring || !settled) ? requestAnimationFrame(trTick) : 0;
}
const trRun = () => { if (!trFrame && trVisible) { trLast = 0; trFrame = requestAnimationFrame(trTick); } };

function trSelect(axis) {
  if (!TR_AXES[axis]) return;
  trState.axis = axis;
  trDescribe();
  trShow();
}
function trJog(axis, delta) {
  trStopTour();
  trSelect(axis);
  const ax = TR_AXES[axis];
  trRequest(axis, trState.want[ax.key] + delta);
  trDescribe();
  trRun();
}

new IntersectionObserver((entries) => { trVisible = entries[entries.length - 1].isIntersecting; if (trVisible) trRun(); }, { rootMargin: "120px 0px" }).observe(trStage);

// the axis buttons choose what a drag or the arrow keys move
for (const btn of trButtons) {
  btn.addEventListener("click", () => { trStopTour(); trSelect(btn.dataset.axis); trArmResume(); });
}
// drag: Y and A follow the pointer sideways; X, Z and B follow it up and down (down brings the cradle forward, lowers
// the head and rolls B negative). On touch the page keeps vertical scrolling (pan-y), so a touch drag works sideways.
const TR_DRAG = { X: ["y", 220], Y: ["x", 400], Z: ["y", 200], A: ["x", 360], B: ["y", -90] };
trStage.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || trState.dragging) return;
  trStopTour();
  const ax = TR_AXES[trState.axis];
  trState.dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, start: trState.want[ax.key] };
  trStage.setAttribute("data-drag", "");
  trStage.setPointerCapture?.(event.pointerId);
});
trStage.addEventListener("pointermove", (event) => {
  const d = trState.dragging;
  if (!d || event.pointerId !== d.id) return;
  const box = trStage.getBoundingClientRect();
  const [dir, span] = TR_DRAG[trState.axis];
  // touch scrolls vertically, so a touch drag always moves the axis by its sideways travel
  const along = event.pointerType === "touch" || dir === "x" ? (event.clientX - d.x) / box.width : (event.clientY - d.y) / box.height;
  trRequest(trState.axis, d.start + along * span);
  trRun();
});
const trRelease = (event) => {
  const d = trState.dragging;
  if (!d || event.pointerId !== d.id) return;
  trState.dragging = null;
  trStage.removeAttribute("data-drag");
  trStage.releasePointerCapture?.(event.pointerId);
  trDescribe();
  trArmResume();
};
trStage.addEventListener("pointerup", trRelease);
trStage.addEventListener("pointercancel", trRelease);
// keyboard focus (not a mouse press) pauses the tour until the stage loses focus
trStage.addEventListener("focus", () => {
  trState.focused = trStage.matches(":focus-visible");
  if (!trState.focused) return;
  trStopTour();
  trDescribe();
  trRun();
});
trStage.addEventListener("blur", () => { trState.focused = false; trArmResume(); });
trStage.addEventListener("keydown", (event) => {
  const letter = event.key.length === 1 ? event.key.toUpperCase() : "";
  if (TR_AXES[letter] && !event.ctrlKey && !event.metaKey && !event.altKey) {
    trStopTour();
    trSelect(letter);
    event.preventDefault();
    return;
  }
  const ax = TR_AXES[trState.axis];
  const step = event.shiftKey ? ax.big : ax.step;
  // the arrows move toward what they point at on screen: up raises Z and takes the cradle back; right moves Y and A up
  const up = { X: -1, Y: 1, Z: -1, A: 1, B: 1 }[trState.axis];
  const right = { X: 1, Y: 1, Z: 1, A: 1, B: 1 }[trState.axis];
  if (event.key === "ArrowUp") trJog(trState.axis, up * step);
  else if (event.key === "ArrowDown") trJog(trState.axis, -up * step);
  else if (event.key === "ArrowRight") trJog(trState.axis, right * step);
  else if (event.key === "ArrowLeft") trJog(trState.axis, -right * step);
  else if (event.key === "Home") {
    trStopTour();
    trState.want = trHome();
    trState.mWant = 1;
    trDescribe();
    trRun();
  } else return;
  event.preventDefault();
});
trStill.addEventListener("change", () => { if (trStill.matches) trStopTour(); else trArmResume(1400); trRun(); });

trDescribe();
trDraw();
trArmResume(1400);
