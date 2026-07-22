// Cost-clarity e2e: the price of a mesh run must be visible BEFORE it starts
// (mode hint + "Preparing…" + progress lines), stamped on the success summary,
// recorded in the local spend ledger, and surfaced in Settings → 3D engine
// (month-to-date spend + a live Meshy balance check via the stubbed relay).
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

// Minimal valid GLB: one triangle, 20×20×10 "mm" — enough for GLTFLoader to
// flatten into a geometry with non-zero dims.
function makeGlb() {
  const pos = Buffer.from(new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 10]).buffer);
  const idx = Buffer.from(new Uint16Array([0, 1, 2]).buffer);
  const bin = Buffer.concat([pos, idx, Buffer.alloc((4 - ((pos.length + idx.length) % 4)) % 4)]);
  let json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length, byteLength: idx.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [20, 20, 10] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12), jc = Buffer.alloc(8), bc = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  jc.writeUInt32LE(json.length, 0); jc.writeUInt32LE(0x4e4f534a, 4);
  bc.writeUInt32LE(bin.length, 0); bc.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jc, json, bc, bin]);
}
const GLB = makeGlb();

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => {
  localStorage.setItem("moldable_entered", "1");
  localStorage.setItem("moldable_geneng", JSON.stringify({ provider: "meshy", model: "meshy" }));
  localStorage.setItem("moldable_provider_keys", JSON.stringify({ meshy: "msy_mock" }));
});

// Stub the Meshy relay: task accepted -> succeeded with a same-origin GLB URL;
// plus the balance endpoint the Settings button hits.
await page.route("**/prox/meshy/**", async (route) => {
  const url = route.request().url();
  if (url.includes("/openapi/v1/balance"))
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"balance":1234}' });
  if (url.includes("/openapi/v2/text-to-3d/t1"))
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "SUCCEEDED", progress: 100, model_urls: { glb: "http://localhost:5173/mockglb/model.glb" } }) });
  if (url.includes("/openapi/v2/text-to-3d"))
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"result":"t1"}' });
  return route.fulfill({ status: 404, body: "" });
});
await page.route("**/mockglb/**", (route) => route.fulfill({ status: 200, contentType: "model/gltf-binary", body: GLB }));

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Generative (AI mesh)" }).click();

// 1) Price is visible before anything is typed — the mode hint carries it.
const hint = await page.locator(".modehint").textContent();
check("mode hint shows the engine's price up front", /~25 credits · ≈ \$0\.50/.test(hint ?? ""), hint ?? "");

// 2) Run a text→3D generation (digits in the prompt skip the LLM prompt-polish).
await page.locator(".composer textarea").first().fill("a cube 20 mm wide");
await page.keyboard.press("Enter");
// The "Preparing… (Meshy · …)" placeholder / "Generating mesh · …" progress line
// carries the price while the (stubbed) task runs — catch it before completion.
await page.waitForFunction(
  () => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /(Preparing…|Generating mesh)/.test(b.textContent || "") && (b.textContent || "").includes("$0.50")),
  null, { timeout: 30_000 },
);
check("price shown in the pre-flight placeholder / progress line", true);
await page.waitForFunction(
  () => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Generated a mesh/.test(b.textContent || "")),
  null, { timeout: 90_000 },
);
const finalTxt = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.textContent).join(" | "));
check("success summary stamped with engine + price", /Generated a mesh — .*Meshy · ~25 credits · ≈ \$0\.50/.test(finalTxt), finalTxt.slice(-200));

// 3) The local spend ledger recorded the paid run.
const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem("moldable_spend_v1") ?? "[]"));
check("ledger recorded one paid run at $0.50", ledger.length === 1 && ledger[0].provider === "meshy" && ledger[0].usd === 0.5, JSON.stringify(ledger));

// 4) Settings → 3D engine: month spend + live balance check.
await page.locator('[aria-label="Account menu"]').click();
await page.waitForSelector(".overlay", { timeout: 10_000 });
await page.getByRole("button", { name: "3D engine" }).click();
const paneTxt = await page.evaluate(() => document.querySelector(".overlay")?.textContent ?? "");
check("Cost & balance shows selected price per model", paneTxt.includes("~25 credits · ≈ $0.50") && paneTxt.includes("per generated model"));
check("month-to-date spend listed", /\$0\.50.*across 1 paid run/.test(paneTxt) && paneTxt.includes("Meshy $0.50 (1)"), paneTxt.slice(paneTxt.indexOf("This device"), paneTxt.indexOf("This device") + 140));
await page.getByRole("button", { name: /Check my Meshy balance/ }).click();
await page.waitForFunction(() => (document.querySelector(".overlay")?.textContent ?? "").includes("Meshy balance:"), null, { timeout: 15_000 });
const balTxt = await page.evaluate(() => document.querySelector(".overlay")?.textContent ?? "");
check("live balance fetched through the relay", balTxt.includes("Meshy balance: 1,234 credits"), balTxt.slice(balTxt.indexOf("Meshy balance"), balTxt.indexOf("Meshy balance") + 60));

// 5) Price guide lists every engine.
const guide = await page.evaluate(() => {
  const d = [...document.querySelectorAll(".overlay details")].find((x) => x.textContent.includes("Price guide"));
  if (!d) return "";
  d.open = true;
  return d.textContent;
});
check("price guide covers free + paid engines", guide.includes("free (daily GPU minutes)") && guide.includes("≈ $0.04") && guide.includes("≈ $0.375"), guide.slice(0, 80));
await page.screenshot({ path: "shot-cost.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll cost-clarity checks passed.");
