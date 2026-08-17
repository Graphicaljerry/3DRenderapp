// Local mesh repair (print/meshdoctor) verification.
//
// Part A builds genuinely broken meshes — a cube with a face deleted, faces wound
// backwards, vertex copies a hair apart, a tetrahedron floating beside a solid, a
// zero-area triangle, a whole shell inside-out, and an edge with three faces on it —
// and asserts the repair's before/after numbers, including the case it must NOT
// claim to have fixed. Part B drops one mesh carrying all of those defects at once
// into the real app and drives the Printability tab's Repair button.
//
// The dev server port is overridable because a second checkout can already own 5173:
//   PORT=5174 node meshrepair-e2e.mjs
import { chromium } from "playwright";
import { enterWorkspace } from "./enter.mjs";

const BASE = `http://localhost:${process.env.PORT ?? 5173}/`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
// A reload mid-run destroys the evaluate context and the error blames "navigation" —
// which is what a first run on a cold node_modules/.vite looks like when vite discovers
// a dependency and reloads the page. Logged so the next person doesn't chase a ghost.
page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log("[nav]", f.url()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);

// ---------------- Part A: broken meshes, measured ----------------
const unit = await page.evaluate(async () => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const { mergeVertices } = await import("/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js");
  const { diagnoseMesh, repairMeshForPrint, describeRepair, repairMessage } = await import("/src/print/meshdoctor.ts");
  const { analyzePrintability } = await import("/src/print/printability.ts");
  const { verifySolid } = await import("/src/engine/previewEngine.ts");

  const soup = (floats) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(floats), 3));
    return g;
  };
  const boxTris = (s, cx, cy, cz) => {
    const g = new THREE.BoxGeometry(s, s, s).toNonIndexed();
    g.translate(cx || 0, cy || 0, cz || 0);
    return Array.from(g.getAttribute("position").array);
  };
  const flipTri = (t, i) => {
    for (let k = 0; k < 3; k++) {
      const a = i * 9 + 3 + k, b = i * 9 + 6 + k;
      const tmp = t[a]; t[a] = t[b]; t[b] = tmp;
    }
  };
  const brief = (d) => ({
    triangles: d.triangles, sourceVertices: d.sourceVertices, vertices: d.vertices,
    boundaryEdges: d.boundaryEdges, holes: d.holes, nonManifoldEdges: d.nonManifoldEdges,
    invertedFaces: d.invertedFaces, insideOutShells: d.insideOutShells,
    degenerate: d.degenerateTriangles, shellCount: d.shellCount,
    shells: d.shells.map((v) => Math.round(v * 1e4) / 1e4),
  });

  const out = {};

  // 1) Cube with one face deleted: BoxGeometry emits two triangles per face, so
  //    dropping the first 18 floats removes a whole 20×20 wall.
  {
    const g = soup(boxTris(20, 0, 0, 0).slice(18));
    const fix = repairMeshForPrint(g);
    out.hole = { before: brief(fix.report.before), after: brief(fix.report.after), holesFilled: fix.report.holesFilled };
  }

  // 2) Three faces wound backwards among twelve — the case a global flip cannot fix.
  {
    const t = boxTris(20, 0, 0, 0);
    for (const i of [0, 3, 7]) flipTri(t, i);
    const fix = repairMeshForPrint(soup(t));
    out.winding = {
      before: brief(fix.report.before), after: brief(fix.report.after),
      reoriented: fix.report.facesReoriented,
      signedAfter: analyzePrintability(fix.geometry).volume.signedVolume,
    };
  }

  // 3) Welding. A cube soup repeats every corner; and then the near-duplicate case that
  //    motivated the hand-rolled weld: mergeVertices buckets on `~~(v * 1/tol + 0.5)`,
  //    so corners parked at 10.000055 with alternate triangles nudged 1e-5 lower land
  //    in buckets 100001 and 100000 and are never compared. 1e-5 mm is a hundredth of
  //    a printer's resolution — a crack no one asked for, and one this pass closes.
  {
    const plain = repairMeshForPrint(soup(boxTris(20, 0, 0, 0)));
    const straddle = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    straddle.translate(5.5e-5, 5.5e-5, 5.5e-5);
    const jitter = Array.from(straddle.getAttribute("position").array);
    for (let i = 0; i < 12; i += 2) for (let k = 0; k < 9; k++) jitter[i * 9 + k] -= 1e-5;
    const gJit = soup(jitter);
    const merged = mergeVertices(gJit.clone(), 1e-4);
    const fix = repairMeshForPrint(gJit);
    out.weld = {
      soupVertices: plain.report.before.sourceVertices,
      weldedVertices: plain.report.before.vertices,
      fused: plain.report.verticesFused,
      mergeVerticesVertices: merged.getAttribute("position").count,
      mergeVerticesBoundary: analyzePrintability(merged).manifold.boundaryEdges,
      ourBoundary: analyzePrintability(fix.geometry).manifold.boundaryEdges,
      ourVertices: fix.report.after.vertices,
    };
  }

  // 4) A 0.3 mm-radius tetrahedron floating 30 mm from a 20 mm cube.
  {
    const tetra = new THREE.TetrahedronGeometry(0.3).toNonIndexed();
    tetra.translate(30, 0, 0);
    const g = soup(boxTris(20, 0, 0, 0).concat(Array.from(tetra.getAttribute("position").array)));
    const fix = repairMeshForPrint(g);
    out.debris = {
      before: brief(fix.report.before), after: brief(fix.report.after),
      removed: fix.report.shellsRemoved.map((v) => Math.round(v * 1e4) / 1e4),
    };
  }

  // 5) A zero-area triangle (three collinear points) tacked onto a sound cube.
  {
    const g = soup(boxTris(20, 0, 0, 0).concat([0, 0, 30, 1, 0, 30, 2, 0, 30]));
    const fix = repairMeshForPrint(g);
    out.degenerate = { before: brief(fix.report.before), after: brief(fix.report.after) };
  }

  // 6) The whole cube inside-out: every face consistent with its neighbours, and all of
  //    them facing in. Nothing is "inverted" here — the shell is.
  {
    const t = boxTris(20, 0, 0, 0);
    for (let i = 0; i < 12; i++) flipTri(t, i);
    const fix = repairMeshForPrint(soup(t));
    out.insideOut = {
      before: brief(fix.report.before), after: brief(fix.report.after),
      flipped: fix.report.shellsFlipped,
      signedAfter: analyzePrintability(fix.geometry).volume.signedVolume,
    };
  }

  // 7) All of it on one mesh, which is what an AI mesh engine actually hands over.
  {
    const t = boxTris(20, 0, 0, 0).slice(18);
    for (const i of [0, 4]) flipTri(t, i);
    const tetra = new THREE.TetrahedronGeometry(0.3).toNonIndexed();
    tetra.translate(30, 0, 0);
    const g = soup(t.concat([0, 0, 30, 1, 0, 30, 2, 0, 30], Array.from(tetra.getAttribute("position").array)));
    const fix = repairMeshForPrint(g);
    const verdict = await verifySolid(fix.geometry);
    const sum = describeRepair(fix.report, verdict);
    out.combined = {
      before: brief(fix.report.before), after: brief(fix.report.after),
      fixed: sum.fixed, remaining: sum.remaining, printReady: sum.printReady,
      verdict, watertight: analyzePrintability(fix.geometry).manifold.isWatertight,
      message: repairMessage(fix.report, verdict),
    };
  }

  // 8) Three triangles on one edge. Nothing local can decide which side is inside, so
  //    the pass must leave it and say so.
  {
    const g = soup([
      0, 0, 0, 10, 0, 0, 0, 10, 0,
      0, 0, 0, 10, 0, 0, 0, 0, 10,
      0, 0, 0, 10, 0, 0, 0, -10, 0,
    ]);
    const fix = repairMeshForPrint(g);
    const sum = describeRepair(fix.report, null);
    out.nonManifold = {
      before: brief(fix.report.before), after: brief(fix.report.after),
      remaining: sum.remaining, advice: sum.advice, printReady: sum.printReady,
      message: repairMessage(fix.report, null),
    };
  }

  return out;
});

