// White-flash / reload-loop fix verification:
//  1) the OpenRouter catalogue cache is NOT rewritten on boot while fresh (the churn
//     that fed the sync reload loop);
//  2) cache/device keys are excluded from cloud-synced settings;
//  3) the saved theme applies BEFORE first paint (no light-mode flash on reload).
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

const CAT = JSON.stringify({ t: Date.now(), m: [{ id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", inPrice: 1.5e-7, reasoning: false, vision: true }] });

// ---- T1: fresh catalogue cache is not rewritten by the boot warm-up ----
{
  const page = await browser.newPage();
  await page.addInitScript((cat) => {
    localStorage.setItem("moldable_entered", "1");
    localStorage.setItem("moldable_theme", "dark");
    localStorage.setItem("moldable_openrouter_models_v2", cat);
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "openrouter", model: "auto" }));
  }, CAT);
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(3000); // give the warm-up effect every chance to misbehave
  const now = await page.evaluate(() => localStorage.getItem("moldable_openrouter_models_v2"));
  check("T1 fresh catalogue cache untouched at boot (no churn)", now === CAT, now === CAT ? "" : "value was rewritten");

  // ---- T2: device/cache keys stay out of the synced settings snapshot ----
  const gathered = await page.evaluate(async () => {
    localStorage.setItem("moldable_gemini_model", "gemini-2.5-flash");
    localStorage.setItem("moldable_local_ready", "1");
    localStorage.setItem("moldable_house_url", "http://127.0.0.1:1");
    const { gatherSettings } = await import("/src/lib/backup.ts");
    return Object.keys(gatherSettings());
  });
  const leaked = ["moldable_openrouter_models_v2", "moldable_gemini_model", "moldable_local_ready", "moldable_house_url", "moldable_last_sync", "moldable_last_project"].filter((k) => gathered.includes(k));
  check("T2 cache/device keys excluded from sync", leaked.length === 0, leaked.join(","));
  check("T2 real settings still sync", gathered.includes("moldable_theme") && gathered.includes("moldable_llm"), gathered.join(",").slice(0, 90));
  await page.close();
}

// ---- T3: dark theme is applied before first paint (no white flash) ----
{
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("moldable_entered", "1");
    localStorage.setItem("moldable_theme", "dark");
  });
  // Sample as early as possible: at domcontentloaded, BEFORE React mounts.
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  const early = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: document.documentElement.style.backgroundColor,
    scheme: document.documentElement.style.colorScheme,
    mounted: !!document.querySelector(".topbar"),
  }));
  // html.style.backgroundColor is set ONLY by the inline head script (React never
  // touches it) — its presence proves the theme landed before any React paint.
  check("T3 data-theme=dark at domcontentloaded", early.theme === "dark", JSON.stringify(early));
  check("T3 dark backdrop painted pre-mount", early.bg === "rgb(18, 18, 19)" && early.scheme === "dark", `${early.bg} / ${early.scheme}`);
  // And after mount the app agrees (no flip back).
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  const late = await page.evaluate(() => document.documentElement.dataset.theme);
  check("T3 theme stays dark after mount", late === "dark", late);
  await page.close();
}

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll flash-fix checks passed.");
