// Part-context e2e: with a project on the canvas, every AI request must carry the
// part's name/description so the brain (and the researcher) never asks "what is this
// part?". Mock relay captures the exact request body.
import { chromium } from "playwright";
import { createServer } from "node:http";

const PROGRAM = "```js\nconst defaultParams = { size: 20 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  return replicad.makeBaseBox(p.size, p.size, p.size);\n}\n```";
let captured = null;
const server = createServer((req, res) => {
  const corsH = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type" };
  if (req.method === "OPTIONS") { res.writeHead(204, corsH); return res.end(); }
  if (req.url === "/house/health") { res.writeHead(200, { ...corsH, "Content-Type": "application/json" }); return res.end(JSON.stringify({ enabled: true, models: ["mock/cad-1"], daily: 40 })); }
  if (req.url === "/house/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { captured = JSON.parse(body); } catch {}
      res.writeHead(200, { ...corsH, "Content-Type": "text/event-stream" });
      const reply = `Drilled it.\n\n${PROGRAM}`;
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
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_entered", "1");
  localStorage.setItem("moldable_house_url", "http://127.0.0.1:8787");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.waitForTimeout(800);
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the coaster template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.toLowerCase().includes("coaster"), null, { timeout: 120_000 });
await page.waitForTimeout(500);

const ta = page.getByPlaceholder(/Describe a part/);
await ta.fill("can you add a 7mm screw hole in the center?");
await ta.press("Enter");
await page.waitForFunction(() => !!window.__ctx_done || document.querySelector(".ai-preview-bar"), null, { timeout: 120_000 }).catch(() => {});
await page.waitForTimeout(300);

check("request reached the mock brain", !!captured);
const sys = captured?.messages?.find((m) => m.role === "system")?.content ?? "";
check("system prompt names the part on canvas", sys.includes('the part "Coaster"'), sys.slice(sys.indexOf("Current canvas"), sys.indexOf("Current canvas") + 90));
check("system prompt says edits refer to this part", sys.includes("Edit requests refer to this part"));
check("part description rides along", /coaster/i.test(sys.split("Current canvas")[1] ?? ""), "");

await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll context checks passed.");
