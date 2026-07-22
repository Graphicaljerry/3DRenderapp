// Feature pack e2e: thinking-step narration, sketch/image-aware routing, OpenRouter
// Auto picking a real best model from a seeded catalogue, fastener presets in the
// hole tool, voronoi texture, fit calibration field, and the coupon template card.
import { chromium } from "playwright";
import { createServer } from "node:http";

const bodies = [];
const server = createServer((req, res) => {
  const corsH = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type,x-api-key" };
  if (req.method === "OPTIONS") { res.writeHead(204, corsH); return res.end(); }
  if (req.url.endsWith("/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      bodies.push(body);
      const reply = body.includes("route requests")
        ? "MESH"
        : body.includes("text-to-3D mesh generators")
          ? "A sleek modern sculpture"
          : "Here you go.\n```js\nconst defaultParams = { size: 20 };\nfunction main(replicad, params){ const p = { ...defaultParams, ...params }; return replicad.makeBaseBox(p.size, p.size, p.size); }\n```";
      res.writeHead(200, { ...corsH, "Content-Type": "text/event-stream" });
      for (let i = 0; i < reply.length; i += 60) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 60) } }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
    return;
  }
  res.writeHead(404, corsH);
  res.end();
});
await new Promise((r) => server.listen(8788, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

// ---- T1: thinking steps always narrate (text-only CAD build via mock brain) ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(() => {
    localStorage.setItem("moldable_entered", "1");
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "mock", baseUrl: "http://127.0.0.1:8788/v1" }));
  });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(500);
  const ta = page.getByPlaceholder(/Describe a part/);
  await ta.fill("a 20 mm cube with a 5 mm hole"); // CADish → precise, no classify call
  await ta.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /20 × 20 × 20|Updated the model|preview on the canvas/.test(b.textContent)), null, { timeout: 60_000 });
  await page.waitForTimeout(400);
  // The finished trail lives in the message's collapsible thinking block — use
  // textContent (innerText skips collapsed content).
  const thinkAll = await page.evaluate(() => document.body.textContent);
  check("T1 steps narrated: writing with the model", thinkAll.includes("Writing the CAD program with mock"), "");
  check("T1 steps narrated: kernel build", thinkAll.includes("Building the solid in the CAD kernel"));
  await page.close();
}

// ---- T2: sketch/image routing — the brain sees the attachment and routes to mesh ----
{
  bodies.length = 0;
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(() => {
    localStorage.setItem("moldable_entered", "1");
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "mock", baseUrl: "http://127.0.0.1:8788/v1" }));
    localStorage.setItem("moldable_geneng", JSON.stringify({ provider: "meshy", model: "meshy" }));
    localStorage.setItem("moldable_provider_keys", JSON.stringify({ meshy: "msy_mock" }));
  });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "sketch.png", mimeType: "image/png", buffer: PNG_1x1 });
  await page.waitForTimeout(400);
  const ta = page.locator(".composer textarea").first();
  await ta.fill("make this for me"); // neutral words — the IMAGE decides
  await ta.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("Your attachment looks")), null, { timeout: 45_000 });
  const classifyBody = bodies.find((b) => b.includes("route requests")) ?? "";
  check("T2 classify request carried the image", /image|img|data:/.test(classifyBody), classifyBody.slice(0, 60));
  const genOn = await page.evaluate(() => document.querySelector(".seg button.on")?.textContent ?? "");
  check("T2 sketch routed to Generative", genOn.includes("Generative"), genOn);
  await page.close();
}

