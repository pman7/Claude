const TR = __DATA__;
const follow = null;
const trStage = document.querySelector(".tr-stage");
const trReadout = document.querySelector("[data-readout]");
const trButtons = [...document.querySelectorAll(".tr-axis[data-axis]")];
const trSimButton = document.querySelector(".tr-mode-sim");
const trJogButton = document.querySelector(".tr-mode-jog");
const trPlayButton = document.querySelector(".tr-play");
const trLine = document.querySelector(".tr-line");
const trLineHead = document.querySelector(".tr-line-head");
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
const TR_PASS = { occlusal: "Occlusal surface", buccal: "Buccal wall", palatal: "Palatal wall" };
const trHome = () => ({ x: HOME.x, y: HOME.y, z: HOME.z, a: HOME.a, b: HOME.b });
// mode: "sim" plays the finishing job, "jog" hands the axes to the reader.
// cur: what is drawn; want: what the reader asked for (jog); m: the magazine sequence (0 out … 1 in, flap shut).
// time: where the job is; playing: the job runs; stopped: the reader paused it, so it waits for Play.
const trState = { mode: "sim", time: 0, playing: false, stopped: false, cur: { ...trHome(), m: 1 }, want: trHome(), mWant: 1, axis: "Y", blend: null, focused: false, dragging: null, pending: null, held: false, sim: null, done: { occlusal: 0, buccal: 0, palatal: 0 }, view: 0, viewTo: 0 };
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
  onHold: () => { trState.playing = false; trState.held = true; clearTimeout(trIdle); trIdle = 0; },
  onFrame: (controller) => {
    if (trOwn) return;
    const v = controller.values ?? {};
    const m = typeof v.m === "number" ? v.m : (v.flap ?? 0) > 0 ? 0.72 + (0.28 * v.flap) / 90 : (0.72 * (v.mag ?? 0)) / GEO.MAG_STROKE;
    trState.cur = { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0, a: wrap(v.a ?? 0), b: v.b ?? 0, m };
    trState.want = { x: trState.cur.x, y: trState.cur.y, z: trState.cur.z, a: trState.cur.a, b: trState.cur.b };
    trState.mWant = trMagFor(trState.cur.y);
    trWork(true);
    trShow();
    trDescribe();
  },
});

// ---------------------------------------------------------------- the milled disc (work.mjs), redrawn as the holder moves
const trPlate = trStage.querySelector('[data-name="holder.plate"]');
const trFaceB = trPlate && trPlate.querySelector('[data-r="plane0"]');
const trFaceA = trPlate && trPlate.querySelector('[data-r="plane1"]');
const trW = {};
for (const el of trStage.querySelectorAll("[data-w]")) (trW[el.dataset.w] ??= []).push(el);
const trMatrix = (el) => { const t = el.getAttribute("transform") || ""; const i = t.indexOf("("); return t.slice(i + 1, -1).split(/[ ,]+/).map(Number); };
let trWorkKey = "";
function trWork(force = false) {
  if (!trFaceB || !trFaceA) return;
  if (trFaceB.getAttribute("opacity") === "0") return;
  const [a, b, c, d, e, f] = trMatrix(trFaceB);
  const under = trMatrix(trFaceA);
  // one millimetre down from face B, on screen (face A is 25 below it), then in the face's own coordinates; the disc
  // markup sits in a scale(−1 −1) group, so the shift in the disc frame is the negative
  const dx = (under[4] - e) / (2 * GEO.THICK);
  const dy = (under[5] - f) / (2 * GEO.THICK);
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return;
  const sh = [-(dx * d - c * dy) / det, -(a * dy - b * dx) / det];
  const done = trState.done;
  const key = `${sh[0].toFixed(3)} ${sh[1].toFixed(3)} ${a.toFixed(3)} ${c.toFixed(3)} ${done.occlusal.toFixed(4)} ${done.buccal.toFixed(4)} ${done.palatal.toFixed(4)}`;
  if (!force && key === trWorkKey) return;
  trWorkKey = key;
  const w = workShapes(sh, done, (n) => a * -n[0] + c * -n[1] < 0);
  const put = (k, name, v) => { for (const el of trW[k] ?? []) if (el.getAttribute(name) !== v) el.setAttribute(name, v); };
  put("floor", "transform", w.floor);
  put("top", "transform", w.top);
  put("moatSteps", "d", w.moatSteps);
  put("bodySteps", "d", w.bodySteps);
  for (const k of ["roughShade", "roughLit", "finShade", "finLit"]) put(k, "d", w.body[k]);
  put("connFarSide", "d", w.conn.farSide);
  put("connFarTop", "d", w.conn.farTop);
  put("connNearSide", "d", w.conn.nearSide);
  put("connNearTop", "d", w.conn.nearTop);
  put("reveal", "stroke-dashoffset", String(w.reveal));
}

