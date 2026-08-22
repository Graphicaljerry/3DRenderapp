// Print-fit pack e2e: mesh transforms COMMIT now (the reported bug was a gizmo
// scale on a generated mesh silently reverting), generated/imported meshes can be
// fit to the plate and resized by typed mm/%, and the baked transform survives
// undo and a full reload (meshXform replay over the original glb).
import { chromium } from "playwright";
import { enterWorkspace, newChat } from "./enter.mjs";

// Every geometry wait below is 90s. These steps are OCCT/mesh rebuilds behind a Comlink
// worker with no signal, and on a COLD vite server — the first probe after a source edit,
// which pays for the dependency re-compile — the first of them alone outran the old 30s.
// The probe then reported "crashed", which reads as a broken app rather than a slow one.

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);

// ---------- A: unit checks through the real modules ----------
const unit = await page.evaluate(async () => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const { bakeMeshTransform, composeXform, applyStoredMeshXform, fitToBedFactor, scaleAboutBase } = await import("/src/print/resize.ts");
  const cube = (s) => {
    const g = new THREE.BoxGeometry(s, s, s / 2).toNonIndexed();
    g.computeBoundingBox();
    g.translate(0, 0, -g.boundingBox.min.z); // bed convention: floored at z=0
    return g;
  };
  // 1. fit factor for a 600-wide part on a 256 bed
  const f = fitToBedFactor({ x: 600, y: 600, z: 300 }, { x: 256, y: 256, z: 256 });
  // 2. bake a 50% scale, then replay the recorded matrix on a FRESH copy — must match
  const g0 = cube(400);
  const baked = bakeMeshTransform(g0, scaleAboutBase(g0, [0.5, 0.5, 0.5]));
  const xform = composeXform(undefined, baked.applied);
  const g1 = cube(400);
  const dimsReplay = applyStoredMeshXform(g1, xform);
  const pa = baked.geometry.getAttribute("position");
  const pb = g1.getAttribute("position");
  let maxDev = 0;
  for (let i = 0; i < pa.count * 3; i++) maxDev = Math.max(maxDev, Math.abs(pa.array[i] - pb.array[i]));
  // 3. two sequential bakes vs their composed record
  const b2 = bakeMeshTransform(baked.geometry, scaleAboutBase(baked.geometry, [2, 1, 1]));
  const x2 = composeXform(xform, b2.applied);
  const g2 = cube(400);
  applyStoredMeshXform(g2, x2);
  const pc = b2.geometry.getAttribute("position");
  const pd = g2.getAttribute("position");
  let maxDev2 = 0;
  for (let i = 0; i < pc.count * 3; i++) maxDev2 = Math.max(maxDev2, Math.abs(pc.array[i] - pd.array[i]));
  return { f, dimsBaked: baked.dims, dimsReplay, maxDev, dims2: b2.dims, maxDev2 };
});
check("A1 fitToBedFactor shrinks 600 → 256 bed", Math.abs(unit.f - 0.405) < 0.002, `f=${unit.f}`);
check("A2 bake 50%: 400 cube → 200", unit.dimsBaked.x === 200 && unit.dimsBaked.z === 100, JSON.stringify(unit.dimsBaked));
check("A3 stored-xform replay reproduces the bake exactly", unit.maxDev < 1e-3 && unit.dimsReplay.x === 200, `maxDev=${unit.maxDev}`);
check("A4 composed record replays two bakes (incl. per-axis)", unit.maxDev2 < 1e-3 && unit.dims2.x === 400 && unit.dims2.y === 200, `maxDev=${unit.maxDev2} dims=${JSON.stringify(unit.dims2)}`);

// ---------- B: drop an oversize GLB (mesh pipeline) → fit → resize → undo → reload ----------
await page.evaluate(async () => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const { GLTFExporter } = await import("/node_modules/three/examples/jsm/exporters/GLTFExporter.js");
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(600, 500, 300), new THREE.MeshStandardMaterial());
  const buf = await new Promise((res, rej) => new GLTFExporter().parse(mesh, res, rej, { binary: true }));
  const file = new File([buf], "bigmesh.glb", { type: "model/gltf-binary" });
  const dt = new DataTransfer();
  dt.items.add(file);
  const el = document.querySelector(".viewer");
  el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
});
// glTF is Y-up → the 600×500×300 box lands as 600×300×500 in our Z-up mm world.
const sbDims = `(el => { const m = el?.textContent?.match(/([\\d.]+) × ([\\d.]+) × ([\\d.]+)/); return m ? m.slice(1, 4).map(Number) : null; })(document.querySelector(".statusbar .dims"))`;
await page.waitForFunction((src) => { const d = eval(src); return d && d[0] === 600 && d[2] === 500; }, sbDims, { timeout: 90_000 });
check("B1 oversize GLB imports as a mesh at true size (no silent rescale of imports)", true);

// Printability tab → the too-big block offers Fit to plate (MESH branch: baked scale)
await page.getByRole("button", { name: "Printability", exact: true }).click();
await page.getByRole("button", { name: /Scale to fit bed/ }).click();
await page.waitForFunction((src) => { const d = eval(src); return d && d[0] < 260; }, sbDims, { timeout: 90_000 });
const afterFit = await page.evaluate((src) => eval(src), sbDims);
check("B2 Fit to plate shrinks the mesh onto the bed", !!afterFit && afterFit[0] <= 256 && afterFit[1] <= 256 && afterFit[2] <= 256, JSON.stringify(afterFit));
const fitRatioOk = !!afterFit && Math.abs(afterFit[1] / afterFit[0] - 300 / 600) < 0.02 && Math.abs(afterFit[2] / afterFit[0] - 500 / 600) < 0.02;
check("B3 proportions kept (uniform)", fitRatioOk, JSON.stringify(afterFit));

