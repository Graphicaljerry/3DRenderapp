// A reply says what MOVED, before it says anything else.
//
// The complaint this answers: replies are a paragraph of correct millimetres and none of
// them tells you which number changed, so a skimmer learns nothing and a visual thinker
// learns less. The strip is computed from the geometry and the parameter map before and
// after — not from the model's prose — so it cannot be wrong about what happened even
// when the sentence underneath is vague.
//
// The check that matters: a FRESH build has nothing to compare against and must NOT
// claim a change, while an edit that moves a number must show the old value. Asserting
// only the second half would pass on a strip that always says "changed".
import { chromium } from "playwright";

const STUB = "http://localhost:8899";
await fetch(`${STUB}/_reset`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

await page.addInitScript((all) => {
  for (const [k, v] of Object.entries(all)) localStorage.setItem(k, v);
}, {
  moldable_theme: "dark",
  moldable_llm: JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }),
  moldable_signin_prompted: "1",
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

// Plan off so the send goes straight to a build — the plan card is a different probe.
const chip = page.locator(".lo-trigger");
if (!/no plan/i.test(await chip.innerText())) {
  await chip.click();
  await page.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
  await page.keyboard.press("Escape");
}

// --- 1. a FRESH build: size stated, nothing claimed as changed ---
await page.locator(".launch-composer textarea").fill("A SPECIFIC bracket");
await page.locator(".launch-composer .send").click();
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
const firstStrip = page.locator(".change-strip").last();
const hadFirst = await page.locator(".change-strip").count() > 0;
check("a fresh build shows its size", hadFirst && /60 × 40 × 24 mm/.test(await firstStrip.innerText()),
  hadFirst ? await firstStrip.innerText() : "no strip at all");
check("…and does NOT invent a 'was' it never had",
  !hadFirst || !/\bwas\b/i.test(await firstStrip.innerText()),
  hadFirst ? await firstStrip.innerText() : "");

// --- 2. an EDIT that moves a number shows the number it moved from ---
const before = await page.locator(".change-strip").count();
await page.locator(".composer textarea").fill("Make it WIDER");
await page.locator(".composer textarea").press("Enter");
await page.waitForFunction((n) => document.querySelectorAll(".change-strip").length > n, before, { timeout: 180_000 });
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
const editStrip = await page.locator(".change-strip").last().innerText();
check("an edit states the new size", /80 × 40 × 24 mm/.test(editStrip), editStrip.replace(/\n/g, " | "));
check("an edit states what it replaced", /was\s+60 × 40 × 24 mm/i.test(editStrip), editStrip.replace(/\n/g, " | "));
check("the changed parameter is named in words, not camelCase",
  /Width/.test(editStrip) && !/width[A-Z]|camel/i.test(editStrip.replace(/Width/g, "")), editStrip.replace(/\n/g, " | "));
check("the parameter shows both values", /60\s*→\s*80/.test(editStrip), editStrip.replace(/\n/g, " | "));

// --- 3. the strip sits ABOVE the prose it summarises ---
const order = await page.evaluate(() => {
  const bub = [...document.querySelectorAll(".bubble")].pop();
  if (!bub) return null;
  const strip = bub.querySelector(".change-strip");
  if (!strip) return null;
  // Any text node after the strip inside the same bubble = prose below the facts.
  return { stripFirst: bub.firstElementChild === strip || bub.children[0] === strip };
});
check("the strip leads the bubble, ahead of the paragraph", !!order?.stripFirst, JSON.stringify(order));

// --- 4. nothing phones Google for a favicon any more ---
const googleHits = [];
page.on("request", (r) => { if (/google\.com\/s2\/favicons/.test(r.url())) googleHits.push(r.url()); });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
check("no favicon requests to Google", googleHits.length === 0, googleHits.join(", "));

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