// the part view beside it: the same disc from above, the current pass's path and the bur's tip with its lean
const trWrap = trStage.parentElement;
const trInset = document.querySelector(".tr-inset");
const trInsetW = {};
if (trInset) for (const el of trInset.querySelectorAll("[data-w]")) (trInsetW[el.dataset.w] ??= []).push(el);
const trTracks = trInset ? [...trInset.querySelectorAll("[data-track]")] : [];
const trTracksDone = trInset ? [...trInset.querySelectorAll("[data-track-done]")] : [];
const trTool = trInset && trInset.querySelector("[data-tool]");
const trToolLean = trTool && trTool.querySelector(".tr-tool-lean");
const TR_INSET_SH = [0, 0.45];
let trInsetKey = "";
function trInsetUpdate() {
  if (!trInset) return;
  const done = trState.done;
  const kind = trState.mode === "sim" && trState.sim ? trState.sim.kind : null;
  const key = `${done.occlusal.toFixed(4)} ${done.buccal.toFixed(4)} ${done.palatal.toFixed(4)} ${kind}`;
  if (key !== trInsetKey) {
    trInsetKey = key;
    const w = workShapes(TR_INSET_SH, done, (n) => n[0] < 0);
    const put = (k, name, v) => { for (const el of trInsetW[k] ?? []) if (el.getAttribute(name) !== v) el.setAttribute(name, v); };
    put("bodySteps", "d", w.bodySteps);
    for (const k of ["roughShade", "roughLit", "finShade", "finLit"]) put(k, "d", w.body[k]);
    put("reveal", "stroke-dashoffset", String(w.reveal));
    for (const el of trTracks) el.toggleAttribute("data-on", el.dataset.track === kind);
    for (const el of trTracksDone) { el.toggleAttribute("data-on", el.dataset.trackDone === kind); el.setAttribute("stroke-dashoffset", (1 - (done[el.dataset.trackDone] ?? 0)).toFixed(4)); }
  }
  // the bur's tip, shown while it is at the part: where it is, and a line 25 mm up its axis, seen from above
  const { p, t } = tipIn(trState.cur);
  const near = trState.mode === "sim" && p[2] < GEO.THICK + 3;
  if (trTool) {
    const op = near ? "1" : "0";
    if (trTool.getAttribute("opacity") !== op) trTool.setAttribute("opacity", op);
    if (near) {
      trTool.setAttribute("transform", `translate(${p[0].toFixed(2)} ${p[1].toFixed(2)})`);
      trToolLean.setAttribute("d", `M0 0L${(25 * t[0]).toFixed(2)} ${(25 * t[1]).toFixed(2)}`);
    }
  }
}

// ---------------------------------------------------------------- the view: the whole chamber, or in close on the work
const trSvgs = [...trStage.querySelectorAll(":scope > svg")];
const TR_BOX = (trSvgs[0]?.getAttribute("viewBox") ?? "0 0 620 560").split(/[ ,]+/).map(Number);
const TR_ZOOM = 4.2;
let trFocus = null;
function trViewAt(k) {
  if (!trFocus) return;
  const [x0, y0, w0, h0] = TR_BOX;
  const K = 1 + (TR_ZOOM - 1) * k;
  const w = w0 / K;
  const h = h0 / K;
  const cx = x0 + w0 / 2 + (trFocus[0] - (x0 + w0 / 2)) * k;
  const cy = y0 + h0 / 2 + (trFocus[1] - (y0 + h0 / 2)) * k;
  const vb = `${(cx - w / 2).toFixed(2)} ${(cy - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`;
  for (const svg of trSvgs) if (svg.getAttribute("viewBox") !== vb) svg.setAttribute("viewBox", vb);
}

