import { chromium } from "playwright";
const OUT = "/tmp/claude-0/-home-user-3DRenderapp/1c88c136-b99d-5e07-b6bd-55317086253d/scratchpad/appshots";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript((t) => { localStorage.setItem("moldable_entered", "1"); localStorage.setItem("moldable_theme", t); }, theme);
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle("Build the box with lid template").click();
  await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("box"), null, { timeout: 120_000 });
  await page.waitForTimeout(800);
  await page.locator(".viewerCanvas canvas").screenshot({ path: `${OUT}/canvas-${theme}.png` });
  await page.close();
  console.log("canvas", theme);
}
await browser.close();
