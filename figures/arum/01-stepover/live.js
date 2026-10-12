const SO = __DATA__;
const soStage = document.querySelector(".so-stage");
const soSvg = soStage.querySelector("svg");
const soPasses = soSvg.querySelector('[data-part="passes"]');
const soTrace = soSvg.querySelector('[data-part="trace"]');
const soValue = soSvg.querySelector('[data-part="screen-value"]');
const soMoving = [...soSvg.querySelectorAll("[data-move]")];
const soReadout = document.querySelector("[data-readout]");
const soStatus = soStage.querySelector("[data-status]");
const soStill = matchMedia("(prefers-reduced-motion: reduce)");
const soClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const soState = {
  tool: TOUR[0][0],
  target: TOUR[0][1], // stepover the reader asked for, mm
  shown: TOUR[0][1], // eased stepover the drawing shows
  t: 0, // stylus traverse, world units 0..TRAVEL
  phase: "scan", // scan → hold → back
  wait: 0,
  touring: !soStill.matches,
  clock: 0,
  scans: 0,
};
let soFrame = 0, soLast = 0, soVisible = false, soIdle = 0, soLastPasses = "";

function soDrawPasses() {
  const s = soState.shown * SO.MM;
  const x0 = SO.COUPON.x + 0.6;
  const yBack = SO.COUPON.y; // drawn inside the coupon's solid, under its outline
  const yFront = SO.COUPON.y + SO.COUPON.d;
  let d = lineOnTop([SO.SP[0], yBack], [SO.SP[0], SO.BUR_Y], SO.TOP, SO.P); // the pass being cut ends under the ball
  for (let x = SO.SP[0] - s; x >= x0; x -= s) d += lineOnTop([x, yBack], [x, yFront], SO.TOP, SO.P);
  if (d !== soLastPasses) {
    soPasses.innerHTML = `<path class="iso-line" data-tone="faint" d="${d}"/>`;
    soLastPasses = d;
  }
}

function soDrawTrace() {
  const { TRACE } = SO;
  const d = TOOLS[soState.tool].d;
  const s = soState.shown;
  const span = (soState.t / SO.TRAVEL) * (TRACE.x1 - TRACE.x0);
  const n = Math.max(2, Math.ceil(span / 0.12));
  const zOf = (um) => -(TRACE.z0 + Math.min(1, um / TRACE.full) * (TRACE.z1 - TRACE.z0));
  let path = "";
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * span;
    const worldX = SO.STYLUS_X0 + (u / (TRACE.x1 - TRACE.x0)) * SO.TRAVEL;
    const mm = (worldX - SO.SP[0]) / SO.MM;
    const um = profile(d, s, mm) * 1000;
    path += `${i ? "L" : "M"}${(TRACE.x0 + u).toFixed(2)} ${zOf(um).toFixed(2)}`;
  }
  soTrace.setAttribute("d", soState.t > 0.05 ? path : "");
  const h = ridge(d, s) * 1000;
  const text = soState.t > 0.05 ? `${h < 1 ? h.toFixed(2) : h.toFixed(1)} µm` : "";
  if (soValue.textContent !== text) soValue.textContent = text;
}

function soDraw() {
  const [dx, dy] = (() => {
    const a = iso([soState.t, 0, 0], SO.P);
    const b = iso([0, 0, 0], SO.P);
    return [a[0] - b[0], a[1] - b[1]];
  })();
  for (const el of soMoving) {
    el.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
    holdStill(el, [dx, dy]);
  }
  soDrawPasses();
  soDrawTrace();
  const text = readoutOf(soState.tool, soState.target);
  if (soReadout.textContent !== text) soReadout.textContent = text;
}

function soSetTool(tool) {
  soState.tool = tool;
  for (const g of soSvg.querySelectorAll("[data-tool]")) g.style.display = g.dataset.tool === String(tool) ? "" : "none";
  soState.target = clampStep(tool, soState.target);
}