function trShow() {
  const v = axesOf(trState.cur);
  for (const key of Object.keys(trValues)) if (trValues[key].textContent !== v[key]) trValues[key].textContent = v[key];
  const sim = trState.mode === "sim";
  const s = trState.sim;
  const ax = TR_AXES[trState.axis];
  let text;
  if (sim && trState.blend) text = "Into the job";
  else if (sim && s && (trState.playing || trState.time > 0)) text = s.say || readoutOf(trState.cur);
  else if (sim) text = "Finishing a full-arch bridge";
  else text = `${trState.axis} · ${ax.name} · ${v[trState.axis]}${ax.unit === "millimetres" ? " mm" : ""}`;
  if (trReadout.textContent !== text) trReadout.textContent = text;
  // during the job every axis moves together
  const moving = sim && s && s.axis === "all" && (trState.playing || trState.blend);
  for (const btn of trButtons) {
    if (btn.hasAttribute("data-moving") !== Boolean(moving)) btn.toggleAttribute("data-moving", Boolean(moving));
    const on = !sim && btn.dataset.axis === trState.axis;
    if ((btn.getAttribute("aria-pressed") === "true") !== on) btn.setAttribute("aria-pressed", String(on));
  }
  const setAttr = (el, name, val) => { if (el && el.getAttribute(name) !== val) el.setAttribute(name, val); };
  setAttr(trSimButton, "aria-pressed", String(sim));
  setAttr(trJogButton, "aria-pressed", String(!sim));
  // the play button reads as playing while the job runs or is about to start on its own
  const playing = sim && (trState.playing || trIdle !== 0);
  setAttr(trPlayButton, "aria-pressed", String(playing));
  const label = playing ? "Pause" : "Play";
  if (trPlayButton && trPlayButton.textContent !== label) trPlayButton.textContent = label;
  setAttr(trStage, "data-mode", trState.mode);
  const close = sim && trState.viewTo === 1;
  if (trWrap && trWrap.hasAttribute("data-close") !== close) trWrap.toggleAttribute("data-close", close);
  if (trLineHead) {
    const pct = `${((100 * trState.time) / SIM_LEN).toFixed(2)}%`;
    if (trLineHead.style.left !== pct) trLineHead.style.left = pct;
  }
}
// the slider names what it moves: in the job, the time through it; in jog, the chosen axis
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
  const set = (name, val) => { if (trStage.getAttribute(name) !== val) trStage.setAttribute(name, val); };
  if (trState.mode === "sim") {
    const s = trState.sim ?? simAt(trState.time);
    const pass = s.kind ? `${TR_PASS[s.kind]}, ` : "";
    set("aria-label", "Milling simulation: finishing a full-arch bridge");
    set("aria-valuemin", "0");
    set("aria-valuemax", String(Math.round(SIM_LEN)));
    set("aria-valuenow", String(Math.round(trState.time)));
    set("aria-valuetext", `${pass}${Math.round(trState.time)} of ${Math.round(SIM_LEN)} seconds; ${wordsOf(trState.cur)}`);
    return;
  }
  const ax = TR_AXES[trState.axis];
  set("aria-label", `${trState.axis} axis, ${ax.name}`);
  set("aria-valuemin", String(ax.sign < 0 ? -ax.hi : ax.lo));
  set("aria-valuemax", String(ax.sign < 0 ? -ax.lo : ax.hi));
  set("aria-valuenow", String(Math.round(trValueOf(trState.axis, trState.want) * 10) / 10 || 0));
  set("aria-valuetext", trWords(trState.axis, trState.want));
}

function trDraw() {
  if (trState.held) return;
  trOwn = true;
  const c = trState.cur;
  // page values; the controller applies follow() to turn the magazine sequence into the magazine and flap groups
  const stats = trController.set({ x: c.x, y: c.y, z: c.z, a: c.a, b: c.b, m: c.m });
  trOwn = false;
  if (stats && typeof stats.ms === "number") trEma = trEma ? trEma * 0.9 + stats.ms * 0.1 : stats.ms;
  trWork();
  trInsetUpdate();
  trShow();
}

// ---------------------------------------------------------------- jog: the reader moves one axis at a time
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

