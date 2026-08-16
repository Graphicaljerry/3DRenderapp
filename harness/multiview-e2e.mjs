// Multi-view reference photos: the left/back/right picker must appear for the CAD
// path too (it used to be Generative-only, so nobody in Auto ever found it), and every
// attached view must actually reach the vision model — labelled, so it knows which
// side it is looking at.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { enterWorkspace } from "./enter.mjs";

let lastBody = null;
const PROGRAM = "```js\nconst defaultParams = { size: 20 };\nfunction main(replicad, params) {\n  return replicad.makeBaseBox(20, 20, 20);\n}\n```";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type" };
const server = createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.url === "/house/health") { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); return res.end(JSON.stringify({ enabled: true, models: ["mock/cad-1"], daily: 40 })); }
  if (req.url === "/house/v1/chat/completions") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      lastBody = JSON.parse(b);
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
      const reply = `Built it.\n\n${PROGRAM}`;
      for (let i = 0; i < reply.length; i += 60) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 60) } }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
    return;
  }
  res.writeHead(404, cors); res.end();
});
await new Promise((r) => server.listen(8789, "127.0.0.1", r));

// Distinct 1x1 PNGs so each view is a different payload.
const png = (hex) => Buffer.from(hex, "base64");
const RED = png("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
const BLUE = png("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_house_url", "http://127.0.0.1:8789");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await enterWorkspace(page);

// Precise (CAD) — the mode Auto lands in for a functional part.
await page.getByRole("button", { name: "Precise (CAD)", exact: true }).click();
check("A1 multi-view row hidden with no photo", (await page.locator(".mv").count()) === 0);

// Attach the front photo through the composer's file input.
await page.locator(".composer input[type=file]").setInputFiles({ name: "front.png", mimeType: "image/png", buffer: RED });
await page.waitForSelector(".mv", { timeout: 15_000 });
check("A2 multi-view row appears for CAD once a photo is attached", true);
const slots = await page.locator(".mv-slot").count();
check("A3 front + three add-slots", slots === 4, `${slots} slots`);

// Add a left view.
await page.locator(".mv-slot.add input[type=file]").first().setInputFiles({ name: "left.png", mimeType: "image/png", buffer: BLUE });
await page.waitForSelector(".mv-slot.filled", { timeout: 15_000 });
check("A4 the extra view shows as filled", true);

await page.getByPlaceholder(/Add known measurements|Describe/).fill("rebuild this");
await page.keyboard.press("Enter");
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Updated the model|Built it|didn't build/.test(b.textContent ?? "")), null, { timeout: 120_000 });

const parts = lastBody?.messages?.find((m) => Array.isArray(m.content))?.content ?? [];
const images = parts.filter((c) => c.type === "image_url" || c.type === "image");
check("B1 BOTH photos reached the model", images.length === 2, `${images.length} image part(s)`);
const texts = parts.filter((c) => c.type === "text").map((c) => c.text).join("\n");
check("B2 the extra view is labelled by side", /Additional reference — the left side/.test(texts), texts.slice(0, 90));
check("B3 the two images are different payloads",
  new Set(images.map((i) => JSON.stringify(i).length)).size >= 1 && JSON.stringify(images[0]) !== JSON.stringify(images[1]));
const sys = lastBody?.messages?.[0]?.content ?? "";
check("B4 system prompt tells it to cross-read the views", /MORE THAN ONE PHOTO IS ATTACHED/.test(sys));

await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll multi-view checks passed.");
