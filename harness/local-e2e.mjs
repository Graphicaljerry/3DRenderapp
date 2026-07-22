// Kernel-error humanization + on-device AI e2e:
// A) An OCCT C++ exception (raw pointer number like "8759440") must surface as a
//    human explanation — at the engine AND through the chat repair loop.
// B) The "On-device" brain (mocked engine, same pattern as the house relay mock)
//    does a full round trip: pick provider → prompt → program → OCCT build.
// C) Fallback: cloud provider unreachable + local model present → the app answers
//    with the on-device model instead of failing.
import { chromium } from "playwright";
import { createServer } from "node:http";

const BAD_PROGRAM = "```js\nfunction main(replicad) {\n  return replicad.makeBaseBox(10, 10, 10).fillet(50);\n}\n```"; // fillet 50 on a 10mm box → OCCT throws
const GOOD_PROGRAM = "```js\nconst defaultParams = { size: 30 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  return replicad.makeBaseBox(p.size, p.size, p.size);\n}\n```";
let chatCalls = 0;
let lastRepairText = "";
const server = createServer((req, res) => {
  const corsH = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type" };
  if (req.method === "OPTIONS") { res.writeHead(204, corsH); return res.end(); }
  if (req.url === "/house/health") { res.writeHead(200, { ...corsH, "Content-Type": "application/json" }); return res.end(JSON.stringify({ enabled: true, models: ["mock/cad-1"], daily: 40 })); }
  if (req.url === "/house/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      chatCalls++;
      try {
        const msgs = JSON.parse(body).messages ?? [];
        const lastUser = [...msgs].reverse().find((m) => m.role === "user");
        if (chatCalls > 1) lastRepairText = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content ?? "");
      } catch {}
      res.writeHead(200, { ...corsH, "Content-Type": "text/event-stream" });
      const reply = chatCalls === 1 ? `Here you go.\n\n${BAD_PROGRAM}` : `Fixed.\n\n${GOOD_PROGRAM}`;
      for (let i = 0; i < reply.length; i += 40) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 40) } }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
    return;
  }
  res.writeHead(404, corsH);
  res.end();
});
await new Promise((r) => server.listen(8787, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

// ---- A) Engine level: numeric OCCT exception → human message. ----
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  const res = await page.evaluate(async () => {
    const mod = await import("/src/engine/selectEngine.ts");
    const sel = await mod.getEngineSelection();
    try {
      await sel.engine.build({ kind: "code", code: "function main(replicad){ return replicad.makeBaseBox(10,10,10).fillet(50); }" });
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: String(e?.message ?? e) };
    }
  });
  const humane = !res.ok && !/^\d+$/.test(res.msg.trim()) && /kernel rejected|fillet/i.test(res.msg);
  check("impossible fillet fails with a human message (not a pointer number)", humane, (res.msg ?? "").slice(0, 100));
  await page.close();
}

// ---- B+C on one page: mocked house relay + mocked local engine. ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("moldable_entered", "1");
    localStorage.setItem("moldable_house_url", "http://127.0.0.1:8787");
    localStorage.setItem("moldable_local_mock", "1");
    localStorage.setItem("moldable_ai_apply", "auto"); // no preview gating — keep the flow linear
  });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(800);

  // B1) chat repair loop: bad program (OCCT throw) → readable retry note → fixed build.
  const ta = page.getByPlaceholder(/Describe a part/);
  await ta.fill("a test cube");
  await ta.press("Enter");
  await page.waitForFunction(() => document.body.innerText.includes("30 × 30 × 30"), null, { timeout: 180_000 });
  check("repair loop recovers from the kernel throw", chatCalls >= 2, `${chatCalls} AI calls`);
  check("repair prompt carries a REAL error (not a pointer number)", /kernel rejected|fillet|radius/i.test(lastRepairText) && !/\b\d{6,}\b/.test(lastRepairText), lastRepairText.slice(0, 90));
  const attemptNote = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.textContent ?? "").find((t) => t.includes("didn't build")) ?? "");
  check("chat retry note is readable", !attemptNote || /kernel|fillet|radius/i.test(attemptNote), attemptNote.slice(0, 90));

  // B2) On-device provider appears and does a full round trip (mock engine).
  await page.locator(".modebar .mp-trigger, .modebar button").filter({ hasText: /Built-in|Claude|Gemini|On-device/ }).first().click();
  await page.waitForTimeout(400);
  const pickerText = await page.evaluate(() => document.body.innerText);
  check("picker offers On-device", pickerText.includes("On-device"));
  await page.getByText("On-device", { exact: false }).first().click();
  await page.waitForTimeout(300);
  await ta.fill("a smaller cube please");
  await ta.press("Enter");
  await page.waitForFunction(() => document.body.innerText.includes("25 × 25 × 25"), null, { timeout: 180_000 });
  check("on-device brain: full round trip builds the model", true);

  await page.close();
}

// ---- C) Fallback: unreachable cloud provider + local model present. ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(() => {
    localStorage.setItem("moldable_entered", "1");
    localStorage.setItem("moldable_local_mock", "1");
    localStorage.setItem("moldable_ai_apply", "auto");
    // A dead endpoint that fails FAST (connection refused) — the dev relay would
    // otherwise hang against the sandbox network and mask the fallback.
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "test-model", baseUrl: "http://127.0.0.1:9999/v1" }));
  });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(600);
  const ta = page.getByPlaceholder(/Describe a part/);
  await ta.fill("a test cube");
  await ta.press("Enter");
  await page.waitForFunction(() => document.body.innerText.includes("25 × 25 × 25"), null, { timeout: 180_000 });
  const note = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /on-device model/.test(b.textContent ?? "")));
  check("cloud unreachable → falls back to the on-device model, with a note", note);
  await page.screenshot({ path: "shot-local-fallback.png" });
  await page.close();
}

await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll local-AI / kernel-error checks passed.");
