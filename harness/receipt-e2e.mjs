// Playbook moves 1–4, through the real UI:
//  1. A slider commit records the decoration state — partColors present on the version
//     (before the shared decorSnap, the Adjust writer forgot logos and colours, and an
//     undo onto its version silently deleted them).
//  3. The fit coupon's tap-a-hole picker stores the same number the typed field does.
//  4. Exporting produces a verification receipt: measured size, each requested figure
//     confirmed or honestly declared unconfirmed, watertightness, bed fit.
import { chromium } from "playwright";

await fetch("http://localhost:8899/_reset");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
  localStorage.setItem("moldable_ai_apply", "auto");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

const idle = () => page.waitForFunction(() => !document.querySelector(".gen-pill") && !document.querySelector(".bubble-open"), null, { timeout: 240_000 });
const box = page.locator(".launch-composer textarea, .composer textarea").first();
await box.fill("A small plate 30 x 20 x 5 mm");
await box.press("Enter");
for (const t = Date.now() + 60_000; Date.now() < t; ) {
  if (await page.locator(".gen-pill").count()) break;
  const plan = page.locator("button", { hasText: /skip the plan/i }).first();
  const quick = page.locator("button", { hasText: /build what i asked for/i }).first();
  if (await plan.count()) await plan.click({ timeout: 5000 }).catch(() => {});
  else if (await quick.count()) await quick.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
}
await idle();
await page.waitForFunction(() => /30 × 20 × 5/.test(document.querySelector(".statusbar .dims")?.textContent ?? ""), null, { timeout: 90_000 });

// ---- 4) export → the receipt --------------------------------------------------------
const dl = page.waitForEvent("download", { timeout: 60_000 });
// The Export CTA opens the Export section; the per-format .xfmt buttons run it.
await page.locator("button.export-cta").click();
await page.locator(".export-panel .xfmt", { hasText: /^STL/i }).first().click();
await dl;
// Wait for the receipt's LAST lines, not its first: the chat types its text in with a
// reveal animation, and sampling at the title showed a receipt still being written.
await page.waitForFunction(() => /watertight yes/i.test(document.body.innerText) && /bed 256/.test(document.body.innerText), null, { timeout: 30_000 });
const chat = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.innerText).join(" | "));
check("receipt appears on export", /Verification receipt/.test(chat));
check("…with the measured size", /measured 30 × 20 × 5 mm/.test(chat), chat.slice(-260));
check("…confirming every requested figure", /30 mm ✓/.test(chat) && /20 mm ✓/.test(chat) && /5 mm ✓/.test(chat));
check("…and the physical checks", /watertight yes/.test(chat) && /bed .* fits/.test(chat));

// ---- 1) a slider commit records the decoration state -------------------------------
await page.getByRole("button", { name: "Adjust", exact: true }).click();
const row = page.locator(".prow", { hasText: /thickness/i }).first();
await row.waitFor({ timeout: 20_000 });
await row.locator(".pf-input").fill("8");
await row.locator(".pf-input").press("Enter");
await page.waitForFunction(() => /30 × 20 × 8/.test(document.querySelector(".statusbar .dims")?.textContent ?? ""), null, { timeout: 90_000 });
await page.waitForTimeout(1000);
const head = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  const proj = (await mod.listProjects()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const v = proj?.versions?.at(-1);
  return { summary: v?.summary ?? "", colors: v ? typeof v.partColors : "missing" };
});
check("the Adjust version records the decoration state", /^Adjusted /.test(head.summary) && head.colors === "object",
  `${head.summary} · partColors ${head.colors}`);

// ---- 3) tap-a-hole calibration ------------------------------------------------------
await page.locator(".statusbar .bedchip").click();
await page.waitForSelector(".overlay .stabs", { timeout: 15_000 });
await page.locator(".overlay .stabs button", { hasText: "Printer" }).click();
const hole3 = page.locator(".fitpick button", { hasText: /hole 3/i });
await hole3.scrollIntoViewIfNeeded();
await hole3.click();
await page.waitForTimeout(300);
const stored = await page.evaluate(() => localStorage.getItem("moldable_fit_cal"));
check("tapping Hole 3 stores its clearance", stored === "0.25", String(stored));
const typed = await page.locator('input[placeholder="0.20 (default)"]').inputValue();
check("…and the typed field shows the same number", typed === "0.25", typed);

await page.screenshot({ path: "shot-receipt.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll receipt checks passed.");
