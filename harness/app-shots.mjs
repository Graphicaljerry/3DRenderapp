// Capture the real app UI for the Figma design file: splash/entry, main workspace
// with a model, and the template gallery — each in light AND dark.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/claude-0/-home-user-3DRenderapp/1c88c136-b99d-5e07-b6bd-55317086253d/scratchpad/appshots";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const theme of ["light", "dark"]) {
  // ---- 1) Splash / entry screen ----
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await page.addInitScript((t) => localStorage.setItem("moldable_theme", t), theme);
    await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500); // entry card + template thumbs settle
    await page.screenshot({ path: `${OUT}/entry-${theme}.png` });
    await page.close();
  }
  // ---- 2 + 3) Workspace with a model; template gallery ----
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await page.addInitScript((t) => {
      localStorage.setItem("moldable_entered", "1");
      localStorage.setItem("moldable_theme", t);
    }, theme);
    await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".topbar", { timeout: 60_000 });
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page.waitForSelector(".overlay");
    await page.waitForTimeout(900); // gallery thumbs render
    await page.screenshot({ path: `${OUT}/templates-${theme}.png` });
    await page.locator(".overlay").getByTitle("Build the box with lid template").click();
    await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("box"), null, { timeout: 120_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/workspace-${theme}.png` });
    await page.close();
  }
  console.log("captured", theme);
}
await browser.close();
