// A reply that carries the program AND a second code block must still build.
//
// Models answering a spec that ends "put these exact values in defaultParams" habitually
// write the program, then recap the parameter object in a second ```js block. Extraction
// took the LAST fenced block, so the kernel was handed the recap: valid JavaScript with
// no main() in it. The user saw "Your code must define `function main(replicad, params)`"
// — the kernel blaming the model for a program it had written correctly one block higher
// up — and paid for two full attempts to arrive back at the same wall.
//
// Two live runs (the recap shape must build; a genuinely main-less reply must fail in
// plain English) plus a unit pass over the extractor, where the module-syntax and
// block-choice rules can be isolated.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

await fetch("http://localhost:8899/_reset");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

// Plan off: this probe is about what comes back from the build call, not the spec card.
const chip = page.locator(".lo-trigger");
if (!/no plan/i.test(await chip.innerText())) {
  await chip.click();
  await page.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
  await page.keyboard.press("Escape");
}

const idle = () => page.waitForFunction(() => !document.querySelector(".gen-pill") && !document.querySelector(".bubble-open"), null, { timeout: 240_000 });
const chatText = () => page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble, .msg.assistant .bubble-open")].map((b) => b.innerText).join(" | "));

// ---- 1) the recap shape builds -------------------------------------------------------
await page.locator(".launch-composer textarea").fill("A SPECIFIC tray, RECAPBLOCK please");
await page.locator(".launch-composer .send").click();
// A fresh part can earn a Quick check card; take the straight-to-build door if it shows.
const skip = page.locator("button", { hasText: /build what i asked for/i }).first();
await skip.waitFor({ timeout: 30_000 }).catch(() => {});
if (await skip.count()) await skip.click();
await page.waitForSelector(".gen-pill", { timeout: 15_000 }).catch(() => {});
await idle();
await page.waitForTimeout(800);

// The stub's program is 62 x 41 x 23; the recap block it trails is not a program at all,
// so those exact numbers can only come from the kernel having run the right block. The
// result arrives as a held preview, so the size is in the chat before the statusbar.
const t1 = await chatText();
check("a program followed by a recap block still builds", /62 × 41 × 23/.test(t1), t1.replace(/\n/g, " ").slice(0, 130));
check("and the kernel's main() complaint never reaches the chat", !/must define/i.test(t1), t1.replace(/\n/g, " ").slice(0, 120));
const apply = page.locator(".ai-preview-bar button", { hasText: /^apply$/i }).first();
await apply.waitFor({ timeout: 30_000 }).catch(() => {});
if (await apply.count()) { await apply.click(); await idle(); }
const dims = await page.evaluate(() => document.querySelector(".statusbar")?.innerText.match(/(\d+) × (\d+) × (\d+)/)?.slice(1).map(Number) ?? []);
check("the built part is the one the program describes", dims[0] === 62 && dims[1] === 41 && dims[2] === 23, JSON.stringify(dims));

