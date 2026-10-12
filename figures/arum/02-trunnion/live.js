const TR = __DATA__;
const follow = null;
const trStage = document.querySelector(".tr-stage");
const trReadout = document.querySelector("[data-readout]");
const trStatus = trStage.querySelector("[data-status]");
const trStill = matchMedia("(prefers-reduced-motion: reduce)");
const trClampB = (v) => Math.max(-SPEC.bLimit, Math.min(SPEC.bLimit, v));
const trState = { a: 0, b: 0, ta: 0, tb: 0, touring: !trStill.matches, clock: 0, focused: false, dragging: null, held: false };
let trFrame = 0, trLast = 0, trVisible = false, trIdle = 0, trSaid = "";

// a verification tool that sets a pose through window.__isoTurn holds the figure: the loop stops writing poses
const trController = TURN.mount(trStage, TR.turn, { follow, onHold: () => { trState.touring = false; trState.held = true; clearTimeout(trIdle); } });

// idle tour: turn the holder through a full revolution while the cradle rolls out to each limit and back
const trTourAt = (t) => ({ a: wrap(-180 + ((t * 24) % 360)), b: SPEC.bLimit * Math.sin((t * 2 * Math.PI) / 9) });

function trDraw() {
  if (trState.held) return;
  trController.set({ a: trState.a, b: trState.b });
  const text = readoutOf(trState.a, trState.b);
  if (trReadout.textContent !== text) trReadout.textContent = text;
}

function trDescribe() {
  const words = wordsOf(trState.ta, trState.tb);
  if (trStage.getAttribute("aria-valuetext") !== words) {
    trStage.setAttribute("aria-valuetext", words);
    trStage.setAttribute("aria-valuenow", String(Math.round(trState.tb)));
  }
}

function trArmResume() {
  clearTimeout(trIdle);
  if (trStill.matches || trState.focused || trState.dragging) return;
  trIdle = setTimeout(() => { if (trState.held) return; trState.touring = true; trState.clock = (wrap(trState.a) + 180) / 24; trRun(); }, 3600);
}

function trTick(now) {
  const dt = trLast ? Math.min((now - trLast) / 1000, 1 / 30) : 1 / 60;
  trLast = now;
  const calm = trStill.matches;
  if (trState.touring && !calm) {
    trState.clock += dt;
    const p = trTourAt(trState.clock);
    trState.ta = p.a;
    trState.tb = p.b;
  }
  // ease toward the targets; A along the shorter way round
  const k = calm ? 1 : 1 - Math.exp(-dt / 0.18);
  trState.a += wrap(trState.ta - trState.a) * k;
  trState.b += (trState.tb - trState.b) * k;
  if (Math.abs(wrap(trState.ta - trState.a)) < 0.01) trState.a = trState.ta;
  if (Math.abs(trState.tb - trState.b) < 0.01) trState.b = trState.tb;
  trState.a = wrap(trState.a);
  trDraw();
  const settled = trState.a === trState.ta && trState.b === trState.tb;
  if (settled && !trState.touring) {
    const words = wordsOf(trState.a, trState.b);
    if (words !== trSaid) { trStatus.textContent = words; trSaid = words; }
  }
  trFrame = trVisible && (trState.touring || !settled) ? requestAnimationFrame(trTick) : 0;
}
const trRun = () => { if (!trFrame && trVisible) { trLast = 0; trFrame = requestAnimationFrame(trTick); } };

function trSteer(a, b) {
  trState.held = false;
  trState.touring = false;
  clearTimeout(trIdle);
  trState.ta = wrap(a);
  trState.tb = trClampB(b);
  trDescribe();
  trRun();
}

new IntersectionObserver((entries) => { trVisible = entries[entries.length - 1].isIntersecting; if (trVisible) trRun(); }, { rootMargin: "120px 0px" }).observe(trStage);

trStage.addEventListener("pointerdown", (event) => {
  trState.dragging = { x: event.clientX, y: event.clientY, a: trState.touring ? trState.a : trState.ta, b: trState.touring ? trState.b : trState.tb };
  trStage.setPointerCapture?.(event.pointerId);
  trSteer(trState.dragging.a, trState.dragging.b);
});
trStage.addEventListener("pointermove", (event) => {
  const d = trState.dragging;
  if (!d) return;
  const box = trStage.getBoundingClientRect();
  trSteer(d.a + ((event.clientX - d.x) / box.width) * 360, d.b - ((event.clientY - d.y) / box.height) * 90);
});
const trRelease = () => { trState.dragging = null; trArmResume(); };
trStage.addEventListener("pointerup", trRelease);
trStage.addEventListener("pointercancel", trRelease);
trStage.addEventListener("focus", () => { trState.focused = true; if (trState.touring) { trState.touring = false; trState.ta = trState.a; trState.tb = trState.b; } clearTimeout(trIdle); trDescribe(); });
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
trStill.addEventListener("change", () => { trState.touring = !trStill.matches && !trState.focused; trRun(); });

if (trStill.matches) trState.touring = false;
trDescribe();
trDraw();
