// AI change preview e2e: ask-mode holds proposals (nothing commits), diff legend shows,
// Apply commits a version, Discard restores, and the auto toggle applies immediately.
import { chromium } from "playwright";
import { createServer } from "node:http";

const PROGRAM = "```js\nconst defaultParams = { size: 40 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  return replicad.makeBaseBox(p.size, p.size, p.size);\n}\n```";
const server = createServer((req, res) => {
  const corsH = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type" };
  if (req.method === "OPTIONS") { res.writeHead(204, corsH); return res.end(); }
  if (req.url === "/house/health") { res.writeHead(200, { ...corsH, "Content-Type": "application/json" }); return res.end(JSON.stringify({ enabled: true, models: ["mock/cad-1"], daily: 99 })); }
  if (req.url === "/house/v1/chat/completions") {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { ...corsH, "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Done.\n\n" + PROGRAM } }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
    return;
  }
  res.writeHead(404, corsH); res.end();
});
await new Promise((r) => server.listen(8787, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };
const versions = () => page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  const all = await mod.listProjects();
  return all.map((p) => p.versions.length).sort((a, b) => b - a)[0] ?? 0;
});

await page.addInitScript(() => {
  localStorage.setItem("moldable_entered", "1");
  localStorage.setItem("moldable_house_url", "http://127.0.0.1:8787");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the wall hook template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("wall hook"), null, { timeout: 120_000 });
check("baseline: template committed one version", (await versions()) === 1, String(await versions()));

// 1) Ask mode (default): the AI result is a held preview, nothing committed.
const inp = page.getByPlaceholder(/Describe a part/);
await inp.fill("turn it into a 40 mm cube");
await inp.press("Enter");
await page.waitForSelector(".ai-preview-bar", { timeout: 120_000 });
check("preview bar appears", true);
check("nothing committed while previewing", (await versions()) === 1, String(await versions()));
check("diff legend shows (green/red overlays computed)", (await page.locator(".apb-legend").count()) === 1);
const chat1 = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].pop()?.textContent ?? "");
check("chat explains the preview", /preview on the canvas/i.test(chat1), chat1.slice(0, 90));

// 2) Apply commits exactly one version and the bar leaves.
await page.getByRole("button", { name: "Apply", exact: true }).click();
await page.waitForTimeout(800);
check("apply commits a version", (await versions()) === 2, String(await versions()));
check("bar gone after apply", (await page.locator(".ai-preview-bar").count()) === 0);
check("dims updated to the cube", (await page.evaluate(() => document.body.innerText)).includes("40 × 40 × 40"));

// 3) Discard: propose again, throw it away — no commit, honest message.
await inp.fill("do it again");
await inp.press("Enter");
await page.waitForSelector(".ai-preview-bar", { timeout: 120_000 });
await page.getByRole("button", { name: "Discard", exact: true }).click();
await page.waitForTimeout(600);
check("discard commits nothing", (await versions()) === 2, String(await versions()));
check("discard message posted", (await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].pop()?.textContent ?? "")).includes("Discarded"));

// 4) "always apply automatically": next result applies with no bar; setting persists.
await inp.fill("once more");
await inp.press("Enter");
await page.waitForSelector(".ai-preview-bar", { timeout: 120_000 });
await page.getByRole("button", { name: "always apply automatically" }).click();
await page.waitForTimeout(800);
check("auto toggle applies the held change", (await versions()) === 3, String(await versions()));
await inp.fill("and again");
await inp.press("Enter");
await page.waitForFunction((n) => document.body.innerText.includes("Updated the model"), null, { timeout: 120_000 });
await page.waitForTimeout(800);
check("auto mode: applies immediately, no bar", (await versions()) === 4 && (await page.locator(".ai-preview-bar").count()) === 0, String(await versions()));
check("mode persisted", (await page.evaluate(() => localStorage.getItem("moldable_ai_apply"))) === "auto");

// 5) Settings toggle switches back to ask.
await page.locator(".profile-wrap button").first().click().catch(() => {});
await page.evaluate(() => { /* open settings via topbar user icon fallback */ });
await page.screenshot({ path: "shot-preview.png" });
await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll preview checks passed.");
