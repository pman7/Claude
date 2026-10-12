const SO = __DATA__;
const soStage = document.querySelector(".so-stage");
const soSvg = soStage.querySelector("svg");
const soPasses = soSvg.querySelector('[data-part="passes"]');
const soTrace = soSvg.querySelector('[data-part="trace"]');
const soValue = soSvg.querySelector('[data-part="screen-value"]');
const soMoving = [...soSvg.querySelectorAll("[data-move]")];
const soReadout = document.querySelector("[data-readout]");
const soHint = document.querySelector('[data-corner="hint"]');
const soStatus = soStage.querySelector("[data-status]");
const soStill = matchMedia("(prefers-reduced-motion: reduce)");
const soTouch = matchMedia("(hover: none) and (pointer: coarse)");
const soClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const soRound = (s) => Math.round(s * 100) / 100;
const soPx = (() => {
  // screen px between neighbouring pass lines per world unit of stepover
  const a = iso([0, 0, SO.TOP], SO.P), b = iso([1, 0, SO.TOP], SO.P), c = iso([1, 1, SO.TOP], SO.P);
  const along = [c[0] - b[0], c[1] - b[1]];
  const len = Math.hypot(along[0], along[1]) || 1;
  return Math.abs((b[0] - a[0]) * along[1] - (b[1] - a[1]) * along[0]) / len;
})();

const [soTool0, soStep0] = TOUR[0];
const soState = {
  tool: soTool0,
  want: soStep0, // what the reader asked for; kept across tool switches
  target: soStep0, // want, clamped to the tool's range
  shown: soStep0, // eased stepover the drawing shows
  t: 0, // stylus traverse, world units 0..TRAVEL
  phase: "scan", // scan → hold → back → scan
  scan: { tool: soTool0, s: soStep0, extent: 0 }, // what the trace shows
  wait: 1.4,
  quietSince: 0,
  touring: !soStill.matches,
  clock: 0,
  focused: false,
  hovering: false,
};
let soFrame = 0, soLast = 0, soVisible = false, soIdle = 0, soLastPasses = "", soSaid = "";

function soDrawPasses() {
  const s = soState.shown * SO.MM;
  const yBack = SO.COUPON.y; // drawn inside the coupon's solid, under its outline
  const yFront = SO.COUPON.y + SO.COUPON.d;
  const count = Math.floor(SO.PATCH / s + 1e-6) + 1; // the readout's pass count, one line each
  let d = lineOnTop([SO.SP[0], yBack], [SO.SP[0], SO.BUR_Y], SO.TOP, SO.P); // the pass being cut ends under the ball
  for (let i = 1; i < count; i++) d += lineOnTop([SO.SP[0] - i * s, yBack], [SO.SP[0] - i * s, yFront], SO.TOP, SO.P);
  // dense lines would merge into a dark slab: fade them as they crowd, so a finer finish reads lighter
  const pitch = s * soPx;
  const alpha = soClamp(0.14 + ((pitch - 0.4) / 2.1) * 0.86, 0.14, 1).toFixed(2);
  const markup = `<path class="iso-line" data-tone="lo" opacity="${alpha}" d="${d}"/>`;
  if (markup !== soLastPasses) {
    soPasses.innerHTML = markup;
    soLastPasses = markup;
  }
}

function soDrawTrace() {
  const { TRACE } = SO;
  const { tool, s, extent } = soState.scan;
  const d = TOOLS[tool].d;
  const span = (extent / SO.TRAVEL) * (TRACE.x1 - TRACE.x0);
  const n = Math.max(2, Math.ceil(span / 0.12));
  const zOf = (um) => -(TRACE.z0 + Math.min(1, um / TRACE.full) * (TRACE.z1 - TRACE.z0));
  let path = "";
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * span;
    const worldX = SO.STYLUS_X0 + (u / (TRACE.x1 - TRACE.x0)) * SO.TRAVEL;
    const um = profile(d, s, (worldX - SO.SP[0]) / SO.MM) * 1000;
    path += `${i ? "L" : "M"}${(TRACE.x0 + u).toFixed(2)} ${zOf(um).toFixed(2)}`;
  }
  soTrace.setAttribute("d", extent > 0.05 ? path : "");
  const h = ridge(d, s) * 1000;
  const text = extent > 0.05 ? `${h < 1 ? h.toFixed(2) : h.toFixed(1)} µm` : "";
  if (soValue.textContent !== text) soValue.textContent = text;
}

