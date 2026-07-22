// Probe: when does the gray selection bounding box appear/disappear today?
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the box with lid template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("box"), null, { timeout: 120_000 });
await page.waitForTimeout(800);

const canvas = page.locator(".viewerCanvas canvas");
const box = await canvas.boundingBox();
const moveOn = async () => page.evaluate(() => document.querySelector('[aria-label="Transform"]')?.getAttribute("aria-pressed"));

console.log("initial: transform pressed =", await moveOn());

// click the model
await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.55 } });
await page.waitForTimeout(400);
console.log("after model click: transform pressed =", await moveOn());
await page.screenshot({ path: "shot-selbox-on.png" });

// click empty space (top-right corner of canvas)
await canvas.click({ position: { x: box.width * 0.92, y: box.height * 0.15 } });
await page.waitForTimeout(400);
console.log("after empty click: transform pressed =", await moveOn());
await page.screenshot({ path: "shot-selbox-off.png" });

// click model again
await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.55 } });
await page.waitForTimeout(400);
console.log("after re-click: transform pressed =", await moveOn());

// toolbar Move button with nothing selected
await canvas.click({ position: { x: box.width * 0.92, y: box.height * 0.15 } });
await page.waitForTimeout(300);
await page.locator('[aria-label="Transform"]').click();
await page.waitForTimeout(400);
console.log("toolbar Move, nothing selected: transform pressed =", await moveOn());
await page.screenshot({ path: "shot-selbox-toolbar.png" });

await browser.close();
