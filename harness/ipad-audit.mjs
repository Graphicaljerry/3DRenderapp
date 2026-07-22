// iPad-width audit: find anything overflowing the viewport or its container at
// common iPad sizes, with a template loaded and toolbars fully populated.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const SIZES = [
  ["ipad-pro-land", 1194, 834],
  ["ipad-land", 1024, 768],
  ["ipad-portrait", 834, 1114],
];
for (const [name, w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle("Build the box with lid template").click();
  await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("box"), null, { timeout: 120_000 });
  await page.waitForTimeout(700);
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && r.width < 40) continue;
      // overflows the viewport horizontally
      if (r.right > vw + 2 || r.left < -2) {
        bad.push({ sel: el.className?.toString?.().slice(0, 60) || el.tagName, left: Math.round(r.left), right: Math.round(r.right), vw });
      }
    }
    // page-level horizontal scroll?
    return { hscroll: document.documentElement.scrollWidth > vw + 2, sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 20) };
  });
  console.log(`\n=== ${name} ${w}x${h} ===`);
  console.log("page h-scroll:", report.hscroll, `(scrollWidth ${report.sw} vs ${report.vw})`);
  for (const b of report.bad) console.log("  overflow:", JSON.stringify(b));
  await page.screenshot({ path: `shot-${name}.png` });
  await page.close();
}
await browser.close();
