// Do saves to the three big files hot-update, or do they reload the page?
//
// A reload here is not cosmetic: it discards the model on screen and re-warms ~11 MB of
// OCCT wasm, on every keystroke-save, for the whole session. Three files had non-component
// exports that broke their React Refresh boundary — App.tsx (DEFAULT_USER_TINT,
// BUBBLE_TINTS), Viewer.tsx (faceBoundary, buildSolidPrism) and Workspace.tsx
// (FILAMENT_SWATCHES) — and because a rejected boundary propagates upward to main.tsx,
// which has no exports at all, the fallback was always a full page reload.
//
// Measured, not asserted from the stylesheet: touch the file, then ask whether the
// DOCUMENT survived. A marker planted on window before the edit is the whole test — it
// only survives a hot update.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = `http://localhost:${process.env.PORT ?? 5173}/`;
const SRC = join(process.cwd(), "..", "moldable-lite", "src");
const TARGETS = [
  ["App.tsx", join(SRC, "App.tsx")],
  ["components/Workspace.tsx", join(SRC, "components", "Workspace.tsx")],
  ["components/Viewer.tsx", join(SRC, "components", "Viewer.tsx")],
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

let navigations = 0;
page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations++; });
await page.addInitScript(() => { localStorage.setItem("moldable_signin_prompted", "1"); });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launchpad, .topbar", { timeout: 60_000 });
await page.waitForTimeout(1500);

for (const [label, file] of TARGETS) {
  const before = navigations;
  const original = readFileSync(file, "utf8");
  await page.evaluate(() => { window.__hmrMarker = "alive"; });
  // A comment-only edit: enough for vite to rebuild and push an update, with no chance
  // of changing behaviour if anything goes wrong mid-run.
  writeFileSync(file, `${original}\n// hmr probe touch\n`);
  await page.waitForTimeout(3500);
  writeFileSync(file, original);
  await page.waitForTimeout(2500);

  const survived = await page.evaluate(() => window.__hmrMarker === "alive").catch(() => false);
  const navs = navigations - before;
  check(`saving ${label} hot-updates instead of reloading`, survived && navs === 0,
    `marker ${survived ? "survived" : "LOST"}, ${navs} navigation(s)`);
}

// And the symptom that made this findable in the first place.
const dupRoot = await page.evaluate(() => window.__sawDuplicateRootWarning === true);
check("no duplicate createRoot warning", !dupRoot);

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all three files are live Fast Refresh boundaries");
await browser.close();
process.exit(fails.length ? 1 : 0);
