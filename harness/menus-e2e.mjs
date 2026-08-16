// Toolbar placement + one-popup-at-a-time.
//  - "Set size" and snapping belong on the horizontal toolbar (settings you change any
//    time), not inside the Transform flyout where they floated loose on the canvas.
//  - Opening any popup closes whatever else was open, so panels never stack.
import { chromium } from "playwright";
import { enterWorkspace } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => { localStorage.setItem("moldable_theme", "dark"); });
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("friction-fit"), null, { timeout: 120_000 });

const setSize = page.getByRole("button", { name: "Set size", exact: true });
const snapping = page.getByRole("button", { name: "Snapping", exact: true });

// ---- A) They live on the horizontal toolbar --------------------------------------
check("A1 Set size is on the toolbar", await setSize.evaluate((el) => !!el.closest(".viewer-tools")));
check("A2 Snapping is on the toolbar", await snapping.evaluate((el) => !!el.closest(".viewer-tools")));
check("A3 neither is inside the canvas tool rail",
  !(await setSize.evaluate((el) => !!el.closest(".canvas-rail"))) && !(await snapping.evaluate((el) => !!el.closest(".canvas-rail"))));

// ---- B) The Transform flyout holds only its own control --------------------------
await page.locator(".canvas-rail").getByRole("button", { name: "Transform", exact: true }).click();
await page.waitForSelector(".canvas-rail .rail-fly");
const flyKids = await page.locator(".canvas-rail .rail-fly").first().evaluate((el) =>
  [...el.children].map((c) => c.className));
check("B1 the flyout is just the Move/Rotate/Scale control", flyKids.length === 1 && /seg/.test(flyKids[0]), JSON.stringify(flyKids));
// Everything visible in the flyout must sit on a panel, not bare on the canvas.
const bare = await page.locator(".canvas-rail .rail-fly").first().evaluate((el) => {
  const opaque = (n) => {
    for (let e = n; e && e !== document.body; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return true;
    }
    return false;
  };
  return [...el.querySelectorAll("button")].filter((b) => !opaque(b)).length;
});
check("B2 nothing in the flyout floats on bare canvas", bare === 0, `${bare} bare control(s)`);
await page.locator(".canvas-rail").getByRole("button", { name: "Transform", exact: true }).click(); // close

// ---- C) One popup at a time ------------------------------------------------------
await setSize.click();
await page.waitForSelector(".resize-menu");
check("C1 Set size opens", (await page.locator(".resize-menu").count()) === 1);
await snapping.click();
await page.waitForTimeout(350);
check("C2 opening Snapping closes Set size", (await page.locator(".resize-menu").count()) === 0);
check("C3 …and Snapping is the one showing", (await page.locator(".snap-menu").count()) === 1);
await page.getByRole("button", { name: "View", exact: true }).click();
await page.waitForTimeout(350);
check("C4 opening the View menu closes Snapping", (await page.locator(".snap-menu").count()) === 0 && (await page.locator(".pmenu").count()) === 1);
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForTimeout(350);
check("C5 opening Objects closes the View menu", (await page.locator(".pmenu").count()) === 0);
await page.keyboard.press("Escape");

// ---- D) Both still work where they were moved to ---------------------------------
await snapping.click();
await page.waitForSelector(".snap-menu");
await page.locator(".snap-menu .seg.sm button", { hasText: "1mm" }).first().click();
await page.waitForTimeout(250);
check("D1 snapping still applies from the toolbar",
  (await page.locator(".snap-menu .seg.sm button", { hasText: "1mm" }).first().getAttribute("class"))?.includes("on"));
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check("D2 Escape closes it", (await page.locator(".snap-menu").count()) === 0);
await setSize.click();
await page.waitForSelector(".resize-menu");
const w = await page.locator(".resize-menu input[type=number]").first().inputValue();
check("D3 Set size still seeds from the model", parseFloat(w) > 0, `W=${w}`);

await page.screenshot({ path: "menus-toolbar.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll menu checks passed.");
