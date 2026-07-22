// PWA e2e against the PRODUCTION build (vite preview): manifest served, service
// worker installs and precaches, then the app — including the OCCT CAD kernel —
// boots with the network fully OFF. Plus: numeric-only build stamp.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], {
  cwd: "/home/user/3DRenderapp/moldable-lite",
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:4173/", { waitUntil: "load" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

// 1) Numeric build stamp.
const tag = await page.locator(".build-tag").innerText();
check("build stamp is strictly numeric", /^v\d+$/.test(tag.trim()), JSON.stringify(tag));

// 2) Manifest is linked and valid.
const manifestHref = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href"));
check("manifest linked", !!manifestHref, String(manifestHref));
const manifest = await page.evaluate(async (href) => {
  const r = await fetch(href);
  return r.ok ? r.json() : null;
}, manifestHref);
check("manifest valid: standalone + icons + maskable", manifest?.display === "standalone" && manifest?.icons?.length >= 3 && manifest.icons.some((i) => i.purpose === "maskable"), JSON.stringify({ name: manifest?.name, icons: manifest?.icons?.length }));
const iconOk = await page.evaluate(async () => (await fetch("/icons/icon-512.png")).ok);
check("icons served", iconOk);

// 3) Service worker installs and controls the page.
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: reg.scope, active: !!reg.active };
});
check("service worker active", swState.active, swState.scope);
// Give precache a moment to finish writing (13.5 MB incl. the OCCT wasm).
await page.waitForFunction(async () => {
  const keys = await caches.keys();
  if (!keys.length) return false;
  const c = await caches.open(keys.find((k) => k.includes("precache")) ?? keys[0]);
  return (await c.keys()).length >= 15;
}, null, { timeout: 60_000 });
const cached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const c = await caches.open(keys.find((k) => k.includes("precache")) ?? keys[0]);
  const urls = (await c.keys()).map((r) => r.url);
  return { count: urls.length, hasWasm: urls.some((u) => u.endsWith(".wasm")) };
});
check("precache holds the app incl. the CAD kernel wasm", cached.count >= 15 && cached.hasWasm, JSON.stringify(cached));

// 4) Full offline: kill the network, reload, the app AND the OCCT engine boot.
await ctx.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
check("offline: app shell boots from cache", true);
const engine = await page.evaluate(async () => {
  const mod = await import("/src/engine/selectEngine.ts").catch(() => null);
  return null; // dev-only path; production asserts via the topbar badge below
}).catch(() => null);
await page.waitForFunction(() => document.body.innerText.includes("Engine · replicad"), null, { timeout: 120_000 });
check("offline: OCCT kernel loads from cache (Engine · replicad)", true);
// Build a template offline — the whole local CAD path works with no network.
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the Washer / spacer template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.toLowerCase().includes("washer"), null, { timeout: 120_000 });
check("offline: template builds a real model (no network)", true);
await page.screenshot({ path: "shot-pwa-offline.png" });

await browser.close();
preview.kill();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll PWA checks passed.");
