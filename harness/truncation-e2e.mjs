// A reply that ran out of room is not a reply the model got wrong.
//
// The provider reports it — Anthropic as stop_reason "max_tokens", OpenAI-compatible
// gateways as finish_reason "length" — but nothing read it, so a half-written program went
// to the CAD kernel, failed there, and the user was told "Your code must define
// `function main(replicad, params) { ... }`". That blames the model for the shape of a
// program it wrote correctly and simply hadn't finished, and it is not actionable. Worse,
// the retry fed the fragment back as something to repair, so the second attempt carried a
// bigger context into the same ceiling and cost a second full-price call to hit it.
//
// Two runs here, because the recovery and the giving-up are different outcomes:
//   * TRUNCATE — cut off once, then answers properly when asked for a compact program.
//     The part must build, and the retry must NOT carry the fragment.
//   * TRUNCATE_ALWAYS — cut off every time. The user must be told what actually happened,
//     in words they can act on, and never shown the kernel's main() message.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };
const PORT = process.env.PORT ?? 5173;

/** Drive one build to completion and hand back what the chat says and what was sent. */
async function run(marker) {
  await fetch("http://localhost:8899/_reset");
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const bodies = [];
  await page.addInitScript(() => {
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
    localStorage.setItem("moldable_signin_prompted", "1");
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  await page.route("http://localhost:8899/**", async (route) => {
    const d = route.request().postData();
    if (d) bodies.push(d);
    await route.continue();
  });
  await page.locator(".launch-composer-foot .lo-trigger").click();
  await page.locator(".lo-engines .pm-opt", { hasText: /functional/i }).click();
  const planItem = page.locator(".pmenu-item", { hasText: /plan first/i });
  if (await planItem.count()) await planItem.click();
  await page.keyboard.press("Escape");
  await page.locator(".launch-composer textarea").fill(`A speaker cabinet, ${marker}`);
  await page.locator(".launch-composer .send").click();
  await page.waitForFunction(() => !!document.querySelector(".msg"), null, { timeout: 30_000 });
  const skip = page.locator("button", { hasText: /build what i asked for/i }).first();
  await skip.waitFor({ timeout: 60_000 }).catch(() => {});
  if (await skip.count()) await skip.click();
  await page.waitForFunction(() => !document.querySelector(".gen-pill"), null, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  // The WHOLE assistant side of the transcript, not just the last row: the kernel's
  // main() message is the thing that must not appear anywhere, and which row carries the
  // verdict differs between a build that recovered and one that gave up.
  const last = await page.evaluate(() => ({
    text: [...document.querySelectorAll(".msg:not(.user)")].map((e) => e.innerText).join("\n"),
  }));
  const built = await page.evaluate(() => (window.__viewerS?.()?.mesh?.geometry?.getAttribute?.("position")?.count ?? 0) > 0);
  await browser.close();
  const builds = bodies.filter((b) => /replicad/i.test(b) && !/Reply with JSON only/.test(b));
  return { last, built, builds };
}

// ---- cut off once, then answers compactly -------------------------------------------
const once = await run("TRUNCATE");
check("a cut-off reply is retried", once.builds.length >= 2, `${once.builds.length} build request(s)`);
check("the retry asks for a compact program", /cut off before the program finished/.test(once.builds[1] ?? ""));
check("and does not carry the fragment back", !/extrude\(p\.hei/.test(once.builds[1] ?? ""));
check("the part builds on the second try", once.built);
// Either shape of raw failure counts: a fragment that ends after a whole statement throws
// the kernel's "must define main", one that ends mid-expression throws a JS SyntaxError.
// Neither is something a person can act on.
const RAW_ERR = /must define|missing \)|unexpected end of input/i;
check("no raw kernel or JavaScript error is shown", !RAW_ERR.test(once.last.text));

// ---- cut off every time --------------------------------------------------------------
const always = await run("TRUNCATE_ALWAYS");
check("giving up says the model ran out of room", /ran out of room/i.test(always.last.text),
  always.last.text.replace(/\s+/g, " ").slice(-140));
check("and still shows no raw error", !RAW_ERR.test(always.last.text),
  always.last.text.replace(/\s+/g, " ").slice(-140));
check("and it stops after one compact retry, not a third full-price call", always.builds.length === 2, `${always.builds.length} build request(s)`);

// ---- the Anthropic transport, which the app's own stub never exercises ----------------
// Jerry's failing builds ran on Claude, and that path has its own body builder and its own
// stop signal (stop_reason, not finish_reason). Driven directly against a fake fetch: the
// real module, the real request body, no app in the way.
const OUT = "/tmp/anthropic.bundle.js";
execFileSync("../moldable-lite/node_modules/.bin/esbuild",
  ["../moldable-lite/src/llm/anthropic.ts", "--bundle", "--format=iife", "--global-name=AN", `--outfile=${OUT}`],
  { cwd: import.meta.dirname, stdio: "inherit" });
const b2 = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p2 = await b2.newPage();
await p2.goto("about:blank");
await p2.addScriptTag({ content: readFileSync(OUT, "utf8") });
const an = await p2.evaluate(async () => {
  const sent = [];
  const sse = (frames) => new Response(
    new ReadableStream({ start(c) {
      for (const f of frames) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(f)}\n\n`));
      c.close();
    } }),
    { status: 200 },
  );
  const req = { apiKey: "k", model: "claude-opus-5", system: "s", messages: [{ role: "user", content: "hi" }] };

  // 1. a normal stream that ends because it ran out of room
  let stops = [];
  window.fetch = async (_u, o) => {
    sent.push(JSON.parse(o.body));
    return sse([
      { type: "content_block_delta", delta: { type: "text_delta", text: "half a program" } },
      { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 32000 } },
    ]);
  };
  await AN.streamMessage(req, { onStop: (r) => stops.push(r) });

  // 2. a model whose ceiling is lower than the ask: 400, then the safe retry
  let n = 0;
  window.fetch = async (_u, o) => {
    sent.push(JSON.parse(o.body));
    if (n++ === 0) return new Response(JSON.stringify({ error: { message: "max_tokens: 32000 > 8192" } }), { status: 400 });
    return sse([{ type: "content_block_delta", delta: { type: "text_delta", text: "ok" } }]);
  };
  const text = await AN.streamMessage(req, {});
  return { max: sent.map((b) => b.max_tokens), stops, text };
});
await b2.close();
rmSync(OUT, { force: true });
check("Claude gets room for a long program", an.max[0] >= 32000, `max_tokens ${an.max[0]}`);
check("running out of room is reported, not swallowed", an.stops.includes("max_tokens"), JSON.stringify(an.stops));
check("a model with a lower ceiling is retried, not failed", an.max[2] === 8192 && an.text === "ok",
  `retry max_tokens ${an.max[2]}, text ${JSON.stringify(an.text)}`);

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
