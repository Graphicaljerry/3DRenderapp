// Texture toggle e2e: mesh generation is geometry-only ("print-first" gray) by
// DEFAULT and engines receive the cheap no-texture parameters; flipping the
// composer chip switches the real request bodies to textured. Tripo is driven
// through the full UI (chip → runGen → GenerativeEngine → provider body);
// fal (Hunyuan v3.1 / v2) and Meshy provider wiring is asserted at module level
// with a patched fetch — same production code, no paid calls anywhere.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

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
  localStorage.setItem("moldable_geneng", JSON.stringify({ provider: "tripo", model: "v3.0" }));
  localStorage.setItem("moldable_provider_keys", JSON.stringify({ tripo: "tcli_mock" }));
});

// Stub the Tripo relay and capture every task-create body.
const tripoBodies = [];
await page.route("**/prox/tripo/**", async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.endsWith("/task") && req.method() === "POST") {
    tripoBodies.push(JSON.parse(req.postData() || "{}"));
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"code":0,"data":{"task_id":"t1"}}' });
  }
  if (url.includes("/task/t1"))
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { status: "success", progress: 100, output: { model: "http://localhost:5173/mockglb/model.glb" } } }) });
  return route.fulfill({ status: 404, body: "" });
});
await page.route("**/mockglb/**", (route) => route.fulfill({ status: 200, contentType: "model/gltf-binary", body: GLB }));

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Generative (AI mesh)" }).click();

// 1) Default: the chip says print-first (color off).
const chip = page.locator(".texchip");
check("A1 chip defaults to Color: off — print-first", /Color: off/.test((await chip.textContent()) ?? ""), (await chip.textContent()) ?? "");

// 2) Generate with the default → Tripo body must say texture:false, pbr:false.
await page.locator(".composer textarea").first().fill("a cube 20 mm wide");
await page.keyboard.press("Enter");
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Generated a mesh/.test(b.textContent || "")), null, { timeout: 90_000 });
check("A2 default request is geometry-only (texture:false, pbr:false)", tripoBodies.length === 1 && tripoBodies[0].texture === false && tripoBodies[0].pbr === false, JSON.stringify(tripoBodies[0]));

// 3) Toggle the chip on → next request carries texture:true, pbr:true.
await chip.click();
check("A3 chip flips to Color: on", /Color: on/.test((await chip.textContent()) ?? ""));
await page.locator(".composer textarea").first().fill("a cube 25 mm wide");
await page.keyboard.press("Enter");
await page.waitForFunction(() => tripoBodies ? true : true, null, { timeout: 1000 }).catch(() => {});
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].filter((b) => /Generated a mesh/.test(b.textContent || "")).length >= 2, null, { timeout: 90_000 });
check("A4 toggled request asks for textures (texture:true, pbr:true)", tripoBodies.length === 2 && tripoBodies[1].texture === true && tripoBodies[1].pbr === true, JSON.stringify(tripoBodies[1]));

// 4) Provider wiring for fal + Meshy, module-level with a patched fetch.
const unit = await page.evaluate(async () => {
  const { falGenerate } = await import("/src/gen/providers/fal.ts");
  const { meshyGenerate } = await import("/src/gen/providers/meshy.ts");
  const caught = [];
  const realFetch = window.fetch;
  window.fetch = async (url, opts) => {
    caught.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    throw new Error("stop-after-capture"); // capture the request, skip the network
  };
  const grab = async (fn, input) => { try { await fn(input, () => {}); } catch { /* expected */ } };
  await grab(falGenerate, { model: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d", prompt: "x", apiKey: "k", proxyBase: "" });
  await grab(falGenerate, { model: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d", prompt: "x", apiKey: "k", proxyBase: "", texture: true });
  await grab(falGenerate, { model: "fal-ai/hunyuan3d/v2", prompt: "x", apiKey: "k", proxyBase: "" });
  await grab(falGenerate, { model: "fal-ai/hunyuan3d/v2", prompt: "x", apiKey: "k", proxyBase: "", texture: true });
  await grab(falGenerate, { model: "fal-ai/hyper3d/rodin", prompt: "x", apiKey: "k", proxyBase: "" });
  await grab(meshyGenerate, { model: "meshy", prompt: "x", apiKey: "k", proxyBase: "" });
  await grab(meshyGenerate, { model: "meshy", prompt: "x", apiKey: "k", proxyBase: "", texture: true });
  window.fetch = realFetch;
  return caught.map((c) => c.body);
});
check("B1 fal v3.1 default → generate_type Geometry", unit[0]?.generate_type === "Geometry", JSON.stringify(unit[0]));
check("B2 fal v3.1 texture on → generate_type Normal", unit[1]?.generate_type === "Normal", JSON.stringify(unit[1]));
check("B3 fal v2 default sends no texture params (white mesh)", unit[2] && !("textured_mesh" in unit[2]) && !("generate_type" in unit[2]), JSON.stringify(unit[2]));
check("B4 fal v2 texture on → textured_mesh true", unit[3]?.textured_mesh === true, JSON.stringify(unit[3]));
check("B5 rodin untouched (no texture params)", unit[4] && !("generate_type" in unit[4]) && !("textured_mesh" in unit[4]), JSON.stringify(unit[4]));
check("B6 Meshy default → should_texture false", unit[5]?.should_texture === false, JSON.stringify(unit[5]));
check("B7 Meshy texture on → should_texture true", unit[6]?.should_texture === true, JSON.stringify(unit[6]));

// 5) UI pack: provenance badge + mesh/CAD toolbar gating + View > Grayscale.
// The A4 mesh is a HELD preview (AI changes default to ask) — Apply commits it,
// which is what sets `result` and therefore the provenance badge.
await page.locator(".ai-preview, .apply-bar, body").first().waitFor();
await page.getByRole("button", { name: "Apply", exact: true }).first().click();
await page.getByRole("button", { name: "Objects", exact: true }).click();
const badgeMesh = await page.locator(".lp-badge").first().textContent().catch(() => null);
check("C1 Objects panel badges the mesh with its engine model", !!badgeMesh && /Tripo/i.test(badgeMesh), badgeMesh ?? "no badge");
check("C2 Select (CAD tooling) hidden for mesh models", (await page.locator('button[aria-label="Select"]').count()) === 0);
await page.locator('button[title^="View options"]').click(); // accessible-name lookup misses it (icon+label span) — same gotcha as the Library Select button
const grayRow = page.getByRole("menuitemcheckbox", { name: /Grayscale/ });
check("C3 View menu offers Grayscale", (await grayRow.count()) === 1);
await grayRow.click();
check("C4 Grayscale persists", await page.evaluate(() => localStorage.getItem("moldable_gray") === "1"));

// CAD leg: build a template -> badge says CAD, Select returns.
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the washer / spacer template").click();
await page.waitForFunction(() => document.querySelector(".statusbar .dims")?.textContent?.includes("12"), null, { timeout: 120_000 });
// The Objects panel is still open from C1 — don't toggle it closed.
const badgeCad = await page.locator(".lp-badge").first().textContent().catch(() => null);
check("C5 CAD model badges as CAD", badgeCad === "CAD", badgeCad ?? "no badge");
check("C6 Select tool visible again for CAD", (await page.locator('button[aria-label="Select"]').count()) === 1);

await browser.close();
if (fails.length) { console.log(`\n${fails.length} CHECK(S) FAILED`); process.exit(1); }
console.log("\nAll texture-toggle checks passed.");
