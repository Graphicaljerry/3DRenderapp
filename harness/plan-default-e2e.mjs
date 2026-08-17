// Planning is on for every NEW part, it says so on the Launchpad, and it plans from
// EVERY reference you attached.
//
// Three things this guards:
//  1. The chip. Plan mode ran by default and nothing on the Launchpad said so — you
//     typed a sentence, pressed send, and a spec card you never asked for appeared.
//  2. The default. "Off" used to be a permanent global setting, so switching it off once
//     mid-project silently skipped the spec on every part you ever started afterwards.
//     Starting a new part must put it back on.
//  3. The evidence. The BUILDER has always received every attached photo; the PLAN — the
//     one artefact you actually read and correct — was drafted from the first one only.
//     A dimension visible only in the third photo could not reach the plan at all.
//     Asserted against the stub's /_stats, which reports what the request really carried,
//     not against the UI's own claim about itself.
import { chromium } from "playwright";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STUB = "http://localhost:8899";
// The payload checks index into the stub's request log, so it has to start empty —
// otherwise a run that follows other probes slices past its own requests and reports
// "the planner got nothing", which reads as an app bug and moves with what ran before.
await fetch(`${STUB}/_reset`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

// Three distinguishable 1x1 PNGs — the count is what matters, not the pixels.
const dir = mkdtempSync(join(tmpdir(), "planrefs-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const files = [1, 2, 3].map((n) => { const f = join(dir, `ref${n}.png`); writeFileSync(f, PNG); return f; });

await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  // The one-time sign-in nudge fires on the first character typed into the composer and
  // puts a modal over the send button. It is not what this probe is testing; mark it
  // already shown.
  localStorage.setItem("moldable_signin_prompted", "1");
  // Deliberately NOT seeding moldable_plan: the default is the thing under test.
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

// --- 1. the chip states the default, on the row with the send button ---
const chip = page.locator(".plan-toggle");
check("Launchpad shows a plan chip", await chip.count() === 1);
check("chip is ON by default", (await chip.getAttribute("class") ?? "").includes("on"), await chip.innerText());
check("chip says so in words", /plan first\s*·\s*on/i.test(await chip.innerText()), await chip.innerText());
const inFoot = await page.evaluate(() => !!document.querySelector(".launch-composer-foot .plan-toggle"));
check("chip sits in the composer foot, not a menu", inFoot);

// --- 2. it is a real control, not a label ---
await chip.click();
check("clicking turns it off", !(await chip.getAttribute("class") ?? "").includes("on"), await chip.innerText());
await chip.click();
check("clicking turns it back on", (await chip.getAttribute("class") ?? "").includes("on"));

// --- 3. every attached reference reaches the PLANNER ---
await page.setInputFiles(".launch-composer input[type=file]", files);
await page.waitForSelector(".launch-imgchip", { timeout: 20_000 });
const shown = await page.locator(".launch-imgchip span").first().innerText();
check("all three references attached", /3 reference pictures/i.test(shown), shown);

const before = (await (await fetch(`${STUB}/_stats`)).json()).length;
await page.locator(".launch-composer textarea").fill("A wall bracket for a 32 mm pipe");
await page.locator(".launch-composer .send").click();
await page.waitForSelector(".plan-card", { timeout: 120_000 });
check("the plan card appears without being asked for", true);

// The payload the planner actually received. The FIRST request after send is the plan
// draft (routing is skipped: an attachment plus this wording goes straight through).
const stats = await (await fetch(`${STUB}/_stats`)).json();
const fresh = stats.slice(before);
const planReq = fresh.find((s) => s.images > 0);
check("the planner received all 3 references, not just 1", planReq?.images === 3,
  `images=${planReq?.images ?? "none"} across ${fresh.length} new request(s)`);

// --- 4. the card is the spec, and it is correctable ---
const card = await page.locator(".plan-card").first().innerText();
check("plan card names the part", /pipe wall bracket/i.test(card));
check("plan card shows the assumptions being made for you", /assuming/i.test(card), card.slice(0, 60));
check("plan card offers Build / Edit / Skip", await page.locator(".plan-actions button").count() === 3);

// --- 5. a NEW part plans again, even after turning it off ---
await page.locator(".plan-actions .link").click(); // Skip the plan → builds from the request
await page.waitForFunction(() => !document.querySelector(".plan-card:not(.done)"), null, { timeout: 120_000 });
// Turn it off from inside the workspace, the way the old sticky pref got set. This has
// to genuinely happen, or the reset check below passes for the wrong reason.
// `.opt-trigger` — Research/Plan/Fit fold behind one button, and its LABEL changes to
// name whatever is off its default, so matching on the words "Build options" only works
// while everything is default. Match the class.
await page.locator(".opt-trigger").click();
await page.waitForSelector(".pmenu-item", { timeout: 10_000 });
const offBtn = page.locator(".pmenu-item").filter({ hasText: /plan first|build straight away/i }).first();
const label = await offBtn.innerText();
if (/plan first/i.test(label)) await offBtn.click(); // "Plan first" = on now; clicking turns it off
await page.waitForFunction(() => localStorage.getItem("moldable_plan") === "off", null, { timeout: 10_000 });
check("plan really was switched off in the workspace", await page.evaluate(() => localStorage.getItem("moldable_plan")) === "off");
await page.keyboard.press("Escape");

// Home, then a new part: the chip must be back on.
await page.locator(".brandbtn").click();
await page.waitForSelector(".launch-composer textarea", { timeout: 30_000 });
const chip2 = page.locator(".plan-toggle");
check("a NEW part is planned again, whatever the last one chose",
  (await chip2.getAttribute("class") ?? "").includes("on"), await chip2.innerText());
check("localStorage no longer pins plan off", await page.evaluate(() => localStorage.getItem("moldable_plan")) !== "off");

// --- 6. the chip is a gate, not a label: OFF must actually skip the plan ---
// Everything above proves the chip changes its own appearance and that ON draws a card.
// None of it proves the chip reaches send(). A wiring bug that left the gate reading a
// stale `planOn` while the chip toggled happily would pass every check so far.
//
// On a fresh page, because the transcript above still holds a skipped plan card: counting
// ".plan-card" on the used page would be counting history, and setting the chip by
// clicking blind would depend on whichever state the previous section left behind.
{
  const off = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await off.addInitScript(() => {
    localStorage.setItem("moldable_theme", "dark");
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
    localStorage.setItem("moldable_signin_prompted", "1");
  });
  await off.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await off.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  const oc = off.locator(".plan-toggle");
  if ((await oc.getAttribute("class") ?? "").includes("on")) await oc.click();
  check("chip is off before the send", !(await oc.getAttribute("class") ?? "").includes("on"), await oc.innerText());

  await off.locator(".launch-composer textarea").fill("A SPECIFIC 30 mm small plate, 5 mm thick");
  await off.locator(".launch-composer .send").click();
  // Wait for the BUILD, not for a quiet few seconds: "no plan card appeared" is also
  // exactly what a dead send looks like, so the build finishing is what makes the
  // absence of a card mean something.
  await off.waitForFunction(() => !!document.querySelector(".viewer canvas, canvas"), null, { timeout: 180_000 });
  await off.waitForFunction(() => !document.querySelector(".stage-line, .thinking"), null, { timeout: 180_000 }).catch(() => {});
  check("chip OFF skips the plan and builds straight away",
    await off.locator(".plan-card").count() === 0,
    `${await off.locator(".plan-card").count()} plan card(s) after an off send`);
  await off.close();
}

// --- 7. a cold load resets a stale pin ---------------------------------------
// The reset in startNew/goHome can only run if the app is already open. Someone who
// turned planning off mid-part and closed the tab never runs either — planOn boots
// straight out of storage — so yesterday's "off" would still be in force this morning.
{
  const cold = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await cold.addInitScript(() => {
    localStorage.setItem("moldable_theme", "dark");
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
    localStorage.setItem("moldable_signin_prompted", "1");
    localStorage.setItem("moldable_plan", "off"); // pinned in a tab closed long ago
  });
  await cold.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await cold.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  const cc = cold.locator(".plan-toggle");
  check("a cold load starts planned, whatever a closed tab pinned",
    (await cc.getAttribute("class") ?? "").includes("on"), await cc.innerText());

  // --- 8. ...but a look around the shelves is not a new part -----------------
  // "All templates" and "All projects" enter the WORKSPACE to show their modal, and the
  // wordmark is the only way back — so the trip runs goHome. Turning the chip off and
  // going to look at something must not quietly undo the choice.
  await cc.click();
  check("chip turned off on the Launchpad", !(await cc.getAttribute("class") ?? "").includes("on"));
  // ".launch-more", not the words: the button is labelled with the template COUNT
  // ("All 12"), so matching on "templates" finds nothing and the trip never happens.
  await cold.locator(".launch-more").first().click();
  await cold.waitForSelector(".overlay", { timeout: 20_000 });
  // The X, not Escape: this modal binds no key, so an Escape leaves the overlay up and
  // every later click lands on the backdrop instead of the thing it aimed at.
  await cold.locator(".overlay .x").first().click();
  await cold.waitForSelector(".overlay", { state: "detached", timeout: 20_000 });
  await cold.locator(".brandbtn").click();
  await cold.waitForSelector(".launch-composer textarea", { timeout: 30_000 });
  check("browsing templates does not undo a Launchpad choice",
    !(await cold.locator(".plan-toggle").getAttribute("class") ?? "").includes("on"),
    await cold.locator(".plan-toggle").innerText());
  await cold.close();
}

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
