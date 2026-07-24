// One-shot: capture the bare 3D canvas (no DOM overlays) at the Figma frame's
// 1210×831 aspect for use as the viewer mockup fill in the design file.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const THEME = process.env.THEME === "light" ? "light" : "dark";
await page.addInitScript((t) => { localStorage.setItem("moldable_entered", "1"); localStorage.setItem("moldable_theme", t); }, THEME);
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

// Empty chat shows the TemplateStrip — tap Phone stand (fall back to the Templates modal)
try {
  await page.getByRole("button", { name: /phone stand/i }).first().click({ timeout: 8000 });
} catch {
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: /phone stand/i }).first().click({ timeout: 8000 });
}
await page.waitForFunction(() => /\d+(\.\d+)? × \d+(\.\d+)? × \d+(\.\d+)?/.test(document.querySelector(".statusbar .dims")?.textContent || ""), null, { timeout: 120_000 });
await page.waitForTimeout(1000);

// Pure canvas: hide every DOM overlay that floats on the viewer
await page.addStyleTag({ content: ".canvas-rail,.zoom-ctl,.view-snaps,.mesh-stats,.plate-bar,.sel-inspector,.layers-panel{display:none!important}" });
await page.waitForTimeout(300);
const canvas = page.locator(".viewer canvas").first();
const box = await canvas.boundingBox();
const out = THEME === "light" ? "harness/canvas-clean-light.png" : "harness/canvas-clean.png";
await canvas.screenshot({ path: out });
await browser.close();
console.log("saved " + out, JSON.stringify(box));