// ---- 2) a reply with NO program fails in plain English -------------------------------
// BADCODE is a single block that genuinely defines nothing — there is no other block to
// fall back to, so this is the case the message has to carry on its own.
//
// A FRESH page, not another turn on the one above: the app sends the conversation with
// every request, so "RECAPBLOCK" is still in the history and the stub — which matches on
// the whole body — kept answering with the recap fixture. The first run of this probe
// read that as BADCODE failing to fail.
const page2 = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page2.on("pageerror", (e) => pageErrors.push(String(e)));
await page2.addInitScript(() => {
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page2.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page2.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
const chip2 = page2.locator(".lo-trigger");
if (!/no plan/i.test(await chip2.innerText())) {
  await chip2.click();
  await page2.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
  await page2.keyboard.press("Escape");
}
await page2.locator(".launch-composer textarea").fill("A SPECIFIC bracket, BADCODE please");
await page2.locator(".launch-composer .send").click();
const skip2 = page2.locator("button", { hasText: /build what i asked for/i }).first();
await skip2.waitFor({ timeout: 30_000 }).catch(() => {});
if (await skip2.count()) await skip2.click();
await page2.waitForSelector(".gen-pill", { timeout: 15_000 }).catch(() => {});
// The retry loop makes a second full attempt before giving up.
await page2.waitForFunction(() => !document.querySelector(".gen-pill") && !document.querySelector(".bubble-open"), null, { timeout: 240_000 });
await page2.waitForTimeout(1000);
const t2 = await page2.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble, .msg.assistant .bubble-open")].map((b) => b.innerText).join(" | "));
check("a main-less reply is explained, not quoted at the user", /came back without a finished program/i.test(t2), t2.replace(/\n/g, " ").slice(-150));
check("the kernel's own wording stays out of the chat", !/must define `?function main/i.test(t2));
check("no uncaught exception took the render down", pageErrors.length === 0, pageErrors.join(" | "));

// ---- 3) the extractor's own rules, through the real module ---------------------------
const OUT = "/tmp/extract.mainblock.js";
execFileSync("../moldable-lite/node_modules/.bin/esbuild",
  ["../moldable-lite/src/llm/extract.ts", "--bundle", "--format=iife", "--global-name=EX", `--outfile=${OUT}`],
  { cwd: import.meta.dirname, stdio: "inherit" });
await page.addScriptTag({ content: readFileSync(OUT, "utf8") });
const unit = await page.evaluate(() => {
  const PROG = "const defaultParams = { w: 3 };\nfunction main(replicad, params) { return replicad.makeBaseBox(1, 1, 1); }";
  // The worker's gate, mirrored: sanitize() then compile with new Function.
  const runs = (text) => {
    const code = EX.stripModuleSyntax(EX.extractJsBlock(text));
    try {
      return typeof new Function("replicad", `"use strict";\n${code}\n;\nreturn (typeof main !== "undefined") ? main : undefined;`)({}) === "function";
    } catch { return false; }
  };
  const fence = (s, tag = "js") => "```" + tag + "\n" + s + "\n```";
  return {
    recapAfter: runs(fence(PROG) + "\n\nParameters:\n\n" + fence("const defaultParams = { w: 3, d: 4 };")),
    jsonAfter: runs(fence(PROG) + "\n\n" + fence('{ "w": 3 }', "json")),
    proseAfter: runs(fence(PROG) + "\n\n" + fence("Print it upright.", "")),
    emptyAfter: runs(fence(PROG) + "\n\n```\n```"),
    exportFn: runs(fence("export function main(replicad) { return replicad.makeBaseBox(1,1,1); }")),
    exportDefault: runs(fence(PROG + "\nexport default main;")),
    exportNamed: runs(fence(PROG + "\nexport { main };")),
    commonJs: runs(fence(PROG + "\nmodule.exports = main;")),
    arrow: runs(fence("const main = (replicad) => replicad.makeBaseBox(1,1,1);")),
    asyncFn: runs(fence("async function main(replicad) { return replicad.makeBaseBox(1,1,1); }")),
    noFence: runs(PROG),
    unclosed: runs("Here:\n```js\n" + PROG),
    // Two blocks that BOTH define main: the later one is the corrected attempt and must
    // still win — the rule this extractor was originally written for.
    laterWins: !EX.extractJsBlock(fence("function main(){ return BROKEN }") + "\n" + fence(PROG)).includes("BROKEN"),
    // And a recap block BEFORE the program must not be preferred just for defining nothing.
    recapBefore: runs(fence("const defaultParams = { w: 3 };") + "\n" + fence(PROG)),
  };
});
for (const [k, ok] of Object.entries(unit)) check(`extractor: ${k}`, ok === true, ok === true ? "" : String(ok));

await page.screenshot({ path: "shot-mainblock.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll main-block checks passed.");
