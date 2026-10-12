const TR = __DATA__;
const follow = null;
const trStage = document.querySelector(".tr-stage");
const trReadout = document.querySelector("[data-readout]");
const trStill = matchMedia("(prefers-reduced-motion: reduce)");
const trClampB = (v) => Math.max(-SPEC.bLimit, Math.min(SPEC.bLimit, v));
const trSmooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const trState = { a: 0, b: 0, ta: 0, tb: 0, touring: false, clock: 0, blend: null, focused: false, dragging: null, held: false };
let trFrame = 0, trLast = 0, trVisible = false, trIdle = 0, trOwn = false, trEma = 0, trSkip = false, trHalf = false;

// The idle tour starts from rest: the holder turns a full revolution in 15 s while the cradle rolls out to each limit and back.
const trTourAt = (t) => ({ a: wrap(24 * t), b: SPEC.bLimit * Math.sin((t * 2 * Math.PI) / 9) });

function trShow(a, b) {
  const text = readoutOf(a, b);
  if (trReadout.textContent !== text) trReadout.textContent = text;
}

// A verification tool that sets a pose through window.__isoTurn holds the figure; the readout and state follow that pose,
// and the next user input steps from it.
const trController = TURN.mount(trStage, TR.turn, {
  follow,
  onHold: () => { trState.touring = false; trState.held = true; clearTimeout(trIdle); },
  onFrame: (controller) => {
    if (trOwn) return;
    const { a = 0, b = 0 } = controller.values ?? {};
    trState.a = trState.ta = wrap(a);
    trState.b = trState.tb = b;
    trShow(trState.a, trState.b);
    trDescribe();
  },
});

function trDraw() {
  if (trState.held) return;
  trOwn = true;
  const stats = trController.set({ a: trState.a, b: trState.b });
  trOwn = false;
  if (stats && typeof stats.ms === "number") trEma = trEma ? trEma * 0.9 + stats.ms * 0.1 : stats.ms;
  trShow(trState.a, trState.b);
}

function trDescribe() {
  const words = wordsOf(trState.ta, trState.tb);
  if (trStage.getAttribute("aria-valuetext") !== words) {
    trStage.setAttribute("aria-valuetext", words);
    trStage.setAttribute("aria-valuenow", String(Math.round(trState.tb)));
  }
}

function trStartTour() {
  if (trStill.matches || trState.focused || trState.dragging || trState.held) return;
  // join the tour where the holder already is, and blend B (and any A difference) in over 1.5 s
  trState.clock = (((trState.a % 360) + 360) % 360) / 24;
  trState.blend = { a: trState.a, b: trState.b, t: 0 };
  trState.touring = true;
  trRun();
}
function trArmResume(delay = 3600) {
  clearTimeout(trIdle);
  if (trStill.matches || trState.focused || trState.dragging || trState.held) return;
  trIdle = setTimeout(trStartTour, delay);
}

function trTick(now) {
  const dt = trLast ? Math.min((now - trLast) / 1000, 1 / 30) : 1 / 60;
  trLast = now;
  const calm = trStill.matches;
  if (trState.touring && !calm) {
    trState.clock += dt;
    const p = trTourAt(trState.clock);
    if (trState.blend) {
      trState.blend.t += dt;
      const k = trSmooth(trState.blend.t / 1.5);
      p.a = wrap(trState.blend.a + wrap(p.a - trState.blend.a) * k);
      p.b = trState.blend.b + (p.b - trState.blend.b) * k;
      if (k >= 1) trState.blend = null;
    }
    trState.ta = p.a;
    trState.tb = p.b;
  }
  // ease toward the targets; A along the shorter way round
  const k = calm ? 1 : 1 - Math.exp(-dt / 0.18);
  trState.a = wrap(trState.a + wrap(trState.ta - trState.a) * k);
  trState.b += (trState.tb - trState.b) * k;
  if (Math.abs(wrap(trState.ta - trState.a)) < 0.01) trState.a = trState.ta;
  if (Math.abs(trState.tb - trState.b) < 0.01) trState.b = trState.tb;
  // half rate on slow devices: alternate frames once renders average over 14 ms, every frame again under 9 ms
  if (trEma > 14) trHalf = true;
  else if (trEma < 9) trHalf = false;
  trSkip = trHalf ? !trSkip : false;
  if (!trSkip) trDraw();
  const settled = trState.a === trState.ta && trState.b === trState.tb;
  if (settled && !trState.touring && trSkip) trDraw();
  trFrame = trVisible && (trState.touring || !settled) ? requestAnimationFrame(trTick) : 0;
}
const trRun = () => { if (!trFrame && trVisible) { trLast = 0; trFrame = requestAnimationFrame(trTick); } };

function trSteer(a, b, { describe = true } = {}) {
  trState.held = false;
  trState.touring = false;
  trState.blend = null;
  clearTimeout(trIdle);
  trState.ta = wrap(a);
  trState.tb = trClampB(b);
  if (describe) trDescribe();
  trRun();
}

new IntersectionObserver((entries) => { trVisible = entries[entries.length - 1].isIntersecting; if (trVisible) trRun(); }, { rootMargin: "120px 0px" }).observe(trStage);

// Drag: sideways turns A, up and down rolls B. On touch the page keeps vertical scrolling (pan-y), so a touch drag turns A.
trStage.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || trState.dragging) return;
  const a = trState.touring ? trState.a : trState.ta;
  const b = trState.touring ? trState.b : trState.tb;
  trState.dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, a, b };
  trStage.setAttribute("data-drag", "");
  trStage.setPointerCapture?.(event.pointerId);
  trSteer(a, b, { describe: false });
});
trStage.addEventListener("pointermove", (event) => {
  const d = trState.dragging;
  if (!d || event.pointerId !== d.id) return;
  const box = trStage.getBoundingClientRect();
  const wantB = d.b - ((event.clientY - d.y) / box.height) * 90;
  // past a B limit, rebase the drag so reversing responds at once
  if (trClampB(wantB) !== wantB) { d.b = trClampB(wantB); d.y = event.clientY; }
  trSteer(d.a + ((event.clientX - d.x) / box.width) * 360, wantB, { describe: false });
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
  if (trState.touring) { trState.touring = false; trState.blend = null; trState.ta = trState.a; trState.tb = trState.b; }
  clearTimeout(trIdle);
  trDescribe();
});
trStage.addEventListener("blur", () => { trState.focused = false; trArmResume(); });
trStage.addEventListener("keydown", (event) => {
  const fromA = trState.touring ? trState.a : trState.ta;
  const fromB = trState.touring ? trState.b : trState.tb;
  const stepA = event.shiftKey ? 45 : 5;
  const stepB = event.shiftKey ? 5 : 1;
  if (event.key === "ArrowRight") trSteer(fromA + stepA, fromB);
  else if (event.key === "ArrowLeft") trSteer(fromA - stepA, fromB);
  else if (event.key === "ArrowUp") trSteer(fromA, fromB + stepB);
  else if (event.key === "ArrowDown") trSteer(fromA, fromB - stepB);
  else if (event.key === "Home") trSteer(0, 0);
  else if (event.key === "End") trSteer(fromA, fromB >= 0 ? SPEC.bLimit : -SPEC.bLimit);
  else if (event.key === "1") trSteer(0, fromB);
  else if (event.key === "2") trSteer(180, fromB);
  else return;
  event.preventDefault();
});
trStill.addEventListener("change", () => { if (trStill.matches) { trState.touring = false; trState.blend = null; clearTimeout(trIdle); } else trArmResume(1400); trRun(); });

trDescribe();
trDraw();
trArmResume(1400);