// Typed resize: back to the 3D view (the toolbar lives there) → Transform → Resize → 50%
// No "3D View" tab any more: the stage is never hidden — every Inspector section docks
// BESIDE a live viewer instead of covering it, so there is nothing to switch back to.
await page.getByRole("button", { name: "Transform", exact: true }).click();
await page.getByRole("button", { name: "Set size", exact: true }).click();
const wBefore = afterFit[0];
await page.locator(".resize-menu label:has-text('%') input").fill("50");
await page.locator(".resize-menu").getByRole("button", { name: "Apply" }).click();
await page.waitForFunction(({ src, w }) => { const d = eval(src); return d && Math.abs(d[0] - w / 2) < 1.5; }, { src: sbDims, w: wBefore }, { timeout: 90_000 });
check("B4 typed 50% resize applies to the mesh", true);

// Undo → back to the fit-to-plate size (each resize is a real version).
// Focus first: the app's shortcut handler deliberately ignores keys typed into an INPUT
// or TEXTAREA (so a field's own undo keeps working), and the step above typed into the
// resize menu's % box. Whether focus had left it by now depended on how fast the menu
// closed — fine on an idle machine, a coin-flip under three-lane suite load, where the
// redo below simply never fired and the probe reported a 90s timeout.
await page.locator("canvas").first().click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Control+z");
await page.waitForFunction(({ src, w }) => { const d = eval(src); return d && Math.abs(d[0] - w) < 1.5; }, { src: sbDims, w: wBefore }, { timeout: 90_000 });
check("B5 undo steps the mesh resize back", true);
// Redo the 50% so the persisted HEAD is the resized state for the reload check
await page.keyboard.press("Control+Shift+z");
await page.waitForFunction(({ src, w }) => { const d = eval(src); return d && Math.abs(d[0] - w / 2) < 1.5; }, { src: sbDims, w: wBefore }, { timeout: 90_000 });
await page.waitForTimeout(1200); // let the debounced project save land

// Reload → resume the project → the baked size must survive (meshXform over original glb)
await page.reload({ waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.getByText(/bigmesh/i).first().click({ timeout: 20_000 });
await page.waitForFunction(({ src, w }) => { const d = eval(src); return d && Math.abs(d[0] - w / 2) < 1.5; }, { src: sbDims, w: wBefore }, { timeout: 90_000 });
check("B6 resized mesh size survives reload (meshXform replay)", true);

// ---------- C: STL drops convert to a CAD solid — fit works there too, and UNDO
// no longer re-reads the STL as STEP (importKind persisted; was a real crash) ----------
await newChat(page);
await page.evaluate(async () => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const { geometryToSTL } = await import("/src/print/stl.ts");
  const g = new THREE.BoxGeometry(600, 500, 300).toNonIndexed();
  const file = new File([await geometryToSTL(g).arrayBuffer()], "bigpart.stl", { type: "model/stl" });
  const dt = new DataTransfer();
  dt.items.add(file);
  const el = document.querySelector(".viewer");
  el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
});
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent?.includes("editable CAD solid")), { timeout: 120_000 });
await page.waitForFunction((src) => { const d = eval(src); return d && d[0] === 600; }, sbDims, { timeout: 90_000 });
check("C1 STL imports as an editable CAD solid (boots the kernel on demand)", true);
await page.getByRole("button", { name: "Printability", exact: true }).click();
await page.getByRole("button", { name: /Scale to fit bed/ }).click();
await page.waitForFunction((src) => { const d = eval(src); return d && d[0] < 260; }, sbDims, { timeout: 90_000 });
check("C2 Fit to plate scales the CAD import (parametric op)", true);
// No "3D View" tab any more: the stage is never hidden — every Inspector section docks
// BESIDE a live viewer instead of covering it, so there is nothing to switch back to.
await page.keyboard.press("Control+z");
// SOFT wait: this is C3's evidence, not a precondition. Written as a hard waitForFunction
// it threw TimeoutError with an empty log and killed the run two lines before the code
// that reads the app's own "failed to rebuild" bubble — which made C3 structurally
// incapable of failing (the check below could only ever be reached on success) and its
// diagnosis unreachable. Twelve PASS lines and a bare stack was the whole report.
const undoRestored = await page
  // 120 s, matching C1's budget for the same kernel: an undo here re-reads the STL
  // (importShape, 45 s watchdog) AND rebuilds the shape (25 s watchdog), and the suite
  // runs three lanes on four cores, so 60 s was inside the range this legitimately takes
  // under load. Soft now, so overrunning it prints a dimension instead of a bare stack.
  .waitForFunction((src) => { const d = eval(src); return d && d[0] === 600; }, sbDims, { timeout: 120_000 })
  .then(() => true, () => false);
// The app reports a failed rebuild as a CHAT bubble, never as a console error, so the
// console listener at the top of this file never sees it. Quote it: "undo didn't get back
// to 600" is not a diagnosis; the kernel's own complaint is.
const undoSays = await page.evaluate(() => {
  const hits = [...document.querySelectorAll(".msg.assistant .bubble")].filter((b) => /failed to rebuild/.test(b.textContent ?? ""));
  return hits.length ? (hits[hits.length - 1].textContent ?? "").slice(0, 220) : "";
});
const undoDims = await page.evaluate((src) => eval(src), sbDims);
check("C3 undo restores the import (STL kind persisted — no STEP re-read crash)",
  undoRestored && !undoSays,
  `dims=${JSON.stringify(undoDims)}${undoSays ? " — " + undoSays : ""}`);

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nAll resize checks passed.");
