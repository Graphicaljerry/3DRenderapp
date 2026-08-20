// Editing a part must not re-bill every dead version of its program.
//
// The history sent with each request carried the FULL replicad program in every assistant
// turn, while the current program travels with the request anyway (verbatim in the user
// message on the edit path). So a session's fifth edit paid for four superseded copies of
// the same part — thousands of input tokens per message, buying nothing.
//
// The invariant: however long the session, the messages of one request carry at most ONE
// full program. Asserted on the real request bodies across a build and two edits, plus a
// unit pass over the trimmer itself (the keepNewest rule and the never-touch-user rule are
// edge cases a UI run can't isolate).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

await fetch("http://localhost:8899/_reset");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
const bodies = [];
await page.route("http://localhost:8899/**", async (route) => {
  const d = route.request().postData();
  if (d) bodies.push(d);
  await route.continue();
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

// Plan off — this probe is about the build requests, not the spec card.
await page.locator(".launch-composer-foot .lo-trigger").click();
await page.locator(".lo-engines .pm-opt", { hasText: /functional/i }).click();
const planItem = page.locator(".pmenu-item", { hasText: /plan first/i });
if (await planItem.count()) await planItem.click();
await page.keyboard.press("Escape");

const idle = () => page.waitForFunction(() => !document.querySelector(".gen-pill"), null, { timeout: 180_000 });
/** One turn: type, send, answer the Quick check if one appears, wait for the build,
 *  then Apply or Discard the preview. `first` = the only send that can earn a Quick
 *  check card; later sends skip that wait instead of burning it every time. */
const send = async (text, verdict = "apply", first = false) => {
  const before = bodies.length;
  const box = page.locator(".launch-composer textarea, .composer textarea").first();
  await box.fill(text);
  await box.press("Enter");
  // The request itself, then quiet — "no spinner" alone is true before the work starts too.
  for (const t = Date.now() + 90_000; bodies.length === before && Date.now() < t; ) await page.waitForTimeout(200);
  if (first) {
    // A fresh part earns a Quick check card; skip it — this probe is about the build
    // call. Generous wait: under three-lane suite load this took >8s and a swallowed
    // miss here cascades into every later assertion.
    const skip = page.locator("button", { hasText: /build what i asked for/i }).first();
    await skip.waitFor({ timeout: 30_000 }).catch(() => {});
    if (await skip.count()) await skip.click();
  }
  // Let the work START before waiting for it to stop — the pill takes a beat to appear,
  // and "no pill" is also true in that beat.
  await page.waitForSelector(".gen-pill", { timeout: 8_000 }).catch(() => {});
  await idle();
  // The result arrives as a preview; commit or reject it so the statusbar settles.
  // It appears deterministically once the build lands, so this wait only expires when
  // something is genuinely wrong — 30s keeps suite-load slowness from reading as that.
  const btn = page.locator(".ai-preview-bar button", { hasText: verdict === "discard" ? /^discard$/i : /^apply$/i }).first();
  await btn.waitFor({ timeout: 30_000 }).catch(() => {});
  if (await btn.count()) { await btn.click(); await idle(); }
  await page.waitForTimeout(800);
};

// What one request's MESSAGES carry (the system prompt legitimately holds example
// programs, so it is excluded — the waste lived in the history, not the guide).
const anatomy = (body) => {
  const msgs = (JSON.parse(body).messages ?? []).filter((m) => m.role !== "system");
  const text = msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  return {
    programs: (text.match(/function main\(/g) ?? []).length,
    stubs: (text.match(/program omitted — superseded/g) ?? []).length,
    bytes: text.length,
  };
};
const lastBuild = () => [...bodies].reverse().find((b) => /replicad/i.test(b) && !/Reply with JSON only/.test(b)) ?? "";

// ---- a build and two edits ------------------------------------------------------------
await send("A small plate 30 x 20 x 5 mm", "apply", true);
const dims = () => page.locator(".statusbar").innerText().then((t) => t.match(/(\d+) × (\d+) × (\d+)/)?.slice(1).map(Number) ?? []);
const d1 = await dims();
if (d1.length !== 3) await page.screenshot({ path: "shot-tokentrim-debug.png" });
check("the first build lands", d1.length === 3, `${JSON.stringify(d1)} · ${bodies.length} request(s)`);

// ---- a DISCARDED proposal must leave the conversation too ------------------------------
// The send loop records its exchange into the history when the build succeeds — before
// Apply/Discard is answered. On Discard, the rejected program must not survive as "the
// newest code" for the next request to build on.
await send("make the small plate WIDER, 50 mm", "discard");
const dDisc = await dims();
check("discard puts the old part back", dDisc[0] === 30, JSON.stringify(dDisc));

await send("make the small plate WIDER, 50 mm");
const e1 = anatomy(lastBuild());
const afterDiscard = JSON.parse(lastBuild()).messages.filter((m) => m.role !== "system")
  .map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
check("the discarded exchange is gone from the conversation",
  (afterDiscard.match(/WIDER, 50 mm/g) ?? []).length === 1, "only the live ask mentions it");
check("the first edit sends exactly one program", e1.programs === 1, JSON.stringify(e1));
const d2 = await dims();
check("and the edit still works — the part actually changed", d1[0] !== d2[0], `${d1[0]} → ${d2[0]}`);

await send("keep the small plate WIDER, 50 mm, thanks");
const e2 = anatomy(lastBuild());
check("the second edit still sends exactly one program", e2.programs === 1, JSON.stringify(e2));
check("older programs became one-line notes", e2.stubs >= 1, `${e2.stubs} stub(s)`);
check("the conversation does not grow by a program per turn", e2.bytes < e1.bytes + 2_500,
  `${e1.bytes}b → ${e2.bytes}b`);

// ---- the trimmer's own rules, through the real module ----------------------------------
const OUT = "/tmp/extract.bundle.js";
execFileSync("../moldable-lite/node_modules/.bin/esbuild",
  ["../moldable-lite/src/llm/extract.ts", "--bundle", "--format=iife", "--global-name=EX", `--outfile=${OUT}`],
  { cwd: import.meta.dirname, stdio: "inherit" });
await page.addScriptTag({ content: readFileSync(OUT, "utf8") });
const unit = await page.evaluate(() => {
  const prog = (n) => "```js\nfunction main() { return " + n + "; }\n```";
  const msgs = [
    { role: "user", content: "build it like this:\n" + prog(0) },
    { role: "assistant", content: "Here.\n\n" + prog(1) },
    { role: "user", content: "wider" },
    { role: "assistant", content: prog(2) },
    { role: "assistant", content: [{ type: "text", text: prog(3) }] },
  ];
  const keep = EX.trimOldPrograms(msgs, true);
  const drop = EX.trimOldPrograms(msgs, false);
  const has = (m) => typeof m.content === "string" && m.content.includes("function main");
  return {
    userUntouched: has(keep[0]) && has(drop[0]),
    keepNewest: !has(keep[1]) && has(keep[3]),
    dropAll: !has(drop[1]) && !has(drop[3]),
    arraysUntouched: Array.isArray(keep[4].content) && Array.isArray(drop[4].content),
    originalIntact: has(msgs[1]),
    empty: EX.trimOldPrograms([], true).length === 0,
  };
});
check("a user's own pasted code is never touched", unit.userUntouched);
check("keepNewest spares exactly the newest program", unit.keepNewest);
check("the edit path drops every history program", unit.dropAll);
check("non-string content passes through untouched", unit.arraysUntouched);
check("the input array is not mutated", unit.originalIntact);
check("an empty history is fine", unit.empty);
rmSync(OUT, { force: true });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
