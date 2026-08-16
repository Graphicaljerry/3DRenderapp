// Viewer frame-cost probe. Loads a model, performs a scripted orbit drag, and reports
// per-frame timing plus a breakdown of what the frame is spending time on. Used to
// tune the viewer's render loop for WKWebView (the Mac app), where compositing an
// animating canvas UNDER blurred overlays costs far more than it does in Chrome.
//
//   node viewer-frames.mjs                 # default: box-with-lid template
//   node viewer-frames.mjs --heavy         # dense mesh (subdivided sphere ~200k tris)
//   node viewer-frames.mjs --blur          # force-restore backdrop blur (A/B the fix)
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild } from "./enter.mjs";

const HEAVY = process.argv.includes("--heavy");
const FORCE_BLUR = process.argv.includes("--blur");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  // Real GPU compositing so the numbers mean something (headless defaults to SwiftShader).
  args: ["--enable-gpu", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
await awaitBuild(page);
await page.waitForSelector(".viewerCanvas canvas");

if (HEAVY) {
  // Swap in a dense mesh through the same path an AI mesh takes.
  await page.evaluate(async () => {
    const THREE = await import("three");
    const g = new THREE.SphereGeometry(30, 320, 320); // ~200k triangles
    window.__viewerTestGeometry?.(g);
  });
  await page.waitForTimeout(1500);
}

if (FORCE_BLUR) {
  await page.addStyleTag({ content: `.mesh-stats,.zoom-ctl,.view-snaps,.plate-bar,.box-hint{backdrop-filter:blur(6px)!important;-webkit-backdrop-filter:blur(6px)!important}` });
}

const box = await page.locator(".viewerCanvas canvas").boundingBox();

// ---- Idle cost, measured BEFORE any interaction. (After a drag, OrbitControls'
// inertia decays 5% per FRAME, so at this container's software-GL rate the glide
// legitimately runs for many seconds — that's motion, not waste.) With
// render-on-demand a still scene should draw only the ~2/s heartbeat.
await page.evaluate(() => {
  const c = document.querySelector(".viewerCanvas canvas");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  window.__draws = 0;
  const real = gl.drawElements.bind(gl);
  gl.drawElements = (...a) => { window.__draws++; return real(...a); };
  const realA = gl.drawArrays.bind(gl);
  gl.drawArrays = (...a) => { window.__draws++; return realA(...a); };
});
await page.waitForTimeout(1500); // let the opening camera framing settle
await page.evaluate(() => {
  window.__draws = 0;
  for (const k of Object.keys(window.__viewerStats ?? {})) window.__viewerStats[k] = 0;
});
await page.waitForTimeout(2000);
const idleDraws = await page.evaluate(() => window.__draws);
const stats = await page.evaluate(() => window.__viewerStats);
console.log(`\nidle 2s (untouched): ${idleDraws} GL draw calls · frames drawn ${stats?.drawn} / skipped ${stats?.skipped}`);
console.log(`  why drawn: camera-moving ${stats?.moving} · dirty ${stats?.dirty} · pending-input ${stats?.owed} · heartbeat ${stats?.beat}`);

// Instrument rAF: record frame deltas + the JS time spent inside each frame.
await page.evaluate(() => {
  window.__frames = [];
  const raf = window.requestAnimationFrame.bind(window);
  let prev = performance.now();
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const start = performance.now();
      cb(t);
      const end = performance.now();
      window.__frames.push({ delta: start - prev, js: end - start });
      prev = start;
    });
});

// Scripted orbit: a steady 2-second drag across the viewport.
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.down();
await page.evaluate(() => { window.__frames.length = 0; }); // measure the drag only
const STEPS = 120;
for (let i = 0; i < STEPS; i++) {
  const a = (i / STEPS) * Math.PI * 2;
  await page.mouse.move(box.x + box.width * 0.5 + Math.cos(a) * 180, box.y + box.height * 0.5 + Math.sin(a) * 110);
  await page.waitForTimeout(8);
}
await page.mouse.up();

const frames = await page.evaluate(() => window.__frames);
const js = frames.map((f) => f.js).sort((a, b) => a - b);
const delta = frames.map((f) => f.delta).filter((d) => d > 0 && d < 200).sort((a, b) => a - b);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : NaN);
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN);

const dpr = await page.evaluate(() => {
  const c = document.querySelector(".viewerCanvas canvas");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  const a = gl.getContextAttributes();
  return { drawing: [c.width, c.height], css: [c.clientWidth, c.clientHeight], alpha: a.alpha, antialias: a.antialias, preserveDrawingBuffer: a.preserveDrawingBuffer };
});

console.log(`\nmodel: ${HEAVY ? "heavy mesh" : "box with lid"}${FORCE_BLUR ? " · blur forced ON" : ""}`);
console.log(`canvas: ${dpr.drawing.join("×")} device px (${dpr.css.join("×")} css) · alpha=${dpr.alpha} aa=${dpr.antialias} preserve=${dpr.preserveDrawingBuffer}`);
console.log(`frames measured: ${frames.length}`);
console.log(`frame interval  mean ${mean(delta).toFixed(2)}ms · p50 ${pct(delta, 0.5).toFixed(2)} · p95 ${pct(delta, 0.95).toFixed(2)} → ${(1000 / mean(delta)).toFixed(0)} fps`);
console.log(`js per frame    mean ${mean(js).toFixed(2)}ms · p50 ${pct(js, 0.5).toFixed(2)} · p95 ${pct(js, 0.95).toFixed(2)} · max ${pct(js, 1).toFixed(2)}`);

await browser.close();
