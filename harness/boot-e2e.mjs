// First-load pipeline checks for the bundle/first-paint work:
//  A. the entry paints a boot splash while the (deliberately slowed) app chunk loads,
//     then the real app replaces it — no blank screen, theme backdrop correct;
//  B. the OCCT wasm fetch is DEFERRED until after the page has painted/loaded
//     (post-paint idle warm-up), yet still arrives without any user action;
//  C. acting BEFORE the deferred warm-up (instant "Try the built-in example")
//     preempts it via ensureEngine() — the example builds, no "try again" bounce.
import { chromium } from "playwright";

const results = [];
const check = (name, ok, note = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---------- A: splash shows while the app chunk is slow ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // Slow ONLY the App module so the Suspense fallback window is observable.
  await page.route("**/src/App.tsx*", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    route.continue();
  });
  await page.goto("http://localhost:5173/");
  let sawSplash = false;
  try {
    await page.waitForSelector(".boot-splash", { timeout: 3000, state: "attached" });
    sawSplash = true;
  } catch { /* app won the race — handled below */ }
  check("A1 boot splash renders while the app chunk loads", sawSplash);
  await page.waitForSelector(".boot-splash", { state: "detached", timeout: 20000 });
  const appUp = await page.waitForSelector("text=Moldable", { timeout: 20000 }).then(() => true).catch(() => false);
  check("A2 app replaces the splash", appUp);
  await page.close();
}

// ---------- B: wasm fetch deferred past first paint (no interaction) ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // A returning free-mode user boots straight into the workspace (worst case: the
  // old code fired the 11 MB kernel fetch at mount).
  await page.addInitScript(() => {
    localStorage.setItem("moldable_entered", "1");
    window.__wasmAt = 0;
    window.__uiAt = 0;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (String(e.name).includes("replicad_single") && !window.__wasmAt) window.__wasmAt = performance.now();
      }
    });
    po.observe({ entryTypes: ["resource"] });
    // When did the app actually put UI on screen? (headless software-GL Chromium
    // doesn't emit paint entries, so anchor to the React mount instead)
    const mo = new MutationObserver(() => {
      const root = document.getElementById("root");
      if (root && root.childElementCount > 0 && !window.__uiAt) {
        window.__uiAt = performance.now();
        mo.disconnect();
      }
    });
    addEventListener("DOMContentLoaded", () => mo.observe(document.getElementById("root"), { childList: true }));
  });
  await page.goto("http://localhost:5173/");
  await page.waitForFunction(() => window.__wasmAt > 0, { timeout: 30000 });
  const { wasmAt, uiAt, loadEnd } = await page.evaluate(() => ({
    wasmAt: window.__wasmAt,
    uiAt: window.__uiAt,
    loadEnd: performance.getEntriesByType("navigation")[0]?.loadEventEnd ?? -1,
  }));
  check("B1 UI was on screen before the kernel wasm was requested", uiAt > 0 && wasmAt > uiAt, `ui=${Math.round(uiAt)}ms wasm=${Math.round(wasmAt)}ms`);
  check("B2 wasm waits for the load event (idle warm-up)", loadEnd > 0 && wasmAt >= loadEnd, `load=${Math.round(loadEnd)}ms wasm=${Math.round(wasmAt)}ms`);
  // ...and the warm-up must actually finish: the engine pill reports the kernel.
  const engineReady = await page
    .waitForFunction(() => document.body.textContent.includes("Engine · replicad"), { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  check("B3 kernel finishes warming with no interaction", engineReady);
  await page.close();
}

// ---------- C: instant action preempts the deferred warm-up ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:5173/");
  // Click the example link the moment it exists — before idle warm-up.
  await page.click("text=built-in example", { timeout: 15000 });
  const built = await page
    .waitForFunction(() => document.body.textContent.includes("Example L-bracket") || document.body.textContent.includes("L-bracket"), { timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  check("C1 example builds when clicked before the deferred boot", built);
  const bounced = await page.evaluate(() => document.body.textContent.includes("still starting"));
  check("C2 no 'engine still starting' bounce", !bounced);
  await page.close();
}

await browser.close();
console.log(results.every(Boolean) ? "\nAll boot checks passed." : "\nSOME BOOT CHECKS FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
