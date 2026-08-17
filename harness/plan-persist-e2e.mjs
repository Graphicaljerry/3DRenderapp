// The plan you agreed to has to still be there tomorrow.
//
// Plan-first exists to produce exactly one artefact: a spec you read and approved before
// any money was spent. toChatTurn saved role/text/usage/thinking and dropped `plan`, so
// reopening the project threw that artefact away — and because the plan message renders a
// CARD instead of text, it had almost no `text` to fall back on. What came back was an
// empty bubble whose only content was its Delete action.
//
// Same failure shape for `clarify`, `confirm` and `offer`: every card turn came back blank.
import { chromium } from "playwright";
await fetch("http://localhost:8899/_reset");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 1280, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };
await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60000 });
// plan is on by default
await page.locator(".launch-composer textarea").fill("A wall bracket for a 32 mm pipe");
await page.locator(".launch-composer .send").click();
await page.waitForSelector(".plan-card", { timeout: 120000 });
await page.locator(".plan-actions button", { hasText: /build this/i }).first().click();
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180000 });
await page.waitForTimeout(2500);
const live = await page.evaluate(() => ({
  cards: document.querySelectorAll(".plan-card").length,
  empties: [...document.querySelectorAll(".msg.assistant .bubble")].filter((e) => e.innerText.trim().length < 3).length,
}));
check("the approved plan card is on screen", live.cards === 1, JSON.stringify(live));

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const after = await page.evaluate(() => ({
  cards: document.querySelectorAll(".plan-card").length,
  text: document.body.innerText,
  empties: [...document.querySelectorAll(".msg.assistant .bubble")].filter((e) => e.innerText.trim().length < 3).length,
}));
check("the plan card survives a reopen", after.cards === 1, `${after.cards} card(s)`);
check("the spec you agreed to is still readable", /pipe wall bracket|60 × 40|bracket/i.test(after.text));
check("no empty bubble left where the card was", after.empties === 0, `${after.empties} empty`);
console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await b.close();
process.exit(fails.length ? 1 : 0);
