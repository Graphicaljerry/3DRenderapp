// Measure v2 + composer e2e, on the coaster template from Top view:
// 1. Composer textarea wraps/grows; Shift+Enter = newline.
// 2. Hole tool drills an EXACT ⌀7 through-hole (deterministic, no AI).
// 3. Drag-a-line measure with vertex snap reads that hole as 7 mm.
// 4. Classic two-click measure still works.
// 5. Measurement labels stay small when zoomed way in (max-px clamp).
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
await page.locator(".overlay").getByTitle("Build the coaster template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.toLowerCase().includes("coaster"), null, { timeout: 120_000 });
await page.waitForTimeout(800);

// ---- 1) Composer wraps: long text grows the box; Shift+Enter adds a line. ----
const ta = page.getByPlaceholder(/Describe a part/);
const h0 = await ta.evaluate((el) => el.clientHeight);
await ta.fill("make the rim a little taller and rounder, add a drainage channel around the inside edge, and emboss my initials JR on the bottom face so they show when it is flipped over");
await page.waitForTimeout(150);
const h1 = await ta.evaluate((el) => el.clientHeight);
check("composer grows to show long text", h1 > h0 + 14, `${h0}px → ${h1}px`);
await ta.press("Shift+Enter");
await ta.type("second line");
const val = await ta.inputValue();
check("Shift+Enter inserts a newline", val.includes("\n"));
const h2 = await ta.evaluate((el) => el.clientHeight);
check("wrapped text is fully visible (no overflow)", await ta.evaluate((el) => el.scrollHeight <= el.clientHeight + 2) || h2 >= 130, `client ${h2}`);
await ta.fill("");
await page.waitForTimeout(120);
check("composer shrinks back when cleared", (await ta.evaluate((el) => el.clientHeight)) <= h0 + 2);

// ---- 2) Top view, drill an exact ⌀7 hole in the middle of the coaster. ----
const canvas = page.locator(".viewerCanvas canvas");
const box = await canvas.boundingBox();
const cx = box.width * 0.5, cy = box.height * 0.5;
await page.getByRole("button", { name: "Top", exact: true }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Select", exact: true }).click();
await canvas.click({ position: { x: cx, y: cy } });
await page.waitForTimeout(400);
if ((await page.getByRole("button", { name: "Hole…" }).count()) === 0) {
  await canvas.click({ position: { x: cx + 30, y: cy + 30 } });
  await page.waitForTimeout(400);
}
check("flat top face offers Hole…", (await page.getByRole("button", { name: "Hole…" }).count()) > 0);
await page.getByRole("button", { name: "Hole…" }).click();
await page.waitForSelector(".hole-panel");
await page.locator(".hole-panel").getByLabel("Hole diameter (mm)").fill("7");

// Place at canvas centre, then calibrate px/mm using the panel's own snapped inputs.
const posInputs = page.locator(".hole-panel .hp-axis input");
const vals = async () => [Number(await posInputs.nth(0).inputValue()), Number(await posInputs.nth(1).inputValue())];
await canvas.click({ position: { x: cx, y: cy } });
await page.waitForTimeout(250);
const v0 = await vals();
await canvas.click({ position: { x: cx + 60, y: cy } });
await page.waitForTimeout(250);
const v1 = await vals();
const dMm = Math.hypot(v1[0] - v0[0], v1[1] - v0[1]);
check("hover-place calibration click moved the hole", dMm > 2, `${dMm} mm for 60px`);
const pxPerMm = 60 / dMm;
await canvas.click({ position: { x: cx, y: cy } });
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Drill hole", exact: true }).click();
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Drilled a/.test(b.textContent ?? "")), null, { timeout: 120_000 });
await page.waitForTimeout(400);

// ---- 3) Drag-a-line measure across the hole → snapped ends read exactly 7 mm. ----
await page.getByRole("button", { name: "Measure", exact: true }).click();
const rPx = 3.5 * pxPerMm;
const y = box.y + cy, x1 = box.x + cx - rPx - 3, x2 = box.x + cx + rPx + 3;
await page.mouse.move(x1, y);
await page.mouse.down();
await page.mouse.move(x1 + 12, y, { steps: 2 });
await page.mouse.move(x2, y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(350);
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForSelector(".layers-panel");
const measRows = () => page.locator(".layers-panel .lp-row").filter({ hasText: /Measure \d/ });
check("drag created a measurement", (await measRows().count()) === 1);
const reading = await measRows().first().locator(".lp-sub").innerText();
const mmVal = parseFloat(reading);
check("snapped drag across the ⌀7 hole reads 7 mm", Math.abs(mmVal - 7) <= 0.15, `read "${reading}" (px/mm ${Math.round(pxPerMm * 100) / 100})`);

// ---- 4) Classic two-click measure still works alongside. ----
await canvas.click({ position: { x: cx - 90, y: cy - 60 } });
await page.waitForTimeout(250);
await canvas.click({ position: { x: cx + 90, y: cy - 60 } });
await page.waitForTimeout(350);
check("two-click measure still records", (await measRows().count()) === 2);

// ---- 5) Zoom way in: the measure label pill stays small (max-px clamp). ----
await page.getByRole("button", { name: "Objects", exact: true }).click(); // close panel — it overlays the canvas
for (let i = 0; i < 8; i++) await page.locator(".zoom-ctl button").first().click();
await page.waitForTimeout(500);
const b64 = (await canvas.screenshot()).toString("base64");
const textH = await page.evaluate(async ({ b64, cx }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  // Teal-ish pixels (text/border of the label pill, incl. minification blends) in a
  // narrow strip around the label centre — the endpoint dots sit outside the strip.
  let minY = 1e9, maxY = -1;
  const x0 = Math.max(0, Math.round(cx - 55)), x1 = Math.min(c.width - 1, Math.round(cx + 55));
  for (let yy = 0; yy < c.height; yy++) for (let xx = x0; xx <= x1; xx++) {
    const i = (yy * c.width + xx) * 4;
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    if (gg > 100 && gg - r > 25 && b - r > 15 && r < 200) {
      if (yy < minY) minY = yy;
      if (yy > maxY) maxY = yy;
    }
  }
  return maxY < 0 ? 0 : maxY - minY + 1;
}, { b64, cx });
check("label pill stays clamped when zoomed in", textH > 4 && textH < 40, `pill height ${textH}px`);
await page.screenshot({ path: "shot-measure2.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll measure/composer checks passed.");
