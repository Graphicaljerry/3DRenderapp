// House AI e2e: a mock sponsored relay drives the FULL round trip — prompt → "AI" →
// program → OCCT build — with zero real keys. Also proves the feature stays hidden
// when no relay is configured (the dormant default).
import { chromium } from "playwright";
import { createServer } from "node:http";

// ---- Mock house relay: OpenAI-compatible SSE, returns a parametric cube program ----
const PROGRAM = [
  "```js",
  "const defaultParams = { size: 30 };",
  "function main(replicad, params) {",
  "  const p = { ...defaultParams, ...params };",
  "  return replicad.makeBaseBox(p.size, p.size, p.size);",
  "}",
  "```",
].join("\n");
let hits = { health: 0, chat: 0, lastModel: null };
const server = createServer((req, res) => {
  const corsH = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, corsH); return res.end(); }
  if (req.url === "/house/health") {
    hits.health++;
    res.writeHead(200, { ...corsH, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ enabled: true, models: ["mock/cad-1"], daily: 40 }));
  }
  if (req.url === "/house/v1/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.chat++;
      try { hits.lastModel = JSON.parse(body).model; } catch {}
      res.writeHead(200, { ...corsH, "Content-Type": "text/event-stream" });
      const reply = `Built a 30 mm test cube.\n\n${PROGRAM}`;
      for (let i = 0; i < reply.length; i += 40) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 40) } }] })}\n\n`);
      }
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
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

// ---- 1) Dormant by default: no relay configured → no "Built-in" anywhere. ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.locator(".modebar .mp-trigger, .modebar button").filter({ hasText: /Claude|Gemini|OpenAI|Groq|OpenRouter|Ollama|Custom/ }).first().click();
  await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  check("dormant: no Built-in option without a relay", !txt.includes("Built-in"), "");
  await page.close();
}

// ---- 2) Enabled: relay override set → auto-adopted, full round trip builds a model. ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("moldable_entered", "1");
    localStorage.setItem("moldable_house_url", "http://127.0.0.1:8787");
  });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(800); // health check settles
  check("health check hit the relay", hits.health >= 1, String(hits.health));

  // The picker offers Built-in (and it's the adopted brain since no keys exist).
  await page.locator(".modebar .mp-trigger, .modebar button").filter({ hasText: /Built-in|Claude|Gemini/ }).first().click();
  await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  check("picker offers Built-in when relay is live", txt.includes("Built-in"));
  await page.keyboard.press("Escape");

  // Full round trip: type a prompt, send — ask-mode holds a preview — Apply commits.
  const inp = page.getByPlaceholder(/Describe a part/);
  await inp.fill("a simple test cube");
  await inp.press("Enter");
  await page.waitForSelector(".ai-preview-bar", { timeout: 120_000 });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("30 × 30 × 30"), null, { timeout: 120_000 });
  check("round trip: preview applied, mock AI program built (30 × 30 × 30 mm)", true);
  check("chat call reached the relay with the allowed model", hits.chat >= 1 && hits.lastModel === "mock/cad-1", JSON.stringify(hits));
  const proj = await page.evaluate(async () => {
    const mod = await import("/src/store/projects.ts");
    return (await mod.listProjects()).some((x) => x.code?.includes("makeBaseBox(p.size"));
  });
  check("program persisted as a real editable version", proj);
  await page.screenshot({ path: "shot-house.png" });
  await page.close();
}

await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll house checks passed.");