// ---------------------------------------------------------------- the job: play, pause, seek, and the two modes
function trStartJob(asked = false) {
  clearTimeout(trIdle);
  trIdle = 0;
  if ((trStill.matches && !asked) || trState.focused || trState.dragging || trState.held || trState.stopped) { trShow(); return; }
  if (trState.mode !== "sim") trEnterSim();
  if (trState.time >= SIM_LEN - 1e-6) trState.time = 0;
  trState.playing = true;
  trState.viewTo = 1;
  trShow();
  trRun();
}
function trArmJob(delay = 3600) {
  clearTimeout(trIdle);
  trIdle = 0;
  if (trState.mode !== "sim" || trStill.matches || trState.focused || trState.dragging || trState.held || trState.stopped) { trShow(); return; }
  trIdle = setTimeout(() => trStartJob(), delay);
  trShow();
}
function trPause({ sticky = true } = {}) {
  trState.held = false;
  if (sticky) trState.stopped = true;
  trState.playing = false;
  clearTimeout(trIdle);
  trIdle = 0;
  trShow();
}
// back into the job from wherever jog left the machine: lift, then blend into the job at the start of the pass that
// was running (above the part), so the bur never drops into it on the way
function trEnterSim() {
  trState.mode = "sim";
  trState.time = simPassStart(trState.time);
  trState.blend = { from: { ...trState.cur }, t: 0 };
  trState.viewTo = 1;
  trDescribe();
  trShow();
  trRun();
}
function trEnterJog() {
  if (trState.mode === "jog") return;
  trPause({ sticky: true });
  trState.mode = "jog";
  trState.blend = null;
  const c = trState.cur;
  // the bur may be in the part: the reader's first request is the same pose, lifted clear
  trState.want = { x: c.x, y: c.y, z: Math.min(c.z, Math.max(0, trRoom(c, c.m))), a: c.a, b: c.b };
  trState.mWant = trMagFor(c.y);
  trState.viewTo = 0;
  trDescribe();
  trShow();
  trRun();
}
function trSeek(time) {
  if (trState.mode !== "sim") trEnterSim();
  trPause({ sticky: true });
  trState.blend = null;
  trState.time = trClamp(time, 0, SIM_LEN);
  trState.viewTo = 1;
  trSimDraw();
  trDescribe();
  trRun();
}
function trSimDraw() {
  const s = simAt(trState.time);
  trState.sim = s;
  trState.done = s.done;
  trState.cur = { x: s.x, y: s.y, z: s.z, a: s.a, b: s.b, m: 1 };
}

