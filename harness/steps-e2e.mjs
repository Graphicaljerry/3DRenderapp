// Playbook move 5: the Steps panel — the op recipe as one editable dock list.
// Through the real UI: build a plate, add a chamferBottom op via Printability's
// elephant-foot button, then in Steps retype its size, remove it, and undo —
// asserting the STORED op chain (IndexedDB head) after each move, not just pixels.
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
/** The head op chain as the STORE has it — polls until `test` passes or times out.
 *  A hand-rolled loop over page.evaluate, NOT waitForFunction: waitForFunction does
 *  not await an async predicate, so the Promise it returns counted as truthy and the
 *  check passed no matter what the store held (caught by a break test). */
const waitOps = async (test, label) => {
  for (const t = Date.now() + 30_000; ; ) {
    const ok = await page.evaluate(async (src) => {
      const mod = await import("/src/store/projects.ts");
      const proj = (await mod.listProjects()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
      return new Function("ops", `return (${src})(ops)`)(proj?.ops ?? []);
    }, test.toString());
    if (ok) return;
    if (Date.now() > t) throw new Error(`store never showed: ${label}`);
    await page.waitForTimeout(500);
  }
};

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

// An empty recipe states itself rather than showing a blank panel.
await page.getByRole("button", { name: "Steps", exact: true }).click();
check("empty recipe explains itself", /No steps on the part yet/.test(await page.evaluate(() => document.querySelector(".dock-body")?.textContent ?? "")));

// ---- add a real op: Printability → elephant-foot bevel ------------------------------
await page.getByRole("button", { name: "Printability", exact: true }).click();
await page.locator(".dock-body button", { hasText: /^Elephant-foot bevel$/ }).click();
await idle();
await waitOps((ops) => ops.length === 1 && ops[0].type === "chamferBottom" && ops[0].size === 0.4, "the 0.4 mm chamferBottom op");

// ---- the Steps panel lists it -------------------------------------------------------
await page.getByRole("button", { name: "Steps", exact: true }).click();
const row = page.locator(".steps-panel .pocket-row", { hasText: "Bottom-edge bevel" });
await row.waitFor({ timeout: 15_000 });
check("Steps lists the bevel with its number", /0\.4\s*mm/.test(await row.innerText()), await row.innerText());

// ---- retype its size → the stored chain carries the new number ----------------------
await row.locator(".pocket-pick").click();
const sizeBox = page.locator(".steps-panel .modify-size input");
await sizeBox.fill("0.8");
await sizeBox.press("Enter");
await idle();
await waitOps((ops) => ops.length === 1 && ops[0].type === "chamferBottom" && ops[0].size === 0.8, "the retyped 0.8 mm bevel");
check("retyping the step rebuilds the stored chain", true);
check("…and the row shows the new number", /0\.8\s*mm/.test(await row.innerText()), await row.innerText());

// ---- remove it → chain empty, honest empty state ------------------------------------
await row.locator(".x").click();
await idle();
await waitOps((ops) => ops.length === 0, "an empty op chain after remove");
check("removing the step empties the stored chain", true);
check("…and the panel says so", /No steps on the part yet/.test(await page.evaluate(() => document.querySelector(".dock-body")?.textContent ?? "")));

// ---- undo brings the step back — each change landed as a real version ---------------
await page.keyboard.press("Control+z");
await idle();
await waitOps((ops) => ops.length === 1 && ops[0].type === "chamferBottom" && ops[0].size === 0.8, "the bevel back after undo");
check("undo restores the removed step", true);
check("…and Steps lists it again", /0\.8\s*mm/.test(await page.locator(".steps-panel .pocket-row", { hasText: "Bottom-edge bevel" }).innerText()));

await page.screenshot({ path: "shot-steps.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll steps-panel checks passed.");