// ---- T3: OpenRouter Auto picks the best model from the (seeded) catalogue ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const seeded = JSON.stringify({
    t: Date.now(),
    m: [
      { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", inPrice: 3e-6, reasoning: true, tools: true, vision: true },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", inPrice: 1.5e-7, reasoning: false, tools: true, vision: true },
    ],
  });
  await page.addInitScript((cat) => {
    localStorage.setItem("moldable_entered", "1");
    localStorage.setItem("moldable_openrouter_models_v2", cat);
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "openrouter", model: "auto" }));
    localStorage.setItem("moldable_llm_keys", JSON.stringify({ openrouter: "sk-or-mock" }));
  }, seeded);
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(500);
  const ta = page.getByPlaceholder(/Describe a part/);
  await ta.fill("a bracket with two 5 mm holes");
  await ta.press("Enter");
  const label = await page.waitForFunction(() => {
    const el = document.querySelector(".modehint");
    return el && el.textContent.includes("Auto →") ? el.textContent : false;
  }, null, { timeout: 30_000 }).then((h) => h.jsonValue());
  check("T3 Auto routes to the strongest model (not flash)", label.includes("claude-sonnet-4.5"), label);
  await page.close();
}

// ---- T4–T7 in one session: coupon card, fastener presets, voronoi, fit calibration ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });

  // T4: the coupon template card exists with a real thumbnail.
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const couponCard = page.locator(".overlay").getByTitle("Build the tolerance test coupon template");
  check("T4 coupon card in the gallery", (await couponCard.count()) === 1);
  const hasImg = await couponCard.evaluate((el) => !!el.querySelector("img")?.src);
  check("T4 coupon card has a real render", hasImg);

  // Build the wall hook for the hole-preset test.
  await page.locator(".overlay").getByTitle("Build the wall hook template").click();
  await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("wall hook"), null, { timeout: 120_000 });

  // T5: face → Hole… → pick "M3 heat-set insert" → ⌀4, 5.5 deep + boss hint.
  const canvas = page.locator(".viewerCanvas canvas");
  const box = await canvas.boundingBox();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  let holeBtn = false;
  for (const pos of [[0.42, 0.75], [0.5, 0.72], [0.38, 0.68], [0.5, 0.62]]) {
    await canvas.click({ position: { x: box.width * pos[0], y: box.height * pos[1] } });
    await page.waitForTimeout(350);
    if ((await page.getByRole("button", { name: "Hole…" }).count()) > 0) { holeBtn = true; break; }
  }
  check("T5 face offers Hole…", holeBtn);
  await page.getByRole("button", { name: "Hole…" }).click();
  await page.waitForSelector(".hole-panel");
  await page.locator(".hole-panel select").first().selectOption({ label: "M3 heat-set insert (⌀4.0 · 5.5 mm)" });
  await page.waitForTimeout(200);
  const dia = await page.locator(".hole-panel input[type=number]").first().inputValue();
  check("T5 M3 insert preset sets ⌀4", dia === "4", dia);
  const boss = await page.evaluate(() => document.querySelector(".hole-panel")?.parentElement?.textContent ?? "");
  check("T5 boss guidance shown", boss.includes("8 mm of surrounding material"), boss.slice(0, 80));
  await page.locator(".hole-panel .x").click();

  // T6: voronoi texture applies as real geometry.
  await page.getByRole("button", { name: "Surface texture" }).click();
  await page.getByRole("button", { name: "Voronoi", exact: true }).click();
  await page.getByRole("button", { name: "Apply to model" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("voronoi") && b.textContent.includes("surface texture")), null, { timeout: 120_000 });
  check("T6 voronoi texture applied", true);

  // T7: fit calibration field persists.
  await page.getByRole("button", { name: /account|profile|Settings/i }).first().click().catch(() => {});
  if (!(await page.locator(".overlay").count())) await page.locator(".topbar .iconbtn").last().click();
  await page.getByRole("button", { name: "Printer", exact: true }).click();
  const cal = page.locator('input[placeholder="0.20 (default)"]');
  await cal.scrollIntoViewIfNeeded();
  await cal.fill("0.35");
  await page.waitForTimeout(200);
  const stored = await page.evaluate(() => localStorage.getItem("moldable_fit_cal"));
  check("T7 measured clearance persists", stored === "0.35", String(stored));
  await page.screenshot({ path: "shot-printpack2.png" });
  await page.close();
}

await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll feature-pack checks passed.");
