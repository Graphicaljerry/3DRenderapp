// Double-submit regression: tapping Send twice (or hammering Enter) must produce ONE
// request and ONE "Thinking…" bubble. The guard used to read React state, which only
// updates after a render — so two taps in the same tick both passed it, giving two
// live thinking bubbles, two API calls, and a spurious network error from the loser.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { enterWorkspace } from "./enter.mjs";

let calls = 0;
const PROGRAM = "```js\nconst defaultParams = { size: 20 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  return replicad.makeBaseBox(p.size, p.size, p.size);\n}\n```";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type" };
const server = createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.url === "/house/health") { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); return res.end(JSON.stringify({ enabled: true, models: ["mock/cad-1"], daily: 40 })); }
  if (req.url === "/house/v1/chat/completions") {
    calls++;
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
      const reply = `Built it.\n\n${PROGRAM}`;
      // Deliberately slow: keeps the request in flight long enough for a second
      // tap to race it, which is exactly the situation that used to double-fire.
      let i = 0;
      const tick = setInterval(() => {
        if (i >= reply.length) { clearInterval(tick); res.write("data: [DONE]\n\n"); return res.end(); }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 24) } }] })}\n\n`);
        i += 24;
      }, 60);
    });
    return;
  }
  res.writeHead(404, cors); res.end();
});
await new Promise((r) => server.listen(8788, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_house_url", "http://127.0.0.1:8788");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await enterWorkspace(page);

// A) Two clicks on Send, back to back, before any re-render can disable the button.
const box = page.locator(".composer textarea");
await box.fill("a 20 mm cube");
const send = page.getByRole("button", { name: "Send", exact: true });
await Promise.all([send.click(), send.click({ force: true })]);
await page.waitForTimeout(1200);
check("A1 double-tapping Send fires ONE request", calls === 1, `${calls} request(s)`);
const replies = await page.locator(".msg.assistant").count();
check("A2 exactly one assistant reply (not two thinking bubbles)", replies === 1, `${replies}`);
const users = await page.locator(".msg.user").count();
check("A3 exactly one user message", users === 1, `${users}`);

await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Updated the model|Built it/.test(b.textContent ?? "")), null, { timeout: 120_000 });

// B) Enter hammered while a request is already in flight.
calls = 0;
await box.fill("make it 30 mm");
await box.press("Enter");
await box.press("Enter");
await box.press("Enter");
await page.waitForTimeout(1200);
check("B1 hammering Enter fires ONE request", calls === 1, `${calls} request(s)`);
const live = await page.locator(".think-live").count();
check("B2 only one live thinking panel", live <= 1, `${live}`);
const replies2 = await page.locator(".msg.assistant").count();
check("B3 one new assistant reply, not three", replies2 === 2, `${replies2} total`);

await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll double-send checks passed.");