function soDraw() {
  const a = iso([soState.t, 0, 0], SO.P), b = iso([0, 0, 0], SO.P);
  const dx = a[0] - b[0], dy = a[1] - b[1];
  for (const el of soMoving) {
    el.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
    holdStill(el, [dx, dy]);
  }
  soDrawPasses();
  soDrawTrace();
  // the readout reads the drawn state, not the target
  const text = readoutOf(soState.tool, soRound(soState.shown));
  if (soReadout.textContent !== text) soReadout.textContent = text;
}

function soSetTool(tool) {
  if (tool === soState.tool) return;
  soState.tool = tool;
  for (const g of soSvg.querySelectorAll("[data-tool]")) g.style.display = g.dataset.tool === String(tool) ? "" : "none";
  soState.target = clampStep(tool, soState.want);
  soState.shown = soState.target; // a new ball is never drawn at the old ball's stepover
}

function soDescribe() {
  const set = (name, value) => { if (soStage.getAttribute(name) !== value) soStage.setAttribute(name, value); };
  set("aria-valuenow", soState.target.toFixed(2));
  set("aria-valuemin", String(TOOLS[soState.tool].step[0]));
  set("aria-valuemax", String(TOOLS[soState.tool].step[1]));
  set("aria-valuetext", wordsOf(soState.tool, soState.target));
}

const soScanned = () => soState.scan.tool === soState.tool && soState.scan.s === soState.target;

function soArmResume() {
  clearTimeout(soIdle);
  if (soStill.matches || soState.focused || soState.hovering) return;
  soIdle = setTimeout(() => { soState.touring = !soStill.matches && !soState.focused; soState.clock = 0; soRun(); }, 3600);
}

function soTick(now) {
  const dt = soLast ? Math.min((now - soLast) / 1000, 1 / 30) : 1 / 60;
  soLast = now;
  const calm = soStill.matches;
  if (soState.touring) {
    soState.clock += dt;
    const [tool, step] = TOUR[Math.floor(soState.clock / 7) % TOUR.length];
    if (tool !== soState.tool || step !== soState.want) {
      soState.want = step;
      soSetTool(tool);
      soState.target = clampStep(tool, step);
      soState.quietSince = now;
    }
  }
  soState.shown = calm ? soState.target : soState.shown + (soState.target - soState.shown) * (1 - Math.exp(-dt / 0.22));
  if (Math.abs(soState.shown - soState.target) < 1e-4) soState.shown = soState.target;
  const settled = soState.shown === soState.target;
  if (calm) {
    soState.t = SO.TRAVEL;
    soState.phase = "hold";
    soState.scan = { tool: soState.tool, s: soState.target, extent: SO.TRAVEL };
  } else if (soState.phase === "scan") {
    soState.t = Math.min(SO.TRAVEL, soState.t + dt * 10); // 1 mm/s
    soState.scan.extent = soState.t;
    if (soState.t >= SO.TRAVEL) {
      soState.phase = "hold";
      soState.wait = 1.4;
      if (!soState.touring) {
        soArmResume(); // the reader's own result stays up for the full idle wait
        const words = settledOf(soState.scan.tool, soState.scan.s);
        if (words !== soSaid) { soStatus.textContent = words; soSaid = words; }
      }
    }
  } else if (soState.phase === "back") {
    soState.t = Math.max(0, soState.t - dt * 30); // the last trace stays on screen while the stylus returns
    if (soState.t <= 0) {
      soState.phase = "scan";
      soState.scan = { tool: soState.tool, s: soState.target, extent: 0 };
    }
  }
  // rescan once the settings have settled and input has been quiet for a moment
  if (!calm && soState.phase !== "back" && settled && !soScanned() && now - soState.quietSince > 300) {
    if (soState.phase === "scan" && soState.t < 1) soState.scan = { tool: soState.tool, s: soState.target, extent: soState.t };
    else soState.phase = "back";
  }
  if (!calm && soState.touring && soState.phase === "hold" && soScanned()) {
    soState.wait -= dt;
    if (soState.wait <= 0) soState.phase = "back";
  }
  soDraw();
  const done = (calm || !soState.touring) && settled && soState.phase === "hold" && soScanned();
  soFrame = soVisible && !done ? requestAnimationFrame(soTick) : 0;
}
const soRun = () => { if (!soFrame && soVisible) { soLast = 0; soFrame = requestAnimationFrame(soTick); } };

