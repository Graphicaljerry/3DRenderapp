// Stop means stop paying.
//
// There was no way to halt a generation. The send button greyed out and the app said
// "wait" with no way to say "don't" — and a stuck build retries up to three times, so
// the worst case is three full requests billed for an answer nobody wanted.
//
// The assertion that matters is SERVER-SIDE. A stop that only hides the result costs
// exactly as much as letting it finish: the provider bills for what it generates, not
// for what you look at. So the stub hangs a stream open and records `abortedByClient`
// when the socket closes — that flag is the difference between a real stop and a
// cosmetic one, and no amount of UI checking substitutes for it.
//
// The other half is what the user is left holding: a stopped request must return to
// idle, say it stopped, and NOT be dressed as an error — the user did this on purpose.
import { chromium } from "playwright";

const STUB = "http://localhost:8899";
const stats = () => fetch(`${STUB}/_stats`).then((r) => r.json());
await fetch(`${STUB}/_reset`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
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
// Arm the hang on the server. A keyword in the prompt would live on in the conversation
// history and silently hang every later build in the same session — which it did.
await fetch(`${STUB}/_hang`);
await page.locator(".launch-composer textarea").fill("A SPECIFIC bracket that will be stopped");
await page.locator(".launch-composer .send").click();

// Wait for the request to be genuinely in flight before stopping it — stopping something
// that never started would pass every check below for the wrong reason.
await page.waitForFunction(() => /will be stopped/i.test(document.body.innerText), null, { timeout: 60_000 });
await page.waitForSelector(".composer .send.stop", { timeout: 60_000 });
check("Send becomes Stop while a request is running", true);
await page.waitForTimeout(2500); // let some tokens actually stream

const before = (await stats()).filter((s) => s.abortedByClient).length;
await page.locator(".composer .send.stop").click();

// The socket close reaches the server a beat after the click.
await page.waitForFunction(() => !document.querySelector(".send.stop"), null, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(2000);

const aborted = (await stats()).filter((s) => s.abortedByClient).length;
check("the connection to the model was actually closed, not just ignored",
  aborted > before, `abortedByClient records: ${before} → ${aborted}`);

const state = await page.evaluate(() => ({
  body: [...document.querySelectorAll(".msg.assistant")].map((e) => e.innerText).join(" | "),
  stillWorking: !!document.querySelector(".bubble-open"),
  stopShowing: !!document.querySelector(".send.stop"),
  sendBack: !!document.querySelector(".composer .send:not(.stop)"),
  errorStyled: [...document.querySelectorAll(".msg.err")].map((e) => e.innerText).join(" | "),
}));

check("the chat says it stopped", /stopped/i.test(state.body), state.body.slice(-160).replace(/\n/g, " "));
check("the app is idle again", !state.stillWorking);
check("Stop turns back into Send", state.sendBack && !state.stopShowing);
// Stopping is a choice, not a failure. Painting it red would teach people that using
// the control they were given is a mistake.
check("a deliberate stop is not dressed as an error", !/stopped/i.test(state.errorStyled), state.errorStyled.slice(0, 120));

// And the app must still work afterwards — an abort that leaves a poisoned controller
// behind would kill the NEXT request too.
await fetch(`${STUB}/_reset`);
await page.locator(".composer textarea").fill("A SPECIFIC round coaster after the stop");
await page.locator(".composer .send").click();
await page.waitForFunction(() => /after the stop/i.test(document.body.innerText), null, { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
await page.waitForTimeout(1500);
check("the next request still builds after a stop", await page.evaluate(() => !!window.__viewerGeom?.()));

check("no uncaught exception took the render down", pageErrors.length === 0, pageErrors.join(" | "));

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
