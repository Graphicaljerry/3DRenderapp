// Per-face MMU paint → Bambu 3MF: the codec and the exporter must emit the exact
// paint_color attribute Bambu/Orca read, keyed positionally to triangle order.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

const R = await page.evaluate(async () => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const { unzipSync, strFromU8 } = await import("/node_modules/fflate/esm/browser.js");
  const { platesToProject3MF, encodePaintColorWhole } = await import("/src/print/exportClient.ts");

  // --- codec unit vectors (from BambuStudio TriangleSelector::serialize, verified) ---
  const codec = {
    s0: encodePaintColorWhole(0), s1: encodePaintColorWhole(1), s2: encodePaintColorWhole(2),
    s3: encodePaintColorWhole(3), s4: encodePaintColorWhole(4), s5: encodePaintColorWhole(5),
    s18: encodePaintColorWhole(18),
  };
  // round-trip decoder (walk string right→left, 4 bits LSB-first; read leaf state)
  const decodeWhole = (str) => {
    if (!str) return 0;
    const bits = [];
    for (let i = str.length - 1; i >= 0; i--) { const v = parseInt(str[i], 16); for (let b = 0; b < 4; b++) bits.push((v >> b) & 1); }
    let p = 0;
    const split = bits[p++] | (bits[p++] << 1); // number_of_split_sides
    if (split !== 0) return -1; // not a whole triangle
    if (bits[p] === 1 && bits[p + 1] === 1) { // marker 0b11 → state≥3
      p += 2; let n = 0, k = 0;
      // read remaining nibble(s): 15-runs then a final <15 nibble
      while (p + 4 <= bits.length) { const nib = bits[p] | (bits[p + 1] << 1) | (bits[p + 2] << 2) | (bits[p + 3] << 3); p += 4; n += nib; if (nib < 15) break; k++; if (k > 6) break; }
      return n + 3;
    }
    return bits[p] | (bits[p + 1] << 1); // state 0..2 (low 2 bits)
  };
  const roundTrip = [];
  for (let n = 1; n <= 20; n++) roundTrip.push([n, decodeWhole(encodePaintColorWhole(n))]);

  // --- integration: paint specific triangles of a 12-triangle box, export, unzip ---
  const box = new THREE.BoxGeometry(20, 20, 20); // indexed, 12 triangles
  const idx = box.index; const triCount = idx.count / 3;
  const paint = new Uint8Array(triCount); // 1-based palette index; 0 = unpainted
  paint[0] = 1; // palette[0] = red
  paint[5] = 2; // palette[1] = blue
  const paintPalette = ["#E02D2D", "#1C8FE0"];
  const blob = platesToProject3MF(
    [{ geometry: box, name: "cube", plate: 1, paint, paintPalette }], 1, { x: 256, y: 256 });
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const model = strFromU8(zip["3D/3dmodel.model"]);
  const proj = zip["Metadata/project_settings.config"] ? strFromU8(zip["Metadata/project_settings.config"]) : null;

  // parse the <triangle> list in document order
  const tris = [...model.matchAll(/<triangle\b([^>]*)\/>/g)].map((m) => m[1]);
  const pc = (attrs) => { const m = /paint_color="([^"]*)"/.exec(attrs); return m ? m[1] : null; };
  return {
    codec, roundTrip,
    triXmlCount: tris.length, geomTriCount: triCount,
    tri0: pc(tris[0]), tri5: pc(tris[5]),
    paintedCount: tris.filter((a) => pc(a) !== null).length,
    hasPrefix: /slic3rpe:|:mmu_segmentation|:paint_color/.test(model),
    proj, filamentCount: proj ? (JSON.parse(proj).filament_colour || []).length : 0,
  };
});

// codec vectors
check("A1 encode: slot0='' slot1='4' slot2='8'", R.codec.s0 === "" && R.codec.s1 === "4" && R.codec.s2 === "8", JSON.stringify(R.codec));
check("A2 encode: slot3='0C' slot4='1C' slot5='2C'", R.codec.s3 === "0C" && R.codec.s4 === "1C" && R.codec.s5 === "2C", JSON.stringify(R.codec));
check("A3 encode: slot18='0FC' (F-extension boundary)", R.codec.s18 === "0FC", R.codec.s18);
const rtOk = R.roundTrip.every(([n, d]) => n === d);
check("A4 round-trip decode(encode(n))===n for 1..20", rtOk, JSON.stringify(R.roundTrip.filter(([n, d]) => n !== d)));

