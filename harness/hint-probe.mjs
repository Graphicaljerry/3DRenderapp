// Verify the tool hint no longer overlaps the Top/Front/Right/3D view pills.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => { localStorage.setItem("moldable_entered", "1"); localStorage.setItem("moldable_theme", "dark"); });
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the coaster template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.toLowerCase().includes("coaster"), null, { timeout: 120_000 });
await page.waitForTimeout(600);

const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

for (const [btn, label] of [["Measure", "measure hint"], ["Select", "box-select hint"]]) {
  await page.getByRole("button", { name: btn, exact: true }).click();
  await page.waitForSelector(".box-hint", { timeout: 10_000 });
  const hint = await page.locator(".box-hint").boundingBox();
  const pills = await page.locator(".view-snaps").boundingBox();
  const overlap = hint && pills && hint.y + hint.height > pills.y && pills.y + pills.height > hint.y;
  check(`${label} sits clear of the view pills`, !overlap, `hint bottom ${Math.round(hint.y + hint.height)}, pills top ${Math.round(pills.y)}`);
  await page.getByRole("button", { name: btn, exact: true }).click(); // toggle off
  await page.waitForTimeout(200);
}
await page.getByRole("button", { name: "Measure", exact: true }).click();
await page.waitForTimeout(250);
await page.locator(".viewer-body").screenshot({ path: "shot-hint.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll hint checks passed.");