function soDescribe() {
  soStage.setAttribute("aria-valuenow", soState.target.toFixed(2));
  soStage.setAttribute("aria-valuetext", wordsOf(soState.tool, soState.target));
  soStage.setAttribute("aria-valuemax", String(TOOLS[soState.tool].step[1]));
}

function soRescan() {
  if (soState.phase === "scan" && soState.t < 1) return;
  soState.phase = "back";
}

function soTick(now) {
  const dt = soLast ? Math.min((now - soLast) / 1000, 1 / 30) : 1 / 60;
  soLast = now;
  const calm = soStill.matches;
  if (soState.touring) {
    soState.clock += dt;
    const [tool, step] = TOUR[Math.floor(soState.clock / 7) % TOUR.length];
    if (tool !== soState.tool || step !== soState.target) {
      if (tool !== soState.tool) soSetTool(tool);
      soState.target = step;
      soRescan();
    }
  }
  soState.shown = calm ? soState.target : soState.shown + (soState.target - soState.shown) * (1 - Math.exp(-dt / 0.22));
  if (Math.abs(soState.shown - soState.target) < 1e-4) soState.shown = soState.target;
  if (calm) {
    soState.t = SO.TRAVEL;
    soState.phase = "hold";
  } else if (soState.phase === "scan") {
    soState.t = Math.min(SO.TRAVEL, soState.t + dt * 10); // 1 mm/s
    if (soState.t >= SO.TRAVEL) { soState.phase = "hold"; soState.wait = 1.4; soState.scans++; }
  } else if (soState.phase === "hold") {
    soState.wait -= dt;
    if (soState.wait <= 0 && soState.touring) soState.phase = "back";
  } else if (soState.phase === "back") {
    soState.t = Math.max(0, soState.t - dt * 30);
    if (soState.t <= 0) soState.phase = "scan";
  }
  soDraw();
  const settled = !soState.touring && soState.shown === soState.target && soState.phase === "hold";
  soFrame = soVisible && !settled ? requestAnimationFrame(soTick) : 0;
}
const soRun = () => { if (!soFrame && soVisible) { soLast = 0; soFrame = requestAnimationFrame(soTick); } };

function soSteer(tool, step) {
  soState.touring = false;
  if (tool !== soState.tool) soSetTool(tool);
  const next = clampStep(tool, step);
  if (next !== soState.target) { soState.target = next; soRescan(); }
  soDescribe();
  clearTimeout(soIdle);
  soIdle = setTimeout(() => { soState.touring = !soStill.matches; soState.clock = 0; soRun(); }, 3600);
  clearTimeout(soSteer.say);
  soSteer.say = setTimeout(() => { soStatus.textContent = wordsOf(soState.tool, soState.target); }, 700);
  soRun();
}

new IntersectionObserver((entries) => { soVisible = entries[entries.length - 1].isIntersecting; if (soVisible) soRun(); }, { rootMargin: "120px 0px" }).observe(soStage);

soStage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  const box = soSvg.getBoundingClientRect();
  const share = soClamp(((event.clientX - box.left) / box.width - 0.2) / 0.6, 0, 1);
  const [lo, hi] = TOOLS[soState.tool].step;
  soSteer(soState.tool, lo + share * (hi - lo));
});
soStage.addEventListener("click", () => soSteer(soState.tool === 1 ? 2 : 1, soState.target));
soStage.addEventListener("keydown", (event) => {
  const [lo, hi] = TOOLS[soState.tool].step;
  const step = event.shiftKey ? 0.05 : 0.01;
  let tool = soState.tool, s = soState.target;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") s += step;
  else if (event.key === "ArrowLeft" || event.key === "ArrowDown") s -= step;
  else if (event.key === "Home") s = lo;
  else if (event.key === "End") s = hi;
  else if (event.key === "1") tool = 1;
  else if (event.key === "2") tool = 2;
  else return;
  event.preventDefault();
  soSteer(tool, s);
});

soSetTool(soState.tool);
if (soStill.matches) { soState.touring = false; soState.t = SO.TRAVEL; soState.phase = "hold"; }
soDescribe();
soDraw();
