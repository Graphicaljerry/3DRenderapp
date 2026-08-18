// Precision batch e2e: popover overflow fix, shift-click multi-face + extrude-all,
// and Mark & ask sending REAL 3D region coordinates (verified through a mock relay).
import { chromium } from "playwright";
import { createServer } from "node:http";
import { enterWorkspace, awaitBuild, pickFace, modelPoints } from "./enter.mjs";

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
  localStorage.setItem("moldable_house_url", "http://127.0.0.1:8787");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle(/^Build the phone stand\b/).click();
await awaitBuild(page);

const canvas = page.locator(".viewerCanvas canvas");
const box = await canvas.boundingBox();

// 1) Shift-click two different faces → both selected, both highlighted, extrude-all offered.
// Four things moved under this step. .pin-panel is the point/Note panel now ("Point N ·
// face · x,y,z"); the face verbs live in the ContextBar at the selection (20c0138);
// picking needs a tool armed at all, because the standalone Select tool was absorbed
// into Modify (044ab7f); and the model is the phone stand rather than the headphone desk
// hook, which is curved nearly everywhere — a click on it never produced a face pick at
// all, so nothing downstream could run.
const picked = await pickFace(page);
check("a face picks with Modify armed", picked);
await page.waitForSelector(".ctxbar, .sel-acts", { timeout: 30_000 });
// Shift-click a SECOND projected surface point to add to the selection. Fixed canvas
// fractions were used here and hit the background.
// The multi-face row is the readout: "Push / Pull all N". Matching /2 faces|2 selected/
// matched nothing, so the loop never stopped and shift-clicked its way to six.
const twoPicked = /Push ?\/ ?Pull all 2\b/;
const selCount = async () => page.evaluate(() => document.querySelector(".dock-body, .ctxbar, .sel-acts")?.textContent ?? "");
let selText = await selCount();
for (const [x, y] of await modelPoints(page)) {
  if (twoPicked.test(selText)) break;
  await page.keyboard.down("Shift");
  await page.mouse.click(x, y);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(150);
  selText = await selCount();
}
check("shift-click builds a multi-face selection", twoPicked.test(selText), selText.slice(0, 120));

// 2) The quick-edit row fits inside its panel (the reported overflow), then extrude-all works.
// "Extrude all {n}" was renamed "Push / Pull all {n}" (3fdd6c4).
const rowBtn = page.getByRole("button", { name: /Push \/ Pull all 2/ });
await rowBtn.waitFor();
const panelBox = await page.locator(".ctxbar, .sel-acts").first().boundingBox();
const btnBox = await rowBtn.boundingBox();
check("quick-edit buttons stay inside the panel", btnBox.x + btnBox.width <= panelBox.x + panelBox.width + 1, `btn right ${Math.round(btnBox.x + btnBox.width)} vs panel right ${Math.round(panelBox.x + panelBox.width)}`);
// The evidence is a new History version, not a chat line: direct edits post no receipt
// (they were muted as repetitive noise), so waiting on "Extruded 2 faces by 2 mm" was
// waiting on a sentence the app stopped writing.
const versionsBefore = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  return (await mod.listProjects())[0]?.versions.length ?? 0;
});
await rowBtn.click();
const committed = await page.waitForFunction(async (n) => {
  const mod = await import("/src/store/projects.ts");
  return ((await mod.listProjects())[0]?.versions.length ?? 0) > n;
}, versionsBefore, { timeout: 120_000 }).then(() => true).catch(() => false);
check("extrude-all applies to both faces locally", committed, `${versionsBefore} version(s) before`);

// RETIRED: "single-face Extrude button fits its wrapper". .directop lives inside a
// ContextBar gated on `!modifyCtl.op`, and Modify — the only tool that arms face picking
// since it absorbed Select — sets an op the moment it arms. So the gate can never be
// satisfied and the bar cannot appear on any path a user has. The single-face verbs are
// on .sel-acts now (Rest on plate · Push/Pull · Hole… · Round), which regress-465-e2e
// and hole-e2e both exercise; the wrapper this measured no longer renders.
await page.keyboard.press("Escape"); // drop the selection and disarm Modify

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

// The composer, by its own selector. Matching on placeholder TEXT is unreliable now:
// fitPlaceholder shortens the string to whatever the box can show without clipping, so
// "circled region" may not be in the rendered placeholder at all.
const inp = page.locator(".composer textarea").first();
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
