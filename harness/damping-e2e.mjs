// Frame-rate independence of the viewer's orbit damping.
//
// OrbitControls applies damping once per update() CALL — `theta += delta * f` then
// `delta *= (1 - f)` — with no notion of elapsed time. So the camera's catch-up speed
// is tied to the frame RATE, not the clock: halve the frame rate and the same gesture
// takes twice the wall-clock time to settle, visibly trailing the cursor. That is the
// Mac-app-vs-web drag gap on a ProMotion panel.
//
// This drives an identical orbit at two frame rates and measures how long the camera
// takes to cover 90% of its post-release coast. That number should be a CONSTANT. Under
// a per-call damper it scales with the frame period instead.
//
// Two notes on method:
//   - setInterval cannot synthesize a true 120Hz clock (it lands around 74Hz under
//     load), so this compares 60Hz against 20Hz. A 3x spread is a strictly harder test
//     of the same invariant than the 2x spread it stands in for.
//   - "Settled" means 90% of the coast travelled, not OrbitControls' numeric rest.
//     Its residual decays to a 1e-6 epsilon, which takes ~1.3s of imperceptible drift
//     at any frame rate and tells you nothing about how the drag feels.
//
//   node damping-e2e.mjs
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild } from "./enter.mjs";

const FAST = 60;
const SLOW = 20;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

// A requestAnimationFrame we can clock, installed before any app code captures it. The
// fix keys off REAL measured dt, so this timer's jitter is handled correctly — the
// harness reports the rate it actually achieved rather than the one it asked for.
await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  const native = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  let queue = new Map();
  let id = 0;
  let timer = null;
  let hz = 0;
  const pump = () => {
    if (!queue.size) return;
    const due = queue;
    queue = new Map();
    const t = performance.now();
    for (const cb of due.values()) { try { cb(t); } catch { /* the app's problem, not the clock's */ } }
  };
  window.requestAnimationFrame = (cb) => {
    if (!hz) return native(cb);
    const k = ++id;
    queue.set(k, cb);
    return k;
  };
  window.cancelAnimationFrame = (k) => { if (!hz) return nativeCancel(k); queue.delete(k); };
  window.__setFrameRate = (next) => {
    hz = next;
    if (timer) { clearInterval(timer); timer = null; }
    if (hz) timer = setInterval(pump, 1000 / hz);
  };
  window.__measureRate = () => new Promise((resolve) => {
    let n = 0, t0 = 0;
    const step = (t) => {
      if (!t0) t0 = t;
      if (++n < 30) return void requestAnimationFrame(step);
      resolve(Math.round(((n - 1) * 1000) / (t - t0)));
    };
    requestAnimationFrame(step);
  });
});

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
await awaitBuild(page);
await page.waitForSelector(".viewerCanvas canvas");
await page.waitForFunction(() => typeof window.__viewerCam === "function", null, { timeout: 20_000 });

const box = await page.locator(".viewerCanvas canvas").boundingBox();
const cx = Math.round(box.x + box.width / 2);
const cy = Math.round(box.y + box.height / 2);

// Record the coast trajectory inside the page, so samples aren't paced by CDP
// round-trips, then derive the time to 90% of total travel.
//
// The window is a FIXED wall-clock 1200ms rather than "until the camera stops". A
// stop detector needs an absolute movement threshold, and the two runs release with
// very different residual velocities, so the same threshold truncates the gentler
// curve early and reports a falsely short coast. A fixed window is unbiased, and t90
// is normalised against each run's OWN total travel, so the magnitude gap is harmless.
const COAST_MS = 1200;
const coast = () => page.evaluate((win) => new Promise((resolve) => {
  const t0 = performance.now();
  const start = window.__viewerCam().slice(0, 3);
  const samples = [];
  // Average the damping factor across the first 300ms — the stretch where the loop is
  // drawing every frame, so dt is a true frame period. A single instantaneous read
  // taken after the coast is just timer noise: the loop has gone idle by then.
  let dampSum = 0;
  let dampN = 0;
  const tick = () => {
    const c = window.__viewerCam();
    const now = performance.now();
    if (now - t0 < 300 && c[3]) { dampSum += c[3]; dampN++; }
    samples.push([now - t0, Math.hypot(c[0] - start[0], c[1] - start[1], c[2] - start[2])]);
    if (now - t0 >= win) {
      const total = samples[samples.length - 1][1];
      const hit = samples.find((s) => s[1] >= total * 0.9);
      return resolve({ t90: hit ? Math.round(hit[0]) : -1, total: +total.toFixed(3), damp: dampN ? dampSum / dampN : 0 });
    }
    setTimeout(tick, 5);
  };
  setTimeout(tick, 5);
}), COAST_MS);

async function run(hz) {
  await page.evaluate((n) => window.__setFrameRate(n), hz);
  await page.waitForTimeout(500);
  const actual = await page.evaluate(() => window.__measureRate());
  // One identical gesture. Paced at 40ms/step so even the 20Hz clock gets ~10 frames
  // during the drag — few enough frames and the slow run is still accelerating at
  // release, which would compare two different physical situations.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx + i * 8, cy + i * 3);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  const c = await coast();
  return { hz, actual, ...c };
}

const fast = await run(FAST);
const slow = await run(SLOW);
await page.evaluate(() => window.__setFrameRate(0));

const fmt = (r) => `${String(r.hz).padStart(3)}Hz clock → ${String(r.actual).padStart(3)}Hz measured, 90% of coast in ${String(r.t90).padStart(4)}ms (travel ${r.total}, damping ${r.damp.toFixed(4)})`;
console.log(`\n  ${fmt(fast)}\n  ${fmt(slow)}\n`);

check("A1 the two clocks really do differ", fast.actual > slow.actual * 2, `${fast.actual}Hz vs ${slow.actual}Hz`);
check("A2 both gestures actually moved the camera", fast.total > 1 && slow.total > 1, `${fast.total} / ${slow.total}`);
check("A3 both coasts were measured", fast.t90 > 0 && slow.t90 > 0, `${fast.t90}ms / ${slow.t90}ms`);
// The whole point: a 3x slower clock must NOT stretch the trail 3x.
const ratio = slow.t90 / Math.max(fast.t90, 1);
check("A4 coast time is frame-rate independent", ratio < 1.5,
  `the ${slow.actual}Hz run took ${ratio.toFixed(2)}x the ${fast.actual}Hz run (a per-call damper would be ~${(fast.actual / slow.actual).toFixed(1)}x)`);
// The compensation is visible in the factor itself: slower frames must damp harder.
check("A5 the damping factor scales with frame time", slow.damp > fast.damp * 1.8,
  `${slow.damp.toFixed(4)} at ${slow.actual}Hz vs ${fast.damp.toFixed(4)} at ${fast.actual}Hz`);
check("A6 the coast stays in a hand-feel window", fast.t90 < 900 && slow.t90 < 900, `${fast.t90}ms / ${slow.t90}ms`);

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("All damping checks passed.");
