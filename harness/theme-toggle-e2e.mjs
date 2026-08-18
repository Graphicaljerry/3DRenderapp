// Theme-toggle regression: load in DARK (pre-paint script pins inline colorScheme),
// switch to LIGHT in-app, and the composer must follow — the reported bug was a
// black input in a light UI because the inline color-scheme never updated.
import { chromium } from "playwright";
import { enterWorkspace } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);

/** What the composer ACTUALLY looks like, measured off rendered pixels.
 *
 *  Two earlier versions of this were unmeasurable. Reading `.composer textarea` gave
 *  rgba(0,0,0,0) — that element is `background: none`, the colour lives on the wrapper —
 *  and since that parses to r=g=b=0, "is it dark" was always true and two checks could
 *  only ever pass. Reading the wrapper instead gives
 *  `color(srgb 0.92549 0.92549 0.929412 / 0.06)`: a modern colour syntax whose FLOATS a
 *  /\d+/g match shreds into nonsense, and a 6% translucent overlay whose own
 *  backgroundColor tells you nothing about what shows through it anyway.
 *
 *  So: screenshot the element, hand the PNG back to the page, and average the pixels.
 *  That is the composited result — the thing a person sees — and it is immune to which
 *  colour syntax, which token and how many stacked translucent layers produced it. */
const probe = async () => {
  const el = page.locator(".compose-field").first();
  const shot = (await el.screenshot()).toString("base64");
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext("2d");
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    return { r: r / n, g: g / n, b: bl / n };
  }, shot);
  const mean = (px.r + px.g + px.b) / 3;
  return {
    theme: await page.evaluate(() => document.documentElement.dataset.theme),
    scheme: await page.evaluate(() => document.documentElement.style.colorScheme),
    bg: `rgb(${px.r.toFixed(0)}, ${px.g.toFixed(0)}, ${px.b.toFixed(0)})`,
    light: mean > 160,
    dark: mean < 90,
  };
};

const atDark = await probe();
check("dark boot: composer is dark", atDark.theme === "dark" && atDark.dark, JSON.stringify(atDark));

// Toggle to light via the topbar theme button.
await page.getByRole("button", { name: "Toggle dark mode" }).click();
await page.waitForTimeout(200);
const atLight = await probe();
check("toggle → light theme applied", atLight.theme === "light", JSON.stringify(atLight));
check("inline color-scheme follows the toggle", atLight.scheme === "light", atLight.scheme);
check("composer input turns light (the reported bug)", atLight.light, atLight.bg);

// And back to dark for completeness.
await page.getByRole("button", { name: "Toggle dark mode" }).click();
await page.waitForTimeout(200);
const back = await probe();
check("toggle back → composer dark again", back.theme === "dark" && back.dark && back.scheme === "dark", JSON.stringify(back));

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll theme-toggle checks passed.");
