// Engine-routing e2e: (1) fresh ambiguous chat → the configured brain (mock, OpenAI-
// compatible = what OpenRouter speaks) classifies it and the app hops to Generative;
// (2) short text→3D asks get a brain "prompt polish"; (3) sculptural ask on an existing
// CAD model → auto snapshot → mesh-refine route with the History safety note.
import { chromium } from "playwright";
import { createServer } from "node:http";

const requests = [];
const POLISHED = "A coiled dragon sculpture with flowing scales, curled tail wrapped around its base, wings folded, standing stably on a rocky mound, single connected solid";
const server = createServer((req, res) => {
  const corsH = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type,x-api-key" };
  if (req.method === "OPTIONS") { res.writeHead(204, corsH); return res.end(); }
  if (req.url.endsWith("/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const raw = body;
      let kind = "other";
      if (raw.includes("route requests")) kind = "classify";
      else if (raw.includes("text-to-3D mesh generators")) kind = "polish";
      requests.push(kind);
      const reply = kind === "classify" ? "MESH" : kind === "polish" ? POLISHED : "OK";
      res.writeHead(200, { ...corsH, "Content-Type": "text/event-stream" });
      for (let i = 0; i < reply.length; i += 40) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 40) } }] })}\n\n`);
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
const init = (extra = {}) => (ctxVals) => {
  localStorage.setItem("moldable_entered", "1");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "mock", baseUrl: "http://127.0.0.1:8788/v1" }));
  for (const [k, v] of Object.entries(ctxVals)) localStorage.setItem(k, v);
};

// ---- T1: fresh ambiguous chat, Precise mode → brain says MESH → routed ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(init(), { moldable_geneng: JSON.stringify({ provider: "meshy", model: "meshy" }) });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(600);
  const ta = page.getByPlaceholder(/Describe a part/);
  await ta.fill("a swirling coral reef centerpiece"); // matches NEITHER regex → brain decides
  await ta.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("routed it to")), null, { timeout: 30_000 });
  check("T1 brain got a classify request", requests.includes("classify"), requests.join(","));
  const routedTxt = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.textContent).join(" | "));
  check("T1 routed notice → Generative", routedTxt.includes("Generative (AI mesh)"));
  const genOn = await page.evaluate(() => document.querySelector(".seg button.on")?.textContent ?? "");
  check("T1 mode switch flipped to Generative", genOn.includes("Generative"), genOn);
  check("T1 keyless engine → Settings opened (no silent fail)", await page.locator(".overlay").count() > 0);
  await page.close();
}

// ---- T2: text→3D with keyed engine → classify + polish, polished text narrated ----
{
  requests.length = 0;
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(init(), {
    moldable_geneng: JSON.stringify({ provider: "meshy", model: "meshy" }),
    moldable_provider_keys: JSON.stringify({ meshy: "msy_mock" }),
  });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(600);
  const ta = page.getByPlaceholder(/Describe a part/);
  await ta.fill("a majestic dragon"); // ORGANIC_RE hits → regex-routes to mesh, then polish
  await ta.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("expanded your ask")), null, { timeout: 30_000 });
  check("T2 polish request went to the brain", requests.includes("polish"), requests.join(","));
  check("T2 regex route needed no classify call", !requests.includes("classify"), requests.join(","));
  const polishTxt = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.textContent).join(" | "));
  check("T2 polished description narrated once", polishTxt.includes("coiled dragon sculpture"));
  await page.screenshot({ path: "shot-routing-polish.png" });
  await page.close();
}

// ---- T3: CAD model on canvas + sculptural ask → snapshot → mesh refine route ----
{
  requests.length = 0;
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(init(), {
    moldable_geneng: JSON.stringify({ provider: "meshy", model: "meshy" }),
    moldable_provider_keys: JSON.stringify({ meshy: "msy_mock" }),
  });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle("Build the box with lid template").click();
  await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("box"), null, { timeout: 120_000 });
  await page.waitForTimeout(600);

  const ta = page.getByPlaceholder(/Describe a part|Ask for a change/);
  await ta.fill("sculpt it into an organic statue");
  await ta.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("Refining your current model")), null, { timeout: 30_000 });
  check("T3 refine explainer posted (History safety note)", true);
  const hasShot = await page.waitForFunction(() => {
    const users = [...document.querySelectorAll(".msg.user")];
    return !!users[users.length - 1]?.querySelector("img");
  }, null, { timeout: 15_000 }).then(() => true).catch(() => false);
  check("T3 model snapshot attached to the request", hasShot);
  const genOn = await page.evaluate(() => document.querySelector(".seg button.on")?.textContent ?? "");
  check("T3 mode flipped to Generative", genOn.includes("Generative"), genOn);
  check("T3 no brain calls needed for the refine route", requests.length === 0, requests.join(","));
  await page.screenshot({ path: "shot-routing-refine.png" });
  await page.close();
}

await browser.close();
server.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll routing checks passed.");
