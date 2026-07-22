// Precision batch e2e: popover overflow fix, shift-click multi-face + extrude-all,
// and Mark & ask sending REAL 3D region coordinates (verified through a mock relay).
import { chromium } from "playwright";
import { createServer } from "node:http";

// Mock house relay that CAPTURES the request so we can assert the prompt contents.
let lastBody = null;
const PROGRAM = "```js\nconst defaultParams = { size: 20 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  return replicad.makeBaseBox(p.size, p.size, p.size);\n}\n```";
const server = createServer((req, res) => {
  const corsH = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type" };
  if (req.method === "OPTIONS") { res.writeHead(204, corsH); return res.end(); }
  if (req.url === "/house/health") { res.writeHead(200, { ...corsH, "Content-Type": "application/json" }); return res.end(JSON.stringify({ enabled: true, models: ["mock/cad-1"], daily: 40 })); }
  if (req.url === "/house/v1/chat/completions") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      lastBody = JSON.parse(b);
      res.writeHead(200, { ...corsH, "Content-Type": "text/event-stream" });
      const reply = `Flattened it.\n\n${PROGRAM}`;
      for (let i = 0; i < reply.length; i += 60) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 60) } }] })}\n\n`);
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

await page.addInitScript(() => {
  localStorage.setItem("moldable_entered", "1");
  localStorage.setItem("moldable_house_url", "http://127.0.0.1:8787");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the wall hook template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("wall hook"), null, { timeout: 120_000 });

const canvas = page.locator(".viewerCanvas canvas");
const box = await canvas.boundingBox();

// 1) Shift-click two different faces → both selected, both highlighted, extrude-all offered.
await page.getByRole("button", { name: "Select", exact: true }).click();
await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.62 }, modifiers: ["Shift"] });
await page.waitForTimeout(400);
await canvas.click({ position: { x: box.width * 0.42, y: box.height * 0.75 }, modifiers: ["Shift"] });
await page.waitForSelector(".pin-panel");
const selText = await page.locator(".pin-panel .pin-head span").innerText();
check("shift-click builds a multi-face selection", /2 faces selected/.test(selText), selText);

// 2) The quick-edit row fits inside its panel (the reported overflow), then extrude-all works.
const rowBtn = page.getByRole("button", { name: /Extrude all 2/ });
await rowBtn.waitFor();
const panelBox = await page.locator(".pin-panel").boundingBox();
const btnBox = await rowBtn.boundingBox();
check("quick-edit buttons stay inside the panel", btnBox.x + btnBox.width <= panelBox.x + panelBox.width + 1, `btn right ${Math.round(btnBox.x + btnBox.width)} vs panel right ${Math.round(panelBox.x + panelBox.width)}`);
await rowBtn.click();
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Extruded 2 faces by 2 mm/.test(b.textContent ?? "")), null, { timeout: 120_000 });
check("extrude-all applies to both faces locally", true);

// Also check the single-face popover (the exact screenshot case): pick one face.
await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.62 } });
await page.waitForSelector(".directop");
const dop = await page.locator(".directop").last().boundingBox();
const ext = await page.getByRole("button", { name: "Extrude", exact: true }).boundingBox().catch(() => null);
if (ext) check("single-face Extrude button fits its wrapper", ext.x + ext.width <= dop.x + dop.width + 1, `btn ${Math.round(ext.x + ext.width)} vs box ${Math.round(dop.x + dop.width)}`);
await page.getByRole("button", { name: "Select", exact: true }).click(); // tool off

// 3) Mark a region → chip reports what it covers → send → the request carries 3D coords.
await page.getByRole("button", { name: "Mark", exact: true }).click();
const cx = box.x + box.width * 0.55, cy = box.y + box.height * 0.5, r = Math.min(box.width, box.height) * 0.16;
await page.mouse.move(cx + r, cy);
await page.mouse.down();
for (let i = 1; i <= 26; i++) { const a = (i / 26) * Math.PI * 2; await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
await page.mouse.up();
await page.waitForSelector(".imgchip");
const chipText = await page.locator(".imgchip span").first().innerText();
check("chip reports the circled 3D extent", /covers ≈ .+mm/.test(chipText), chipText);

const inp = page.getByPlaceholder(/circled region/);
await inp.fill("flatten this so the back is flush");
await inp.press("Enter");
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Updated the model|Flattened it/.test(b.textContent ?? "")), null, { timeout: 120_000 });
const sys = (lastBody?.messages?.[0]?.content ?? "");
const userParts = lastBody?.messages?.find((m) => Array.isArray(m.content))?.content ?? [];
const utext = userParts.find((c) => c.type === "text")?.text ?? "";
const hasImage = userParts.some((c) => c.type === "image_url" || c.type === "image");
check("request carries the marked screenshot", hasImage);
check("request carries program-frame region coordinates", /maps to these coordinates in the program's own frame/.test(utext) && /x -?\d/.test(utext), utext.slice(utext.indexOf("maps to") , utext.indexOf("maps to") + 140));
check("system prompt: flatten means DELETE the feature", /DELETE the code feature/.test(sys));
check("system prompt: view direction included", /seen from the/.test(sys));

await page.screenshot({ path: "shot-precision.png" });
await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll precision checks passed.");
