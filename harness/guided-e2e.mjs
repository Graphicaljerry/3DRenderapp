// Playbook move 6: the fix-a-broken-part guided flow, end to end. The pieces all
// ship already (guided door → replacement-mode prompt → fit directive → receipt);
// what was missing was the loop-closer — after the first guided build, one message
// pointing at Part fit, the printer calibration and the export receipt. This walks
// the real flow and asserts that message lands.
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

// The guided door on the Launchpad (first-time users see it; this profile is fresh).
await page.locator(".launch-guided").click();
await page.waitForFunction(() => /coin or a credit card/i.test(document.body.innerText), null, { timeout: 20_000 });
check("the guided door opens with the scale-reference helper", true);

// Guided mode skips plan and clarify by design — the build starts straight away.
const box = page.locator(".composer textarea").first();
await box.fill("A small plate 30 x 20 x 5 mm");
await box.press("Enter");
await page.waitForFunction(() => !document.querySelector(".gen-pill") && !document.querySelector(".bubble-open"), null, { timeout: 240_000 });
await page.waitForFunction(() => /30 × 20 × 5/.test(document.querySelector(".statusbar .dims")?.textContent ?? ""), null, { timeout: 90_000 });
check("the guided build lands (no plan/clarify detour)", true);

// The loop-closer, waited for by its LAST words (the chat types text in gradually).
await page.waitForFunction(() => /receipt of the measured sizes/i.test(document.body.innerText), null, { timeout: 30_000 });
const chat = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.innerText).join(" | "));
check("…and the fit loop-closer follows it", /check the fit/i.test(chat) && /Part fit/.test(chat) && /Settings → Printer/.test(chat));

// The knobs the message points at are really there.
check("Build options (home of Part fit) is beside the composer", (await page.locator(".opt-trigger").count()) > 0);

await page.screenshot({ path: "shot-guided.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll guided-flow checks passed.");