function soTakeOver() {
  if (soState.touring) {
    // step from what the reader sees, not from the tour's next stop
    soState.touring = false;
    soState.want = soState.target = clampStep(soState.tool, soState.shown);
  }
  clearTimeout(soIdle);
}

function soSteer(tool, step) {
  soTakeOver();
  soSetTool(tool);
  soState.want = step;
  soState.target = clampStep(tool, step);
  soState.quietSince = performance.now();
  soDescribe();
  soRun();
}

function soFromPointer(event) {
  const box = soSvg.getBoundingClientRect();
  const share = soClamp(((event.clientX - box.left) / box.width - 0.2) / 0.6, 0, 1);
  const [lo, hi] = TOOLS[soState.tool].step;
  soSteer(soState.tool, lo + share * (hi - lo));
}

new IntersectionObserver((entries) => { soVisible = entries[entries.length - 1].isIntersecting; if (soVisible) soRun(); }, { rootMargin: "120px 0px" }).observe(soStage);

const soOnBur = (event) => Boolean(event.target.closest && event.target.closest('[data-name^="bur."]'));
soStage.addEventListener("pointerdown", (event) => {
  if (soOnBur(event)) { soSteer(soState.tool === 1 ? 2 : 1, soState.want); return; }
  if (event.pointerType === "touch") soStage.setPointerCapture?.(event.pointerId);
  soFromPointer(event);
});
soStage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" && !event.buttons) return;
  soState.hovering = event.pointerType !== "touch";
  soFromPointer(event);
});
soStage.addEventListener("pointerleave", () => { soState.hovering = false; soArmResume(); });
soStage.addEventListener("pointerup", (event) => { if (event.pointerType === "touch") soArmResume(); });
soStage.addEventListener("focus", () => { soState.focused = true; soTakeOver(); soDescribe(); soRun(); });
soStage.addEventListener("blur", () => { soState.focused = false; soArmResume(); });
soStage.addEventListener("keydown", (event) => {
  const tool = soState.tool;
  const [lo, hi] = TOOLS[tool].step;
  const step = event.shiftKey ? 0.05 : 0.01;
  const from = soState.touring ? clampStep(tool, soState.shown) : soState.target;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") soSteer(tool, from + step);
  else if (event.key === "ArrowLeft" || event.key === "ArrowDown") soSteer(tool, from - step);
  else if (event.key === "Home") soSteer(tool, lo);
  else if (event.key === "End") soSteer(tool, hi);
  else if (event.key === "1" || event.key === "2") soSteer(Number(event.key), soState.touring ? from : soState.want);
  else if (event.key === " " || event.key === "Enter") soSteer(tool === 1 ? 2 : 1, soState.touring ? from : soState.want);
  else return;
  event.preventDefault();
});
soStill.addEventListener("change", () => { soState.touring = !soStill.matches && !soState.focused; soRun(); });
const soSetHint = () => { if (soHint) soHint.textContent = soTouch.matches ? "Drag across · tap the bur" : "← → stepover · 1 2 ball"; };
soTouch.addEventListener("change", soSetHint);

soSetHint();
if (soStill.matches) { soState.touring = false; soState.t = SO.TRAVEL; soState.phase = "hold"; soState.scan.extent = SO.TRAVEL; }
soDescribe();
soDraw();