console.log("\n--- measured before/after ---");
console.log(JSON.stringify(unit, null, 1).slice(0, 6000));
console.log("---\n");

check("A1 deleted face: 4 open edges / 1 hole → 0",
  unit.hole.before.boundaryEdges === 4 && unit.hole.before.holes === 1
  && unit.hole.after.boundaryEdges === 0 && unit.hole.after.holes === 0 && unit.hole.holesFilled === 1,
  `${unit.hole.before.boundaryEdges}→${unit.hole.after.boundaryEdges} edges, ${unit.hole.before.triangles}→${unit.hole.after.triangles} tris`);

check("A2 three backwards faces: 3 inverted → 0, and the solid ends up outward",
  unit.winding.before.invertedFaces === 3 && unit.winding.after.invertedFaces === 0
  && unit.winding.after.boundaryEdges === 0 && unit.winding.signedAfter > 0,
  `inverted ${unit.winding.before.invertedFaces}→${unit.winding.after.invertedFaces}, signed volume ${Math.round(unit.winding.signedAfter)}`);

check("A3 weld fuses a triangle soup's repeated corners",
  unit.weld.soupVertices === 36 && unit.weld.weldedVertices === 8 && unit.weld.fused === 28,
  `${unit.weld.soupVertices} → ${unit.weld.weldedVertices} vertices`);
