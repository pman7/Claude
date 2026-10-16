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
let trCalm = trStill.matches;
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
const TR_PASS = { tool: "Tool change", occlusal: "Occlusal surface", buccal: "Buccal wall", palatal: "Palatal wall" };
const trHome = () => ({ x: HOME.x, y: HOME.y, z: HOME.z, a: HOME.a, b: HOME.b });
// mode: "sim" plays the finishing job, "jog" hands the axes to the reader.
// cur: what is drawn; want: what the reader asked for (jog); m: the magazine sequence (0 out … 1 in, flap shut); row:
// how many rows the magazine is indexed out; tool: which tools are in the spindle and the two pockets the change swaps.
// time: where the job is; playing: the job runs; stopped: the reader paused it, so it waits for Play.
const trState = { mode: "sim", time: 0, playing: false, stopped: false, lifting: false, cur: { ...trHome(), m: 1, row: 0 }, want: trHome(), mWant: 1, tool: null, axis: "Y", blend: null, focused: false, dragging: null, pending: null, held: false, sim: null, done: { occlusal: 0, buccal: 0, palatal: 0 }, viewTo: 0 };
let trFrame = 0, trLast = 0, trVisible = false, trIdle = 0, trEma = 0, trSkip = false, trHalf = false;
// true while the page itself draws, so onFrame does not echo it back; it starts true so the engine's first render at
// mount (at the build's rest pose) does not overwrite home
let trOwn = true;

// how far down the head may come in a state (−1: it would not fit even at the top); jog itself is model.mjs's
const trRoom = (s, m = trState.cur.m) => roomAt(s, m);