function trTick(now) {
  const dt = trLast ? Math.min((now - trLast) / 1000, 1 / 30) : 1 / 60;
  trLast = now;
  const calm = trStill.matches;
  const c = trState.cur;
  let next;
  let changed = false;
  let busy = false;
  if (trState.mode === "sim") {
    if (trState.blend) {
      // 0.8 s to lift Z and level B, then 1.2 s into the job
      const bl = trState.blend;
      bl.t += calm ? 2 : dt;
      const p = simAt(trState.time);
      const f = bl.from;
      const k1 = trSmooth(bl.t / 0.8);
      const k2 = trSmooth((bl.t - 0.8) / 1.2);
      const lerp = (u, v, k) => u + (v - u) * k;
      const mid = { x: f.x, y: f.y, z: lerp(f.z, 0, k1), a: f.a, b: lerp(f.b, 0, k1), m: lerp(f.m, 1, k1) };
      next = { x: lerp(mid.x, p.x, k2), y: lerp(mid.y, p.y, k2), z: lerp(mid.z, p.z, k2), a: wrap(mid.a + wrap(p.a - mid.a) * k2), b: lerp(mid.b, p.b, k2), m: lerp(mid.m, 1, k2) };
      // on the way in the head keeps clear of everything, the uncut disc face included
      const room = trRoom(next, next.m);
      if (next.z > room) next.z = Math.max(0, room);
      trState.sim = { ...p, say: "" };
      if (bl.t >= 2) trState.blend = null;
      trState.cur = next;
      busy = true;
    } else {
      if (trState.playing) {
        trState.time += dt;
        // the job loops: a short hold on the finished bridge is part of its last step
        if (trState.time >= SIM_LEN) trState.time = 0;
        busy = true;
      }
      trSimDraw();
    }
  } else {
    trState.sim = null;
    const k = calm ? 1 : 1 - Math.exp(-dt / 0.18);
    const w = trState.want;
    next = { x: c.x + (w.x - c.x) * k, y: c.y + (w.y - c.y) * k, z: c.z + (w.z - c.z) * k, a: wrap(c.a + wrap(w.a - c.a) * k), b: c.b + (w.b - c.b) * k, m: c.m };
    for (const key of ["x", "y", "z", "b"]) if (Math.abs(w[key] - next[key]) < 0.01) next[key] = w[key];
    if (Math.abs(wrap(w.a - next.a)) < 0.01) next.a = w.a;
    // the magazine runs its sequence at its own pace, and only comes out once the head is clear of its path
    if (next.m !== trState.mWant) {
      const step = calm ? 1 : dt / 2.2;
      const m2 = trState.mWant < next.m ? Math.max(trState.mWant, next.m - step) : Math.min(trState.mWant, next.m + step);
      if (trRoom(next, m2) >= next.z) next.m = m2;
      else { trState.want.z = Math.min(trState.want.z, Math.max(0, trRoom(next, m2))); changed = true; }
    }
    // never draw the head inside anything: lift the drawn head when the state needs it (the request stands, so the head
    // comes back down to it once there is room), and stop when even the top is not clear
    const room = trRoom(next, next.m);
    if (room < 0) {
      trState.want = { x: c.x, y: c.y, z: c.z, a: c.a, b: c.b };
      next = { ...c };
      changed = true;
    } else if (next.z > room) next.z = Math.max(0, room);
    trState.cur = next;
    const w2 = trState.want;
    busy = !(next.x === w2.x && next.y === w2.y && Math.abs(next.z - Math.min(w2.z, Math.max(0, room))) < 0.01 && next.a === w2.a && next.b === w2.b && next.m === trState.mWant);
  }
  // the view eases between the whole chamber and the work over about a second
  if (trState.view !== trState.viewTo) {
    const step = calm ? 1 : dt / 0.9;
    trState.view = trState.viewTo > trState.view ? Math.min(trState.viewTo, trState.view + step) : Math.max(trState.viewTo, trState.view - step);
    trViewAt(trSmooth(trState.view));
    busy = true;
  }
  // half rate on slow devices: alternate frames once renders average over 14 ms, every frame again under 9 ms
  if (trEma > 14) trHalf = true;
  else if (trEma < 9) trHalf = false;
  trSkip = trHalf ? !trSkip : false;
  if (!trSkip || !busy) trDraw();
  if (changed || !busy || trState.mode === "sim") trDescribe();
  trFrame = trVisible && busy ? requestAnimationFrame(trTick) : 0;
}
const trRun = () => { if (!trFrame && trVisible) { trLast = 0; trFrame = requestAnimationFrame(trTick); } };

function trSelect(axis) {
  if (!TR_AXES[axis]) return;
  trEnterJog();
  trState.axis = axis;
  trDescribe();
  trShow();
}
// jog the chosen axis by `delta` in its displayed sense (up and right raise the value, as on any slider)
function trJog(axis, delta) {
  trSelect(axis);
  const ax = TR_AXES[axis];
  trRequest(axis, trState.want[ax.key] + ax.sign * delta);
  trDescribe();
  trRun();
}
// Home and End go to the low and high ends of the value as shown (for Z the low end is the deepest)
function trSetEnd(axis, high) {
  trSelect(axis);
  const ax = TR_AXES[axis];
  trRequest(axis, high !== ax.sign < 0 ? ax.hi : ax.lo);
  trDescribe();
  trRun();
}
const trNextPass = (dir) => {
  const starts = [0, ...SIM_SPANS.map((span) => span.start), SIM_LEN];
  const t = trState.time;
  if (dir > 0) return starts.find((s) => s > t + 0.05) ?? SIM_LEN;
  return [...starts].reverse().find((s) => s < t - 0.05) ?? 0;
};

new IntersectionObserver((entries) => { trVisible = entries[entries.length - 1].isIntersecting; if (trVisible) trRun(); }, { rootMargin: "120px 0px" }).observe(trStage);