check("A3b near-duplicates that mergeVertices leaves cracked are closed here",
  unit.weld.mergeVerticesBoundary > 0 && unit.weld.ourBoundary === 0 && unit.weld.ourVertices === 8,
  `mergeVertices: ${unit.weld.mergeVerticesVertices} vertices / ${unit.weld.mergeVerticesBoundary} open edges — this pass: ${unit.weld.ourVertices} / ${unit.weld.ourBoundary}`);

check("A4 floating tetra named with its volume, then removed; the solid survives",
  unit.debris.before.shellCount === 2 && unit.debris.before.shells[1] > 0 && unit.debris.before.shells[1] < 1
  && unit.debris.after.shellCount === 1 && unit.debris.after.triangles === 12
  && unit.debris.removed.length === 1,
  `shells ${JSON.stringify(unit.debris.before.shells)} → ${JSON.stringify(unit.debris.after.shells)}, removed ${JSON.stringify(unit.debris.removed)}`);

check("A5 zero-area triangle counted and dropped",
  unit.degenerate.before.degenerate === 1 && unit.degenerate.after.degenerate === 0
  && unit.degenerate.after.triangles === 12 && unit.degenerate.after.boundaryEdges === 0,
  `${unit.degenerate.before.triangles + 1} source tris → ${unit.degenerate.after.triangles}`);

check("A6 inside-out shell: reported as a shell, not as 12 inverted faces, then turned out",
  unit.insideOut.before.insideOutShells === 1 && unit.insideOut.before.invertedFaces === 0
  && unit.insideOut.after.insideOutShells === 0 && unit.insideOut.flipped === 1
  && unit.insideOut.signedAfter > 0,
  `signed volume after ${Math.round(unit.insideOut.signedAfter)}`);

check("A7 all defects at once → clean, and the Manifold kernel agrees it is a solid",
  unit.combined.after.boundaryEdges === 0 && unit.combined.after.nonManifoldEdges === 0
  && unit.combined.after.invertedFaces === 0 && unit.combined.after.insideOutShells === 0
  && unit.combined.after.degenerate === 0 && unit.combined.after.shellCount === 1
  && unit.combined.watertight === true
  && !!unit.combined.verdict && unit.combined.verdict.solid === true
  && unit.combined.printReady === true,
  `verdict ${JSON.stringify(unit.combined.verdict)}`);