const trController = TURN.mount(trStage, TR.turn, {
  follow,
  // a verification tool that sets a pose through window.__isoTurn holds the figure; the controls follow that pose
  onHold: () => { trState.playing = false; trState.held = true; clearTimeout(trIdle); trIdle = 0; },
  onFrame: (controller) => {
    if (trOwn) return;
    const v = controller.values ?? {};
    const m = typeof v.m === "number" ? v.m : mOf({ mag: v.mag ?? GEO.MAG_STROKE, flap: v.flap ?? 90 });
    const row = typeof v.row === "number" ? v.row : (v.magrow ?? 0) / GEO.PITCH;
    trState.cur = { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0, a: wrap(v.a ?? 0), b: v.b ?? 0, m, row };
    trState.want = { x: trState.cur.x, y: trState.cur.y, z: trState.cur.z, a: trState.cur.a, b: trState.cur.b };
    trState.mWant = magFor(trState.cur.y, trState.cur.b);
    trWork(true);
    trInsetUpdate();
    trBurClip();
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
  trState.sh = sh;
  const done = trState.done;
  const key = `${sh[0].toFixed(3)} ${sh[1].toFixed(3)} ${a.toFixed(3)} ${c.toFixed(3)} ${done.occlusal.toFixed(4)} ${done.buccal.toFixed(4)} ${done.palatal.toFixed(4)}`;
  if (!force && key === trWorkKey) return;
  trWorkKey = key;
  const w = workShapes(sh, done, (n) => a * -n[0] + c * -n[1] < 0);
  const put = (k, name, v) => { for (const el of trW[k] ?? []) if (el.getAttribute(name) !== v) el.setAttribute(name, v); };
  put("floor", "transform", w.floor);
  put("top", "transform", w.top);
  put("moatWalls", "d", w.moatWalls);
  put("moatSteps", "d", w.moatSteps);
  put("bodySteps", "d", w.bodySteps);
  for (const k of ["roughShade", "roughLit", "finShade", "finLit"]) put(k, "d", w.body[k]);
  put("connSide", "d", w.conn.side);
  put("connTop", "d", w.conn.top);
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

// each new line of the job goes to the slider's value text and to a polite live region, not every frame
const trLive = document.querySelector("[data-say]");
let trSaid = "";
let trDescribed = "";
function trSay(seek = false) {
  const s = trState.sim;
  if (!s) return;
  const text = trState.playing || trState.time > 0 ? s.say : "Finishing a full-arch bridge";
  const focused = document.activeElement === trStage;
  // the slider's value follows the job: each new line, and while it is not focused (so not read out) each second
  if (text !== trDescribed || (!focused && trStage.getAttribute("aria-valuenow") !== String(Math.round(trState.time)))) { trDescribed = text; trDescribe(); }
  // the autoplay is not narrated; a job the reader started or moved is, through the live region (while playing, unless
  // the focused slider's own value text already says it; a seek from the timeline always)
  if (!trState.asked || (focused && !seek) || text === trSaid) return;
  trSaid = text;
  if (trLive) trLive.textContent = text;
}

// The bur goes into the channel through face B: from the face down, it shows only as far as its sight line stays in
// the channel (work.mjs sightDepth), so clip it there (the spindle is upright on screen, so the cut is a horizontal line).
// Anywhere else (over the magazine, or with the disc turned away) it is in the open and is left whole.
const trBur = trStage.querySelector('[data-name="tool.bur"]');
let trBurRect = null;
if (trBur && trBur.ownerSVGElement) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = trBur.ownerSVGElement;
  const defs = svg.querySelector("defs") ?? svg.insertBefore(document.createElementNS(NS, "defs"), svg.firstChild);
  const clip = document.createElementNS(NS, "clipPath");
  clip.setAttribute("id", "tr-bur-clip");
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  trBurRect = document.createElementNS(NS, "rect");
  for (const [k, v] of [["x", "-10000"], ["y", "-10000"], ["width", "20000"], ["height", "10000"]]) trBurRect.setAttribute(k, v);
  clip.appendChild(trBurRect);
  defs.appendChild(clip);
}
function trBurClip() {
  if (!trBur || !trBurRect || !trFaceB || !trFaceA) return;
  const { p, t } = tipIn(trState.cur);
  const hit = trFaceB.getAttribute("opacity") === "0" ? null : burCut(p, t, trState.sh);
  if (!hit) { if (trBur.hasAttribute("clip-path")) trBur.removeAttribute("clip-path"); return; }
  const { cut, at: q } = hit;
  const [, b, , d, , f] = trMatrix(trFaceB);
  const under = trMatrix(trFaceA);
  const dy = (under[5] - f) / (2 * GEO.THICK);
  const y = b * -q[0] + d * -q[1] + f + cut * dy;
  const move = (trBur.getAttribute("transform") || "").match(/translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/);
  const ty = move ? Number(move[2]) : 0;
  trBurRect.setAttribute("height", (10000 + y - ty).toFixed(2));
  if (trBur.getAttribute("clip-path") !== "url(#tr-bur-clip)") trBur.setAttribute("clip-path", "url(#tr-bur-clip)");
}

// The tool change: the bur shows in the spindle while it holds a tool, and a shank in each of the two pockets the change
// swaps while the pocket holds one (the last job's tool goes in, the finishing bur comes out). Jog keeps whatever the
// job left.
const trPockets = Object.fromEntries([POCKETS.drop, POCKETS.pick].map((key) => [key, trStage.querySelector(`[data-name="pocket.${key.replace("/", ".")}"]`)]));
let trToolKey = "";
function trTools() {
  const tool = trState.tool;
  if (!tool) return;
  const key = JSON.stringify(tool);
  if (key === trToolKey) return;
  trToolKey = key;
  const show = (el, on) => { if (el && (el.getAttribute("visibility") === "hidden") === on) { if (on) el.removeAttribute("visibility"); else el.setAttribute("visibility", "hidden"); } };
  show(trBur, tool.spindle);
  for (const [key2, el] of Object.entries(trPockets)) show(el, tool[key2]);
}

// ---------------------------------------------------------------- the view: the whole chamber (0), in close on the work
// (1), or on the magazine for the tool change (2)
const trSvgs = [...trStage.querySelectorAll(":scope > svg")];
const TR_BOX = (trSvgs[0]?.getAttribute("viewBox") ?? "0 0 620 560").split(/[ ,]+/).map(Number);
const TR_ZOOM = 4.2;
let trFocus = null;
const trViewOf = (i) => {
  const [x0, y0, w0, h0] = TR_BOX;
  if (i === 1 && trFocus) return { K: TR_ZOOM, c: trFocus };
  if (i === 2 && TR.magFocus) return { K: TR.magZoom, c: TR.magFocus };
  return { K: 1, c: [x0 + w0 / 2, y0 + h0 / 2] };
};
// the view now, and the one it eases from (over 0.9 s) toward trState.viewTo
let trViewNow = trViewOf(0);
let trViewFrom = trViewNow;
let trViewT = 1;
function trViewSet(v) {
  trViewNow = v;
  const w = TR_BOX[2] / v.K;
  const h = TR_BOX[3] / v.K;
  const vb = `${(v.c[0] - w / 2).toFixed(2)} ${(v.c[1] - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`;
  for (const svg of trSvgs) if (svg.getAttribute("viewBox") !== vb) svg.setAttribute("viewBox", vb);
}
function trViewGo(i, now = false) {
  if (i !== trState.viewTo) { trState.viewTo = i; trViewFrom = trViewNow; trViewT = 0; }
  if (now) { trViewT = 1; trViewSet(trViewOf(i)); }
}
// one frame of the view's ease; true while it moves
function trViewStep(dt) {
  if (trViewT >= 1) return false;
  trViewT = Math.min(1, trViewT + (trCalm ? 1 : dt / 0.9));
  const k = trSmooth(trViewT);
  const to = trViewOf(trState.viewTo);
  // the zoom eases in its logarithm, so it feels even all the way
  trViewSet({ K: Math.exp(Math.log(trViewFrom.K) + (Math.log(to.K) - Math.log(trViewFrom.K)) * k), c: [trViewFrom.c[0] + (to.c[0] - trViewFrom.c[0]) * k, trViewFrom.c[1] + (to.c[1] - trViewFrom.c[1]) * k] });
  return true;
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
  // during the passes every axis moves together; in the tool change, Y and Z
  const running = sim && s && (trState.playing || trState.blend);
  for (const btn of trButtons) {
    const moving = Boolean(running && (s.axis === "all" || (s.axis ?? "").includes(btn.dataset.axis.toLowerCase())));
    if (btn.hasAttribute("data-moving") !== moving) btn.toggleAttribute("data-moving", moving);
    const on = !sim && btn.dataset.axis === trState.axis;
    if ((btn.getAttribute("aria-pressed") === "true") !== on) btn.setAttribute("aria-pressed", String(on));
  }
  const setAttr = (el, name, val) => { if (el && el.getAttribute(name) !== val) el.setAttribute(name, val); };
  setAttr(trSimButton, "aria-pressed", String(sim));
  setAttr(trJogButton, "aria-pressed", String(!sim));
  // the play button reads as playing while the job runs or is about to start on its own
  const playing = sim && (trState.playing || trIdle !== 0);
  const label = playing ? "Pause" : "Play";
  if (trPlayButton && trPlayButton.textContent !== label) trPlayButton.textContent = label;
  setAttr(trStage, "data-mode", trState.mode);
  setAttr(trWrap, "data-mode", trState.mode);
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
    Y: s.y < 12 ? "spindle over the tool sensor" : s.y < 125 ? "spindle over the magazine" : Math.abs(s.y - HOME.y) < 0.05 ? "spindle over the disc centre" : "spindle over the work",
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
  // page values; the controller applies follow() to turn the magazine sequence and row into the magazine and flap groups
  const stats = trController.set({ x: c.x, y: c.y, z: c.z, a: c.a, b: c.b, m: c.m, row: c.row ?? 0 });
  trOwn = false;
  if (stats && typeof stats.ms === "number") trEma = trEma ? trEma * 0.9 + stats.ms * 0.1 : stats.ms;
  trWork();
  trInsetUpdate();
  trBurClip();
  trTools();
  trShow();
}

// ---------------------------------------------------------------- jog: the reader moves one axis at a time
// ask for a new value on one axis: the head must fit at that state at least at the top, so back off toward the current
// request when it would not; Z never asks for deeper than the state allows
function trRequest(axis, value) {
  const ax = TR_AXES[axis];
  trState.want = jogRequest(trState.want, ax.key, value, ax.lo, ax.hi);
  trState.mWant = magFor(trState.want.y, trState.want.b);
}

// ---------------------------------------------------------------- the job: play, pause, seek, and the two modes
function trStartJob(asked = false) {
  clearTimeout(trIdle);
  trIdle = 0;
  // the reader's own Play (button or Space) always plays; only starting on its own waits for a calm, unfocused page
  if (!asked && (trCalm || trState.focused || trState.dragging || trState.held || trState.stopped)) { trShow(); return; }
  if (trState.mode !== "sim") trEnterSim();
  if (trState.time >= SIM_LEN - 1e-6) trState.time = 0;
  trState.playing = true;
  trState.asked = asked;
  trViewGo(trViewFor(trState.time));
  trShow();
  trRun();
}
function trArmJob(delay = 3600) {
  clearTimeout(trIdle);
  trIdle = 0;
  // (a job already playing, the reader's own included, just carries on)
  if (trState.playing || trState.mode !== "sim" || trCalm || trState.focused || trState.dragging || trState.held || trState.stopped) { trShow(); return; }
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
  trState.lifting = false;
  trState.time = simPassStart(trState.time);
  trState.blend = { from: { ...trState.cur }, t: 0 };
  trViewGo(trViewFor(trState.time));
  trDescribe();
  trDescribed = "";
  trShow();
  trRun();
}
function trEnterJog() {
  if (trState.mode === "jog") return;
  trPause({ sticky: true });
  trState.mode = "jog";
  trState.blend = null;
  // the bur may be in the part: it rises straight up, along the upright tool, before anything else moves
  Object.assign(trState, jogEnter(trState.cur));
  trViewGo(0);
  trDescribe();
  trShow();
  trRun();
}
// a seek from the timeline is spoken; one from the keys or a drag on the focused slider is read from its value text
function trSeek(time, speak = document.activeElement !== trStage) {
  trState.asked = true;
  if (trState.mode !== "sim") trEnterSim();
  trPause({ sticky: true });
  trState.blend = null;
  trState.time = trClamp(time, 0, SIM_LEN);
  trViewGo(trViewFor(trState.time));
  trSimDraw();
  trDescribe();
  if (speak) trSay(true);
  trRun();
}
function trSimDraw() {
  const s = simAt(trState.time);
  trState.sim = s;
  trState.done = s.done;
  trState.tool = s.tool;
  trState.cur = { x: s.x, y: s.y, z: s.z, a: s.a, b: s.b, m: s.m, row: s.row };
}
// the view stands back for the tool change, and comes in close on the work for the passes
function trViewFor(time) { return simAt(time).kind === "tool" ? 2 : 1; }

function trTick(now) {
  const dt = trLast ? Math.min((now - trLast) / 1000, 1 / 30) : 1 / 60;
  trLast = now;
  const calm = trCalm;
  const c = trState.cur;
  let next;
  let changed = false;
  let busy = false;
  if (trState.mode === "sim") {
    if (trState.blend) {
      // up first, across at the top, then down into the job: 0.6 s, 1.2 s and 0.6 s. The magazine and the cradle keep the
      // interlock: going in, the magazine indexes home while the head rises, goes in over the first half of the crossing,
      // and the cradle tilts over the second; coming out, the cradle levels first, then the magazine comes out, and it
      // indexes while the head goes down
      const bl = trState.blend;
      bl.t += calm ? 3 : dt;
      const p = simAt(trState.time);
      const f = bl.from;
      const k1 = trSmooth(bl.t / 0.6);
      const k2 = trSmooth((bl.t - 0.6) / 1.2);
      const k3 = trSmooth((bl.t - 1.8) / 0.6);
      const first = trSmooth((bl.t - 0.6) / 0.6);
      const second = trSmooth((bl.t - 1.2) / 0.6);
      const inward = p.m >= f.m;
      const lerp = (u, v, k) => u + (v - u) * k;
      next = { x: lerp(f.x, p.x, k2), y: lerp(f.y, p.y, k2), z: lerp(lerp(f.z, 0, k1), p.z, k3), a: wrap(f.a + wrap(p.a - f.a) * k2), b: lerp(f.b, p.b, inward ? second : first), m: lerp(f.m, p.m, inward ? first : second), row: lerp(f.row ?? 0, p.row, inward ? k1 : k3) };
      // the head keeps clear of everything on the way, the uncut disc face included (it may start in a cut, lifting:
      // then it only rises until it is clear)
      const room = trRoom(next, next.m);
      if (next.z > room && next.z > c.z) next.z = Math.max(c.z, room);
      trState.sim = { ...p, say: "" };
      trState.tool = p.tool;
      if (bl.t >= 2.4) trState.blend = null;
      trState.cur = next;
      busy = true;
    } else {
      if (trState.playing) {
        trState.time += dt;
        // the job loops: a short hold on the finished bridge is part of its last step
        if (trState.time >= SIM_LEN) trState.time = 0;
        trViewGo(trViewFor(trState.time));
        busy = true;
      }
      trSimDraw();
    }
  } else {
    trState.sim = null;
    const step = jogStep({ cur: c, want: trState.want, mWant: trState.mWant, lifting: trState.lifting }, calm ? 1 : 1 - Math.exp(-dt / 0.18), calm ? 1 : dt / 1.0);
    trState.cur = step.cur;
    trState.want = step.want;
    trState.lifting = step.lifting;
    changed = step.changed;
    busy = step.busy;
  }
  // the view eases between the whole chamber, the work and the magazine over about a second
  if (trViewStep(dt)) busy = true;
  // half rate on slow devices: alternate frames once renders average over 14 ms, every frame again under 9 ms
  if (trEma > 14) trHalf = true;
  else if (trEma < 9) trHalf = false;
  trSkip = trHalf ? !trSkip : false;
  if (!trSkip || !busy) trDraw();
  if (changed || !busy) trDescribe();
  else if (trState.mode === "sim" && trState.playing) trSay();
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
  // A turns all the way round: its two ends are the same place
  if (axis === "A") return;
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
  const seekAt = (event) => { const r = trLine.getBoundingClientRect(); trSeek(((event.clientX - r.left) / r.width) * SIM_LEN, true); };
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
trStage.addEventListener("lostpointercapture", (event) => { if (event.target === trStage) trRelease(event); });
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
  else if (event.key === " ") { trState.stopped = false; trState.held = false; trStartJob(true); }
  else if (event.key === "0") {
    trState.want = trHome();
    trState.mWant = 1;
    trDescribe();
    trRun();
  } else return;
  event.preventDefault();
});
trStill.addEventListener("change", (event) => { trCalm = event.matches; if (trCalm) trPause({ sticky: false }); else trArmJob(1400); trRun(); });

// a verification hook: put the job at a time, paused (for stills and video frames)
window.__isoSim = { seek: (time) => { trState.held = false; trState.stopped = true; trSeek(time); trViewGo(trState.viewTo, true); trDraw(); return trState.sim && trState.sim.say; }, view: (i) => trViewGo(i, true) };

trArmJob(1400);
trDescribe();
trDraw();
// the work zone: the disc's centre on screen at home, a little toward the spindle above it
if (trFaceB) { const m = trMatrix(trFaceB); trFocus = [m[4] - 18, m[5] - 8]; }
