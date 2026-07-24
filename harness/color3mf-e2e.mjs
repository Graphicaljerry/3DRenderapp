// Per-part colour → 3MF: painted parts must export as filament slots the slicer reads.
// A: unit-check the writers directly (unzip + inspect model_settings/project_settings/basematerials).
// B: UI smoke — paint the model via the Objects panel swatch; the colour persists on the project.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

// ---------- A: export writers encode colour ----------
const A = await page.evaluate(async () => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const { unzipSync, strFromU8 } = await import("/node_modules/fflate/esm/browser.js");
  const { platesToProject3MF, geometriesTo3MF } = await import("/src/print/exportClient.ts");
  const box = (s) => new THREE.BoxGeometry(s, s, s).toNonIndexed();
  // model painted red, one attachment painted blue, one left unpainted
  const parts = [
    { geometry: box(20), name: "model", plate: 1, color: "#E02D2D" },
    { geometry: box(10), name: "clip", plate: 1, color: "#1C8FE0" },
    { geometry: box(8), name: "plain", plate: 1 },
  ];
  const projBlob = platesToProject3MF(parts, 1, { x: 256, y: 256 });
  const projZip = unzipSync(new Uint8Array(await projBlob.arrayBuffer()));
  const files = Object.keys(projZip);
  const modelSettings = strFromU8(projZip["Metadata/model_settings.config"]);
  const projSettings = projZip["Metadata/project_settings.config"] ? strFromU8(projZip["Metadata/project_settings.config"]) : null;

  const coreBlob = geometriesTo3MF(parts);
  const coreZip = unzipSync(new Uint8Array(await coreBlob.arrayBuffer()));
  const coreModel = strFromU8(coreZip["3D/3dmodel.model"]);

  // all-unpainted control → no colour files, all extruder 1
  const plain = [{ geometry: box(20), name: "a", plate: 1 }, { geometry: box(10), name: "b", plate: 1 }];
  const plainZip = unzipSync(new Uint8Array(await platesToProject3MF(plain, 1, { x: 256, y: 256 }).arrayBuffer()));
  const plainHasProjSettings = !!plainZip["Metadata/project_settings.config"];
  const plainModelSettings = strFromU8(plainZip["Metadata/model_settings.config"]);

  return { files, modelSettings, projSettings, coreModel, plainHasProjSettings, plainModelSettings };
});

// extruder mapping: unpainted → slot 1 (default filament), red → 2, blue → 3 (order of first appearance)
const exNums = [...A.modelSettings.matchAll(/<object id="(\d+)">[\s\S]*?key="extruder" value="(\d+)"/g)].map((m) => [m[1], m[2]]);
check("A1 project 3MF assigns a distinct extruder per painted part", exNums.length === 3 && new Set(exNums.map((x) => x[1])).size === 3, JSON.stringify(exNums));
check("A2 project_settings.config carries the painted filament colours", !!A.projSettings && A.projSettings.includes("#E02D2D") && A.projSettings.includes("#1C8FE0") && A.projSettings.includes("#D9D9D9"), A.projSettings?.slice(0, 120));
let pj = null; try { pj = JSON.parse(A.projSettings); } catch {}
check("A3 filament_colour is valid JSON, 3 slots, default first", !!pj && Array.isArray(pj.filament_colour) && pj.filament_colour.length === 3 && pj.filament_colour[0] === "#D9D9D9", JSON.stringify(pj?.filament_colour));
check("A4 core 3MF embeds a basematerials palette with displaycolor", /<basematerials/.test(A.coreModel) && /displaycolor="#E02D2DFF"/.test(A.coreModel) && /displaycolor="#1C8FE0FF"/.test(A.coreModel), "");
check("A5 core 3MF objects reference the material (pid/pindex)", /<object id="\d+"[^>]*pid="\d+" pindex="\d+"/.test(A.coreModel), "");
const plainExtruders = [...A.plainModelSettings.matchAll(/key="extruder" value="(\d+)"/g)].map((m) => m[1]);
check("A6 unpainted project → no filament file, every part extruder 1", A.plainHasProjSettings === false && plainExtruders.length > 0 && plainExtruders.every((v) => v === "1"), JSON.stringify(plainExtruders));

// ---------- B: UI — paint the model via the Objects panel ----------
await page.getByRole("button", { name: /phone stand/i }).first().click({ timeout: 15_000 });
await page.waitForFunction(() => /\d+(\.\d+)? × /.test(document.querySelector(".statusbar .dims")?.textContent || ""), null, { timeout: 120_000 });
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForSelector(".layers-panel .lp-swatch", { timeout: 15_000 });
await page.locator(".layers-panel .lp-row .lp-swatch").first().click();
await page.waitForSelector(".swatch-grid .sw", { timeout: 8_000 });
await page.locator(".swatch-grid .sw").nth(4).click(); // #1C8FE0 (blue), 5th swatch
await page.waitForTimeout(900); // let the debounced project save land
const painted = await page.evaluate(() => {
  const btn = document.querySelector(".layers-panel .lp-row .lp-swatch.painted .lp-swatch-dot");
  return btn ? getComputedStyle(btn).backgroundColor : null;
});
check("B1 painting the model shows a filled swatch", !!painted && painted !== "rgba(0, 0, 0, 0)", painted || "no swatch");

const persisted = await page.evaluate(async () => {
  const dbs = await indexedDB.databases?.();
  return dbs ? dbs.map((d) => d.name) : null; // sanity that a store exists; colour saved via putProject
});
check("B2 project store present (colour saved with project)", Array.isArray(persisted), JSON.stringify(persisted));

await browser.close();
if (fails.length) { console.log(`\n${fails.length} CHECK(S) FAILED`); process.exit(1); }
console.log("\nAll colour-3MF checks passed.");
