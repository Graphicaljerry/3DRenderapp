// The model's reasoning is markdown, and the panel has to render it as such.
//
// Reasoning models title their sections `**Like This**` and emit `##` headings and bullet
// lists. The panel printed the raw string, so the loudest thing in it was the punctuation:
// asterisks and hashes wrapped around the words they were supposed to style.
//
// Checked in both places the reasoning appears — the live panel under the timeline while
// it streams, and the collapsed "Thought process" on the finished reply — because they are
// two different render paths and only one of them was on screen when this was reported.
import { chromium } from "playwright";

await fetch("http://localhost:8899/_reset");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

// Plan first would put a spec card between the send and the build that streams the
// reasoning. REASONING is the stub's marker for the fixture that emits it.
await page.locator(".launch-composer-foot .lo-trigger").click();
await page.locator(".lo-engines .pm-opt", { hasText: /functional/i }).click();
const planItem = page.locator(".pmenu-item", { hasText: /plan first/i });
if (await planItem.count()) await planItem.click();
await page.keyboard.press("Escape");
await page.locator(".launch-composer textarea").fill("A speaker cabinet, REASONING");
await page.locator(".launch-composer .send").click();

// A new part earns a Quick check card first; skip it — the build call is the one that
// streams reasoning.
const skip = page.locator("button", { hasText: /build what i asked for/i }).first();
await skip.waitFor({ timeout: 60_000 }).catch(() => {});
if (await skip.count()) await skip.click();

// ---- live, while it streams --------------------------------------------------------
await page.waitForFunction(
  () => (document.querySelector(".think-live .think-body")?.textContent ?? "").length > 5,
  null, { timeout: 60_000 });
// Sample the panel all the way through the stream, not once. A title arrives one token at
// a time, so an opening `**` sits unpaired for as long as it takes to write the words after
// it — a single well-timed look would miss exactly the flicker being complained about.
const samples = [];
const watching = (async () => {
  while (await page.$(".think-live .think-body")) {
    samples.push(await page.evaluate(() => document.querySelector(".think-live .think-body")?.textContent ?? "").catch(() => ""));
    await page.waitForTimeout(60);
  }
})().catch(() => {});
const live = await page.evaluate(() => {
  const el = document.querySelector(".think-live .think-body");
  return {
    text: el?.textContent ?? "",
    bold: el?.querySelectorAll("b").length ?? 0,
    heads: el?.querySelectorAll(".md-h").length ?? 0,
    items: el?.querySelectorAll("li").length ?? 0,
    md: !!el?.querySelector(".md"),
  };
});
check("the live panel renders markdown, not a string", live.md, JSON.stringify(live));
check("the bold section title is bold", live.bold >= 1, `${live.bold} bold run(s)`);
check("no asterisks are left on screen", !live.text.includes("*"), JSON.stringify(live.text.slice(0, 90)));
check("no hashes are left on screen", !/(^|\n)\s*#/.test(live.text), JSON.stringify(live.text.slice(0, 90)));

await page.waitForFunction(() => !document.querySelector(".gen-pill"), null, { timeout: 180_000 });
await watching;
const marked = samples.filter((t) => t.includes("*") || /(^|\n)\s*#/.test(t));
check("no marker ever flashes on screen while it streams", marked.length === 0,
  `${marked.length} of ${samples.length} sample(s) showed one${marked[0] ? `: ${JSON.stringify(marked[0].slice(-60))}` : ""}`);
await page.waitForTimeout(1200);

// ---- settled, in the reopened trail -------------------------------------------------
await page.locator(".think-done summary").last().click();
await page.waitForSelector(".think-done .think-body", { timeout: 10_000 });
const done = await page.evaluate(() => {
  const el = [...document.querySelectorAll(".think-done .think-body")].at(-1);
  return {
    text: el?.textContent ?? "",
    bold: el?.querySelectorAll("b").length ?? 0,
    heads: el?.querySelectorAll(".md-h").length ?? 0,
    items: el?.querySelectorAll("li").length ?? 0,
    md: !!el?.querySelector(".md"),
    // The panel is a side channel: a heading here must not outgrow the text it sits in,
    // the way the reply bubble's chapter headings deliberately do.
    headPx: [...(el?.querySelectorAll(".md-h") ?? [])].map((h) => parseFloat(getComputedStyle(h).fontSize)),
    bodyPx: parseFloat(getComputedStyle(el).fontSize),
  };
});
check("the reopened trail renders markdown too", done.md, JSON.stringify({ ...done, text: undefined }));
check("its heading is a heading", done.heads >= 1, `${done.heads} heading(s)`);
check("its list is a list", done.items >= 2, `${done.items} item(s)`);
check("nothing is left showing its markers", !done.text.includes("*") && !/(^|\n)\s*#/.test(done.text),
  JSON.stringify(done.text.slice(0, 120)));
check("headings stay at the panel's own scale", done.headPx.every((p) => p <= done.bodyPx),
  `headings ${done.headPx.join(", ")}px vs body ${done.bodyPx}px`);

await page.screenshot({ path: "shot-thinkmd.png" });
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