check("A7b the receipt lists every fix it made",
  unit.combined.fixed.length >= 4 && unit.combined.fixed.some((s) => /hole/.test(s))
  && unit.combined.fixed.some((s) => /wound/.test(s)) && unit.combined.fixed.some((s) => /floating shell/.test(s))
  && unit.combined.fixed.some((s) => /zero-area/.test(s)),
  unit.combined.fixed.join(" | "));

check("A8 non-manifold edge survives — and the report says so instead of claiming a fix",
  unit.nonManifold.before.nonManifoldEdges >= 1 && unit.nonManifold.after.nonManifoldEdges >= 1
  && unit.nonManifold.printReady === false
  && unit.nonManifold.remaining.some((s) => /non-manifold/.test(s))
  && unit.nonManifold.advice.some((s) => /Deep repair|slicer/.test(s)),
  `${unit.nonManifold.before.nonManifoldEdges} → ${unit.nonManifold.after.nonManifoldEdges} non-manifold edges`);
check("A8b the chat receipt refuses the words 'print-ready' for an unfixed mesh",
  /not print-ready/.test(unit.nonManifold.message) && !/Nothing left/.test(unit.nonManifold.message),
  unit.nonManifold.message.split("\n\n")[0].slice(0, 120));

// ---------------- Part B: the real UI ----------------
// One GLB carrying the same combined defect set, dropped on the canvas the way an
// exported mesh arrives.
await page.evaluate(async () => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const { GLTFExporter } = await import("/node_modules/three/examples/jsm/exporters/GLTFExporter.js");
  const box = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
  const t = Array.from(box.getAttribute("position").array).slice(18); // one wall removed
  for (const i of [0, 4]) {
    for (let k = 0; k < 3; k++) {
      const a = i * 9 + 3 + k, b = i * 9 + 6 + k;
      const tmp = t[a]; t[a] = t[b]; t[b] = tmp;
    }
  }
  const tetra = new THREE.TetrahedronGeometry(0.3).toNonIndexed();
  tetra.translate(30, 0, 0);
  const all = t.concat([0, 0, 30, 1, 0, 30, 2, 0, 30], Array.from(tetra.getAttribute("position").array));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(all), 3));
  const buf = await new Promise((res, rej) => new GLTFExporter().parse(new THREE.Mesh(g, new THREE.MeshStandardMaterial()), res, rej, { binary: true }));
  const dt = new DataTransfer();
  dt.items.add(new File([buf], "brokenmesh.glb", { type: "model/gltf-binary" }));
  const el = document.querySelector(".viewer");
  el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
});
await page.waitForFunction(() => (window.__viewerS?.()?.mesh?.geometry?.getAttribute?.("position")?.count ?? 0) > 0, null, { timeout: 60_000 });
check("B1 broken GLB imports", true);

await page.getByRole("button", { name: "Printability", exact: true }).click();
// The section label, not its rows: the rows appear a frame later and the label proves
// the whole block mounted rather than a partially-populated one.
await page.waitForSelector(".panel .dock-sub:text-is(\"What's wrong with this mesh\")", { state: "visible", timeout: 30_000 });
await page.waitForFunction(() => [...document.querySelectorAll(".panel .prow")].some((r) => /Inverted faces/.test(r.textContent ?? "")), null, { timeout: 30_000 });
const panelBefore = await page.evaluate(() => document.querySelector(".panel")?.textContent ?? "");
const rowsBefore = await page.evaluate(() => {
  const rows = {};
  for (const el of document.querySelectorAll(".panel .prow")) {
    const k = el.children[0]?.textContent?.trim();
    if (k) rows[k] = el.children[1]?.textContent?.trim();
  }
  return rows;
});
console.log("panel rows before:", JSON.stringify(rowsBefore));
check("B2 the panel names the defects instead of only 'not watertight'",
  /across 1 hole/.test(rowsBefore["Open edges"] ?? "")
  && rowsBefore["Inverted faces"] === "2"
  && rowsBefore["Zero-area triangles"] === "1"
  && rowsBefore["Separate shells"] === "2, 1 debris",
  JSON.stringify(rowsBefore));
