// Theme-toggle regression: load in DARK (pre-paint script pins inline colorScheme),
// switch to LIGHT in-app, and the composer must follow — the reported bug was a
// black input in a light UI because the inline color-scheme never updated.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => {
  localStorage.setItem("moldable_entered", "1");
  localStorage.setItem("moldable_theme", "dark");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

const probe = () => page.evaluate(() => {
  const ta = document.querySelector(".composer textarea");
  const bg = getComputedStyle(ta).backgroundColor;
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  return {
    theme: document.documentElement.dataset.theme,
    scheme: document.documentElement.style.colorScheme,
    bg,
    light: (r + g + b) / 3 > 160,
    dark: (r + g + b) / 3 < 90,
  };
});

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
