// Dims-on-select e2e: the gray bounding box + size lines follow SELECTION now.
// Default "On select": clean canvas until you click the object; click empty space →
// clean again. "Always" restores the old permanent box; "Off" kills it. Persisted.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the box with lid template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("box"), null, { timeout: 120_000 });
await page.waitForTimeout(900);

const canvas = page.locator(".viewerCanvas canvas");
const box = await canvas.boundingBox();
const selected = async () => (await page.evaluate(() => document.querySelector('[aria-label="Transform"]')?.getAttribute("aria-pressed"))) === "true";

// Count pixels matching a colour (tolerance per channel) in a canvas screenshot.
const colorCount = async (rgb, tol = 12) => {
  const b64 = (await canvas.screenshot()).toString("base64");
  return page.evaluate(async ({ b64, rgb, tol }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - rgb[0]) < tol && Math.abs(d[i + 1] - rgb[1]) < tol && Math.abs(d[i + 2] - rgb[2]) < tol) n++;
    }
    return n;
  }, { b64, rgb, tol });
};
const DIM_LINE = [0x33, 0x56, 0x6b]; // dimension lines/ticks (slate-teal)
const SEL_TEAL = [0x14, 0xb8, 0xa6]; // selection box + anchors

// 1) Default mode = "select": nothing selected → NO dims box, no size lines.
const dims0 = await colorCount(DIM_LINE);
check("clean canvas by default (no gray box)", dims0 < 60, `${dims0} dim px`);

// 2) Click the object → selection box + dims appear around it.
let sel = false;
for (const pos of [[0.38, 0.5], [0.32, 0.55], [0.45, 0.45], [0.62, 0.72]]) {
  await canvas.click({ position: { x: box.width * pos[0], y: box.height * pos[1] } });
  await page.waitForTimeout(350);
  if (await selected()) { sel = true; break; }
}
check("clicking the object selects it", sel);
const dimsSel = await colorCount(DIM_LINE);
const tealSel = await colorCount(SEL_TEAL);
check("selection shows the bounding box + size lines", dimsSel > dims0 + 120 && tealSel > 50, `dims ${dims0} → ${dimsSel}px, sel box ${tealSel}px`);
await page.screenshot({ path: "shot-dims-selected.png" });

// 3) Click empty space → everything hides again.
await canvas.click({ position: { x: box.width * 0.07, y: box.height * 0.28 } });
await page.waitForTimeout(350);
check("empty click deselects", !(await selected()));
const dimsOff = await colorCount(DIM_LINE);
const tealOff = await colorCount(SEL_TEAL);
check("box + size lines hide on deselect", dimsOff < 60 && tealOff < 20, `dims ${dimsOff}px, sel ${tealOff}px`);
await page.screenshot({ path: "shot-dims-deselected.png" });

// 4) View ▾ → Dimensions "Always" → permanent box with nothing selected (old behaviour).
await page.locator('button[title^="View options"]').click();
await page.getByRole("radio", { name: "Always" }).click();
await page.keyboard.press("Escape");
await page.waitForTimeout(350);
const dimsAlways = await colorCount(DIM_LINE);
check("'Always' restores the permanent box", dimsAlways > dimsOff + 120, `${dimsOff} → ${dimsAlways} dim px`);

// 5) "Off" → never.
await page.locator('button[title^="View options"]').click();
await page.getByRole("radio", { name: "Off" }).click();
await page.keyboard.press("Escape");
await page.waitForTimeout(350);
const dimsNever = await colorCount(DIM_LINE);
check("'Off' hides it entirely", dimsNever < 60, `${dimsNever} dim px`);

// 6) Choice persists across reload.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.waitForTimeout(1200);
await page.locator('button[title^="View options"]').click();
const offChecked = await page.getByRole("radio", { name: "Off" }).getAttribute("aria-checked");
check("mode persists across reload", offChecked === "true");
await page.keyboard.press("Escape");

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll dims checks passed.");
