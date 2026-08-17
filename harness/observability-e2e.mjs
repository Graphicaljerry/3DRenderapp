// What the app does when nobody is asserting on it: console noise, rejections nothing
// catches, requests that fail, memory that only goes up, and how long the boot really is.
//
// These are the things a feature probe never sees, because a feature probe asks "did the
// button work" and stops. Every threshold here is a number this app currently meets — so
// a failure means something changed, not that the bar was set optimistically.
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild } from "./enter.mjs";

const BASE = `http://localhost:${process.env.PORT ?? 5173}/`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const consoleErrors = [];
const consoleWarns = [];
const pageErrors = [];
const failedReqs = [];
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") consoleErrors.push(m.text());
  if (t === "warning") consoleWarns.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
page.on("requestfailed", (r) => failedReqs.push(`${r.method()} ${r.url().slice(0, 90)} — ${r.failure()?.errorText}`));

// The app has no `unhandledrejection` listener of its own (verified in the audit), so
// nothing in the app would ever surface one. Plant one here — a rejection that reaches
// the window is by definition one no code path handled.
await page.addInitScript(() => {
  window.__rejections = [];
  addEventListener("unhandledrejection", (e) => {
    window.__rejections.push(String(e.reason?.message ?? e.reason));
  });
  localStorage.setItem("moldable_signin_prompted", "1");
  localStorage.setItem("moldable_theme", "dark");
});

const t0 = Date.now();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launchpad, .topbar", { timeout: 60_000 });
const tShell = Date.now() - t0;
await enterWorkspace(page);
const tWorkspace = Date.now() - t0;

// ---- boot timings, from the app's own performance entries ----
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return n ? { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transfer: n.transferSize } : null;
});
console.log(`  timings: shell ${tShell} ms · workspace ${tWorkspace} ms · DCL ${nav?.dcl} ms · load ${nav?.load} ms`);
check("the shell paints in under 8 s", tShell < 8000, `${tShell} ms`);
check("the workspace is reachable in under 25 s", tWorkspace < 25_000, `${tWorkspace} ms`);

// ---- build a real part, so the kernel and the viewer are exercised ----
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle(/^Build the phone stand\b/).click();
await awaitBuild(page);
const tBuilt = Date.now() - t0;
console.log(`  first model on screen at ${tBuilt} ms`);
await page.waitForTimeout(1500);

// ---- memory: does a session of ordinary use leak? ----
const heap = () => page.evaluate(() => (performance).memory?.usedJSHeapSize ?? 0);
const mem0 = await heap();
// Ordinary use: orbit, open and close each inspector section, toggle theme twice.
const cv = await page.locator(".viewerCanvas canvas").boundingBox();
for (let i = 0; i < 3; i++) {
  await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
  await page.mouse.down();
  for (let a = 0; a < 12; a++) await page.mouse.move(cv.x + cv.width / 2 + a * 12, cv.y + cv.height / 2 + a * 4);
  await page.mouse.up();
  for (const label of ["Adjust", "History", "Printability", "Source"]) {
    const b = page.locator(".dock-list").getByRole("button", { name: label, exact: true });
    if (await b.count()) { await b.click(); await page.waitForTimeout(180); }
  }
}
await page.evaluate(() => (globalThis).gc?.());
await page.waitForTimeout(1200);
const mem1 = await heap();
const growthMB = (mem1 - mem0) / 1048576;
console.log(`  heap ${(mem0 / 1048576).toFixed(1)} MB → ${(mem1 / 1048576).toFixed(1)} MB`);
check("a session of orbiting and panel-switching does not balloon the heap", growthMB < 120, `${growthMB.toFixed(1)} MB growth`);

// ---- the quiet failures ----
const rejections = await page.evaluate(() => window.__rejections ?? []);
check("no unhandled promise rejections", rejections.length === 0, rejections.slice(0, 3).join(" | "));
check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

// Ollama is probed on purpose and is expected to be absent here — that connection refusal
// is the app checking for a local model server, not a defect. Everything else is.
const isOllama = (s) => /11434/.test(s);
const realFailedReqs = failedReqs.filter((r) => !isOllama(r));
check("no failed requests beyond the local-Ollama probe", realFailedReqs.length === 0,
  realFailedReqs.slice(0, 3).join(" | ") || `${failedReqs.length} ollama probe(s) ignored`);

// The Ollama probe itself: it should happen once per load, not repeatedly. More than a
// couple means an effect is re-running and quietly hammering localhost.
const ollamaHits = failedReqs.filter(isOllama).length;
console.log(`  ollama probe attempts this session: ${ollamaHits}`);
check("the Ollama probe does not run away", ollamaHits <= 4, `${ollamaHits} attempts`);

const realConsoleErrors = consoleErrors.filter((e) => !isOllama(e) && !/Failed to load resource/.test(e));
check("no console errors", realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(" | "));
if (consoleWarns.length) console.log(`  (${consoleWarns.length} console warnings, not gated: ${consoleWarns.slice(0, 2).join(" | ").slice(0, 160)})`);

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ nothing noisy, nothing leaking, nothing unhandled");
await browser.close();
process.exit(fails.length ? 1 : 0);