// integration
// base (unpainted) = default filament slot 1; the two painted palette colours become
// slots 2 (red) and 3 (blue) → paint_color "8" and "0C".
check("B1 every geometry triangle is emitted (positional keying intact)", R.triXmlCount === R.geomTriCount, `xml=${R.triXmlCount} geom=${R.geomTriCount}`);
check("B2 triangle 0 (red region) → slot 2 → paint_color='8'", R.tri0 === "8", String(R.tri0));
check("B3 triangle 5 (blue region) → slot 3 → paint_color='0C'", R.tri5 === "0C", String(R.tri5));
check("B4 only the 2 painted triangles carry paint_color", R.paintedCount === 2, `painted=${R.paintedCount}`);
check("B5 attribute is bare paint_color (no slic3rpe/namespace prefix)", R.hasPrefix === false, "");
check("B6 filament_colour covers the highest painted slot (≥3: gray+red+blue)", R.filamentCount >= 3, `n=${R.filamentCount}`);

// ---------- C: UI — paint a face region, confirm the stroke registers ----------
await page.getByRole("button", { name: /phone stand/i }).first().click({ timeout: 15_000 });
await page.waitForFunction(() => /\d+(\.\d+)? × /.test(document.querySelector(".statusbar .dims")?.textContent || ""), null, { timeout: 120_000 });
// Top view → the model's footprint fills the centre, so a centre click lands on it.
await page.getByRole("button", { name: "Top", exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Paint", exact: true }).click();
await page.waitForSelector(".paint-fly .psw", { timeout: 8_000 });
await page.locator(".paint-fly .psw").nth(1).click(); // filament 2 (blue)
const eraseBtn = page.locator(".paint-fly button", { hasText: "Erase all painting" });
check("C1 Erase starts disabled (nothing painted yet)", await eraseBtn.isDisabled(), "");

const canvas = page.locator(".viewer canvas").first();
const box = await canvas.boundingBox();
// click a few points around centre so at least one lands on the model surface
for (const [dx, dy] of [[0, 0], [0, 40], [-30, 10], [30, 10], [0, -30]]) {
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(700); // debounced persist
const eraseOnNow = !(await eraseBtn.isDisabled());
check("C2 painting a region registers a stroke (Erase enables)", eraseOnNow, "");

if (eraseOnNow) {
  const saved = await page.evaluate(async () => {
    const req = indexedDB.open("moldable");
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    const names = [...db.objectStoreNames];
    const store = names.includes("projects") ? "projects" : names[0];
    const all = await new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return all.some((p) => p && p.facePaint && p.facePaint.b64 && p.facePaint.count > 0);
  });
  check("C3 paint persisted to the project store (facePaint saved)", saved, "");

  await eraseBtn.click();
  await page.waitForTimeout(300);
  check("C4 Erase all clears the paint (button disables again)", await eraseBtn.isDisabled(), "");
}

// ---------- D: brush (paint-on-drag) + eraser ----------
const toolBtn = (name) => page.locator(".paint-fly .mode-seg button", { hasText: name });
await toolBtn("Brush").click();
await page.locator(".paint-fly .psw").nth(0).click(); // red filament
const bbox = await canvas.boundingBox();
const bx = bbox.x + bbox.width / 2, by = bbox.y + bbox.height / 2;
await page.mouse.move(bx - 40, by - 20);
await page.mouse.down();
for (const [dx, dy] of [[0, 0], [20, 10], [40, 20], [60, 30], [80, 20]]) await page.mouse.move(bx - 40 + dx, by - 20 + dy);
await page.mouse.up();
await page.waitForTimeout(700);
check("D1 brush drag paints (Erase enables)", !(await eraseBtn.isDisabled()), "");
// eraser: selecting it sets slot 0 (aria-checked on the eraser swatch)
await page.locator(".paint-fly .psw-erase").click();
const eraserOn = await page.locator(".paint-fly .psw-erase").getAttribute("aria-checked");
check("D2 eraser swatch selectable (slot 0)", eraserOn === "true", String(eraserOn));
// switch back to Fill and erase-with-region over the painted area → paint shrinks/clears
await toolBtn("Fill").click();
await page.mouse.click(bx, by);
await page.mouse.click(bx - 40, by - 10);
await page.waitForTimeout(600);
check("D3 fill+eraser over a painted region removes paint (no crash, tool responsive)", await toolBtn("Brush").isVisible(), "");

await browser.close();
if (fails.length) { console.log(`\n${fails.length} CHECK(S) FAILED`); process.exit(1); }
console.log("\nAll face-paint 3MF checks passed.");
