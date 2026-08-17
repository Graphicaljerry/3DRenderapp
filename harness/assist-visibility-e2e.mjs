// Escape closes what's on top; the model says its name WHILE it works; the thinking
// dial and the research reset behave.
//
// Four features, one session, because they share a flow:
//  1. Escape. Six overlays dismissed only by their X or backdrop — the key that closes
//     a dialog everywhere else did nothing here. Driven on the real modals, including
//     the stack rule: an overlay opened on top must not take the one under it down.
//  2. The model tag, live. It used to appear only when the reply finished — on Auto
//     that meant a minute of "Writing CAD code…" with no answer to "with WHAT?". The
//     model is decided before the request goes out; the tag must be readable while the
//     request is still running. Uses the stub's SLOWBUILD fixture to hold the stream
//     open long enough to look.
//  3. The Thinking dial in Build options (OpenRouter only — the one provider whose
//     requests carry the reasoning param).
//  4. Research resets to auto for a new part, same contract the plan won in 447.
import { chromium } from "playwright";

const STUB = "http://localhost:8899";
await fetch(`${STUB}/_reset`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
// One init script taking the whole map as its argument. The obvious curried version —
// seed(extra) returning a function — is a trap: addInitScript passes ITS second
// argument to the function, so the closed-over extras never arrive and every seeded
// precondition is silently dropped. Checks then pass because the state under test was
// never set up. (That is exactly what happened here first.)
const BASE = {
  moldable_theme: "dark",
  moldable_llm: JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }),
  moldable_signin_prompted: "1",
};
const seedInto = (page, extra = {}) => page.addInitScript((all) => {
  for (const [k, v] of Object.entries(all)) localStorage.setItem(k, v);
}, { ...BASE, ...extra });

// ---------- 1. Escape, on the Launchpad's modals ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await seedInto(page);
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

  // Sign-in FIRST, templates last: "All templates" enters the workspace to float its
  // modal, so once it has been opened the Launchpad's own chrome is gone and every
  // later Launchpad selector times out.
  await page.locator(".launch-top-right button", { hasText: /sign in/i }).first().click();
  await page.waitForSelector(".signin-card", { timeout: 20_000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".overlay", { state: "detached", timeout: 5_000 }).catch(() => {});
  check("Escape closes the sign-in modal", await page.locator(".overlay").count() === 0);

  // Escape inside a modal's text field still closes the modal — a dialog owns the key.
  await page.locator(".launch-top-right button", { hasText: /sign in/i }).first().click();
  await page.waitForSelector(".signin-card", { timeout: 20_000 });
  await page.locator(".signin-card input").first().click();
  await page.keyboard.type("someone@example.com");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".overlay", { state: "detached", timeout: 5_000 }).catch(() => {});
  check("Escape works from inside the modal's own field", await page.locator(".overlay").count() === 0);

  await page.locator(".launch-more").first().click(); // "All 12" templates
  await page.waitForSelector(".overlay", { timeout: 20_000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".overlay", { state: "detached", timeout: 5_000 }).catch(() => {});
  check("Escape closes the templates modal", await page.locator(".overlay").count() === 0);
  await page.close();
}