// the axis buttons hand the chosen axis to the reader (jog); the mode buttons switch between the job and jog
for (const btn of trButtons) btn.addEventListener("click", () => trSelect(btn.dataset.axis));
trSimButton?.addEventListener("click", () => { if (trState.mode === "sim") return; trState.stopped = false; trState.held = false; trEnterSim(); trStartJob(true); });
trJogButton?.addEventListener("click", () => trEnterJog());
trPlayButton?.addEventListener("click", () => {
  if (trState.mode === "sim" && (trState.playing || trIdle !== 0)) { trPause(); return; }
  trState.stopped = false;
  trState.held = false;
  trStartJob(true);
});
// the timeline under the stage: click or drag along it to seek
if (trLine) {
  const seekAt = (event) => { const r = trLine.getBoundingClientRect(); trSeek(((event.clientX - r.left) / r.width) * SIM_LEN); };
  trLine.addEventListener("pointerdown", (event) => { if (event.button !== 0 && event.pointerType === "mouse") return; trLine.setPointerCapture?.(event.pointerId); seekAt(event); });
  trLine.addEventListener("pointermove", (event) => { if (trLine.hasPointerCapture?.(event.pointerId)) seekAt(event); });
}

// drag: in the job, sideways scrubs through it; in jog, Y and A follow the pointer sideways and X, Z and B a mouse up and
// down (down brings the cradle forward, lowers the head and tilts B negative). A touch drag works sideways only, and only
// once it is clearly sideways, so a page scroll that starts on the figure scrolls and leaves the job alone.
const TR_DRAG = { X: ["y", 220], Y: ["x", 400], Z: ["y", 200], A: ["x", 360], B: ["y", -90] };
function trBegin(event) {
  if (trState.mode === "sim") trPause();
  const ax = TR_AXES[trState.axis];
  trState.dragging = { id: event.pointerId, touch: event.pointerType === "touch", x: event.clientX, y: event.clientY, start: trState.mode === "sim" ? trState.time : trState.want[ax.key] };
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
  if (trState.mode === "sim") {
    trSeek(d.start + ((event.clientX - d.x) / box.width) * SIM_LEN);
    return;
  }
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
// keyboard focus (not a mouse press) pauses the job while the stage has it
trStage.addEventListener("focus", () => {
  trState.focused = trStage.matches(":focus-visible");
  if (!trState.focused) return;
  if (trState.mode === "sim") trPause({ sticky: false });
  trDescribe();
  trRun();
});
trStage.addEventListener("blur", () => { trState.focused = false; trArmJob(); });
trStage.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const letter = event.key.length === 1 ? event.key.toUpperCase() : "";
  if (TR_AXES[letter]) {
    trSelect(letter);
    event.preventDefault();
    return;
  }
  if (trState.mode === "sim") {
    const step = event.shiftKey ? 5 : 1;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") trSeek(trState.time + step);
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") trSeek(trState.time - step);
    else if (event.key === "PageUp") trSeek(trNextPass(1));
    else if (event.key === "PageDown") trSeek(trNextPass(-1));
    else if (event.key === "Home") trSeek(0);
    else if (event.key === "End") trSeek(SIM_LEN);
    else if (event.key === " ") { if (trState.playing) trPause(); else { trState.stopped = false; trStartJob(true); } }
    else return;
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
    trState.want = trHome();
    trState.mWant = 1;
    trDescribe();
    trRun();
  } else return;
  event.preventDefault();
});
trStill.addEventListener("change", () => { if (trStill.matches) trPause({ sticky: false }); else trArmJob(1400); trRun(); });

// a verification hook: put the job at a time, paused (for stills and video frames)
window.__isoSim = { seek: (time) => { trState.held = false; trState.stopped = true; trSeek(time); trViewAt(trSmooth((trState.view = trState.viewTo = 1))); trDraw(); return trState.sim && trState.sim.say; }, view: (k) => { trState.view = trState.viewTo = k; trViewAt(trSmooth(k)); } };

trArmJob(1400);
trDescribe();
trDraw();
// the work zone: the disc's centre on screen at home, a little toward the spindle above it
if (trFaceB) { const m = trMatrix(trFaceB); trFocus = [m[4] - 18, m[5] - 8]; }
