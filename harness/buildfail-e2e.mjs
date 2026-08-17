// A build that cannot be built still owes you a reply.
//
// From a real session: a speaker-box request came back as code with no main(), the kernel
// refused it, and the transcript ended up holding the user's message and NOTHING else —
// no assistant bubble, no reasoning, no error. Just a toast on the canvas. 8,169 tokens
// of thinking, paid for and gone, with nothing to retry from and nothing explaining why.
//
// What has to hold when a build fails:
//   1. the reply survives as a message in the chat, where the failure happened
//   2. it says what went wrong in words, not only as a canvas toast
//   3. the reasoning the user paid for is kept, not discarded
//   4. the app returns to idle so the next request can be sent
//
// FIXED. The reply was never lost — it was written correctly and then filtered out of
// the render. The chat list mapped `messages.filter((m) => !m.error)`, on the reasoning
// that "errors are STATUS, not conversation" and belong on a canvas banner instead. True
// of a tool op that didn't apply; false of a build that failed, which IS the outcome of
// a request the user paid for. The banner also auto-dismisses after nine seconds and
// takes the reasoning with it, so the whole exchange was gone within a minute.
//
// `ChatMessage.reply` now marks the messages that answer a user turn: those stay in the
// transcript whatever they have to say, incidental errors still go to the banner, and
// nothing appears in both places. The flag rides through save/load too — without that it
// vanished again on the next reopen.
//
// The lesson for the next reader: the bug was in the RENDER, not the send path. Chasing
// it in sendInner (where the catch demonstrably does the right thing) is a dead end.
import { chromium } from "playwright";

const STUB = "http://localhost:8899";
await fetch(`${STUB}/_reset`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

const chip = page.locator(".lo-trigger");
if (!/no plan/i.test(await chip.innerText())) {
  await chip.click();
  await page.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
  await page.keyboard.press("Escape");
}

await page.locator(".launch-composer textarea").fill("A SPECIFIC bracket, BADCODE please");
await page.locator(".launch-composer .send").click();
await page.waitForFunction(() => /BADCODE/i.test(document.body.innerText), null, { timeout: 60_000 });
// The retry loop makes up to three attempts before giving up, each a full round trip.
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 240_000 });
await page.waitForTimeout(1500);

const state = await page.evaluate(() => ({
  assistantText: [...document.querySelectorAll(".bubble, .bubble-open")].map((e) => e.innerText).join(" \n "),
  bodyText: document.body.innerText,
  stillWorking: !!document.querySelector(".bubble-open"),
  sendDisabled: document.querySelector(".composer .send")?.disabled ?? null,
}));

check("the failure is reported IN the chat, not only on the canvas",
  /must define|didn't build|couldn't build|failed|error/i.test(state.assistantText),
  state.assistantText.replace(/\n/g, " ").slice(0, 140) || "(no assistant text at all)");
check("the user's own message survives", /BADCODE/i.test(state.bodyText));
check("the app is idle again, not stuck mid-build", !state.stillWorking);
check("the composer will accept another request", state.sendDisabled !== true, `send disabled = ${state.sendDisabled}`);
check("no uncaught exception took the render down", pageErrors.length === 0, pageErrors.join(" | "));

// The reasoning is the expensive part. Losing it is losing what the user paid for.
const keptThinking = await page.evaluate(() =>
  !!document.querySelector(".think-done, .think-body, details.think-done"));
check("the reasoning that was paid for is kept, not discarded", keptThinking,
  keptThinking ? "" : "no thinking trail retained on the failed reply");

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