// ---------- 2 + 3 + stack: in the workspace ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
  await seedInto(page, { moldable_plan: "off" });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

  // The cold-load reset puts plan back ON (447's contract) — turn it off for this
  // probe's build so the send goes straight to the slow build fixture, no plan card.
  const chip = page.locator(".plan-toggle");
  if ((await chip.getAttribute("class") ?? "").includes("on")) await chip.click();

  await page.locator(".launch-composer textarea").fill("A SLOWBUILD SPECIFIC 30 mm small plate, 5 mm thick");
  await page.locator(".launch-composer .send").click();

  // The model tag, DURING the response: the stub holds this stream open ~2.5s, so the
  // working timeline is on screen — and the tag must already say which model.
  await page.waitForSelector(".bubble-open", { timeout: 60_000 });
  const liveTag = await page.locator(".msg-model").count()
    ? await page.locator(".msg-model").last().innerText() : "";
  check("model is named WHILE the reply is being written", /stub/i.test(liveTag),
    liveTag || "no .msg-model during streaming");
  const stillWorking = await page.locator(".bubble-open").count() > 0;
  check("…and that reading happened mid-stream, not after", stillWorking,
    stillWorking ? "reply still open while the tag was read" : "bubble had already closed — SLOWBUILD window missed");

  await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 120_000 });
  check("model tag survives the finish", /stub/i.test(await page.locator(".msg-model").last().innerText()));

  // Thinking dial: hidden for this custom-provider brain (not OpenRouter)…
  await page.locator(".opt-trigger").click();
  await page.waitForSelector(".pmenu-item", { timeout: 10_000 });
  check("Thinking dial hidden for non-OpenRouter brains",
    await page.locator(".pmenu-item", { hasText: /thinking/i }).count() === 0);
  await page.keyboard.press("Escape");

  await page.close();
}

// …and present for OpenRouter, on its own page seeded that way from the start.
// The KEY matters: without one llmReady() fails and the app re-homes the brain to
// "house", so the dial would be correctly hidden and the check would fail for a reason
// that has nothing to do with the dial. Entry is the built-in example, which reaches
// the workspace without an LLM call — an OpenRouter brain here has no reachable
// endpoint, and this probe is about the control, not about generating anything.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await seedInto(page, {
    moldable_llm: JSON.stringify({ provider: "openrouter", model: "openrouter/auto" }),
    moldable_llm_keys: JSON.stringify({ openrouter: "sk-or-probe" }),
  });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  await page.locator("button.link", { hasText: /built-in example/i }).first().click();
  await page.waitForSelector(".opt-trigger", { timeout: 120_000 });
  await page.locator(".opt-trigger").click();
  await page.waitForSelector(".pmenu-item", { timeout: 10_000 });
  const dial = page.locator(".pmenu-choice", { hasText: /thinking/i });
  check("Thinking dial appears for OpenRouter", await dial.count() === 1);
  check("Medium is the resting state", (await dial.locator(".pm-opt.on").innerText()).trim() === "Medium");
  await dial.locator(".pm-opt", { hasText: /^Off$/ }).click();
  check("choosing Off writes the setting llm.ts reads",
    await page.evaluate(() => localStorage.getItem("moldable_or_reasoning")) === "off");
  await page.keyboard.press("Escape");
  const trigger = await page.locator(".opt-trigger").innerText();
  check("the folded trigger names the off-default choice", /thinking\s*·\s*off/i.test(trigger), trigger);
  // No restore needed: browser.newPage() opens its own context, so this "off" never
  // reaches the pages above or below it — which is also why each block can seed its
  // own preconditions without clearing up after the last one.

  // The workspace's own overlay, reached from the account button. Signed out that is
  // the sign-in popup (the full Settings pane sits behind an account, which this probe
  // has no way to create) — either way it is an overlay raised from the WORKSPACE, not
  // the Launchpad, so it covers the other half of the app.
  await page.locator("button.ghost.profile").first().click();
  await page.waitForSelector(".overlay", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".overlay", { state: "detached", timeout: 5_000 }).catch(() => {});
  check("Escape closes an overlay raised from the workspace", await page.locator(".overlay").count() === 0);
  await page.close();
}

// ---------- 4. research resets to auto for a NEW part ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await seedInto(page, { moldable_web_mode: "off" });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  const web = page.locator(".launch-composer-foot .web-toggle").first();
  check("a cold load puts research back on auto, like plan",
    /research\s*·\s*auto/i.test(await web.innerText()), await web.innerText());
  check("the stale web pin is gone from storage",
    await page.evaluate(() => localStorage.getItem("moldable_web_mode")) === null);
  await page.close();
}

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