check("B3 shell volumes are quoted so the user can tell debris from a real part",
  /Shells by volume/.test(panelBefore) && /mm³/.test(panelBefore));
await page.screenshot({ path: "shot-meshrepair-defects.png" });

// The export gate carries the same names and the same button — that is where most
// people meet a broken mesh, one click before the file leaves.
await page.getByRole("button", { name: "Export", exact: true }).first().click();
await page.waitForSelector(".export-panel", { state: "visible", timeout: 30_000 });
const exportPanel = await page.evaluate(() => document.querySelector(".export-panel")?.textContent ?? "");
check("B3b the export gate names the same defects and offers the same free repair",
  /Found: .*open edge/.test(exportPanel) && /wound inside-out/.test(exportPanel)
  && /1 debris shell under 1 mm³ \(2 shells in all\)/.test(exportPanel)
  && /Repair mesh — free, on this machine/.test(exportPanel),
  (exportPanel.match(/Found: [^.]+\./) ?? [""])[0]);

await page.getByRole("button", { name: "Printability", exact: true }).click();
await page.getByRole("button", { name: /Repair mesh — free, on this machine/ }).first().click();
await page.waitForFunction(
  () => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Repaired the mesh on your own machine/.test(b.textContent ?? "")),
  null, { timeout: 120_000 },
);
// The bubble's markdown lands paragraph by paragraph, so read it once it stops growing.
const readReceipt = () => page.evaluate(() =>
  [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.textContent ?? "").filter((t) => /Repaired the mesh on your own machine/.test(t)).pop() ?? "");
let receipt = await readReceipt();
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(300);
  const next = await readReceipt();
  if (next === receipt && next.length > 0) break;
  receipt = next;
}
console.log(`\nreceipt (${receipt.length} chars):\n${receipt}\n`);
check("B4 the receipt names each fix with numbers",
  /closed 1 hole/.test(receipt) && /re-wound 2 faces/.test(receipt)
  && /removed 1 floating shell/.test(receipt) && /zero-area triangle/.test(receipt),
  receipt.slice(0, 200));
check("B5 the receipt carries the kernel cross-check, not just our own count",
  /Manifold kernel reads it as a closed solid/.test(receipt) && /genus 0/.test(receipt), "");
check("B6 it says what is still unchecked (self-intersections) rather than declaring victory",
  /Self-intersections are still unchecked/.test(receipt) && !/is print-ready/.test(receipt), "");

await page.waitForFunction(() => {
  const rows = [...document.querySelectorAll(".panel .prow")];
  const wt = rows.find((r) => /Watertight/.test(r.children[0]?.textContent ?? ""));
  return wt && /yes/.test(wt.children[1]?.textContent ?? "");
}, null, { timeout: 60_000 });
const rowsAfter = await page.evaluate(() => {
  const rows = {};
  for (const el of document.querySelectorAll(".panel .prow")) {
    const k = el.children[0]?.textContent?.trim();
    if (k) rows[k] = el.children[1]?.textContent?.trim();
  }
  return { rows, clean: /No open edges, no non-manifold edges/.test(document.body.textContent ?? "") };
});
console.log("panel rows after:", JSON.stringify(rowsAfter.rows));
check("B7 the panel re-reads clean after the repair",
  rowsAfter.rows["Watertight / manifold"] === "yes" && rowsAfter.clean,
  JSON.stringify(rowsAfter.rows));

await page.keyboard.press("Control+z");
await page.waitForFunction(() => {
  const rows = [...document.querySelectorAll(".panel .prow")];
  const wt = rows.find((r) => /Watertight/.test(r.children[0]?.textContent ?? ""));
  return wt && /open edge/.test(wt.children[1]?.textContent ?? "");
}, null, { timeout: 60_000 });
check("B8 undo puts the broken mesh back (the repair is a real version)", true);

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
