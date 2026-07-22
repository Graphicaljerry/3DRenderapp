// Printability-pack verification.
// Part A (unit, via Vite's TS transform in the browser): orient/overhang/thinwalls
// on synthetic shapes with known answers. Part B (e2e): the Print tab flow on real
// templates — heatmap pixels, orientation suggest, wall check, elephant-foot chamfer.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

// ---------- Part A: module-level checks on synthetic geometry ----------
{
  const page = await browser.newPage();
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  const res = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { suggestOrientation } = await import("/src/print/orient.ts");
    const { overhangOverlay } = await import("/src/print/overhang.ts");
    const { findThinWalls } = await import("/src/print/thinwalls.ts");

    // Triangle-soup builder for axis-aligned boxes (outward normals, z-up, non-indexed).
    const box = (cx, cy, cz, sx, sy, sz) => {
      const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
      g.translate(cx, cy, cz);
      return g;
    };
    const merge = (list) => {
      let total = 0;
      for (const g of list) total += g.getAttribute("position").count;
      const pos = new Float32Array(total * 3);
      let o = 0;
      for (const g of list) {
        pos.set(g.getAttribute("position").array, o);
        o += g.getAttribute("position").array.length;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      return out;
    };

    // 1) "Table": 10×10×20 column on the bed with a 40×40×4 slab on top.
    //    Upright, the slab's underside is a 1500 mm² ceiling; flipped it's zero.
    const table = merge([box(0, 0, 10, 10, 10, 20), box(0, 0, 22, 40, 40, 4)]);
    const sug = suggestOrientation(table, 45);

    // 2) Overhang overlay on the same shape flags roughly that ceiling area.
    const ov = overhangOverlay(table, 45);

    // 3) A plate standing upright: near-zero overhang → must NOT suggest re-orienting.
    const upright = box(0, 0, 30, 60, 4, 60);
    const sugUp = suggestOrientation(upright, 45);

    // 4) Thin walls: a 0.4 mm plate must be flagged; a 5 mm cube must pass.
    const thinPlate = box(0, 0, 10, 30, 0.4, 20);
    const thin = findThinWalls(thinPlate, 0.8);
    const thick = findThinWalls(box(0, 0, 2.5, 5, 5, 5), 0.8);

    return {
      sug: { improved: sug.improved, angle: sug.angleDeg, from: sug.fromOverhangMM2, to: sug.toOverhangMM2 },
      ovArea: ov.areaMM2, ovTris: ov.triangles,
      sugUp: { improved: sugUp.improved, reason: sugUp.reason },
      thin: { thin: thin.thinSamples, sampled: thin.sampled, min: thin.minThicknessMM, overlayTris: thin.overlay.triangles },
      thick: { thin: thick.thinSamples, sampled: thick.sampled, min: thick.minThicknessMM },
    };
  });
  check("A1 table: suggests a flip (improved)", res.sug.improved, JSON.stringify(res.sug));
  check("A1 table: rotation ≈ 180°", Math.abs(res.sug.angle - 180) < 6, `angle=${res.sug.angle}`);
  // to=100 is the column's now-internal coincident 10×10 face — a soup artifact, correct here.
  check("A1 table: overhang 1600 mm² → ~100", res.sug.from > 1350 && res.sug.from < 1700 && res.sug.to <= 150, `from=${res.sug.from} to=${res.sug.to}`);
  check("A2 heatmap flags the ceiling (~1500 mm²)", res.ovArea > 1350 && res.ovArea < 1650 && res.ovTris > 0, `area=${res.ovArea}`);
  check("A3 upright plate: no pointless re-orient", !res.sugUp.improved, res.sugUp.reason);
  check("A4 0.4 mm wall flagged", res.thin.thin > 0 && res.thin.min !== null && res.thin.min < 0.6 && res.thin.overlayTris > 0, JSON.stringify(res.thin));
  check("A4 5 mm cube passes", res.thick.thin === 0 && res.thick.min !== null && res.thick.min > 3, JSON.stringify(res.thick));
  await page.close();
}

// ---------- Part B: the real app flow ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle("Build the coaster template").click();
  await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.toLowerCase().includes("coaster"), null, { timeout: 120_000 });
  await page.waitForTimeout(600);

  // Swap in a "table" via the Source tab: a 10×10×20 column under a 40×40×4 slab —
  // a guaranteed 1,600 mm² ceiling that needs support, unlike the (well-designed,
  // support-free) templates.
  await page.locator(".tabs button", { hasText: "Source" }).first().click();
  const TABLE = `const defaultParams = {};
function main(replicad, params) {
  const col = replicad.makeBaseBox(10, 10, 20);
  const top = replicad.makeBaseBox(40, 40, 4).translate([0, 0, 20]);
  return col.fuse(top);
}`;
  await page.locator("textarea.code").fill(TABLE);
  await page.getByRole("button", { name: "Re-run" }).click();
  await page.waitForFunction(() => document.querySelector(".statusbar")?.textContent?.includes("40 × 40 × 24"), null, { timeout: 60_000 });
  await page.locator(".tabs button", { hasText: "3D View" }).first().click();
  await page.waitForTimeout(600);

  // Canvas heat pixels: count amber/red-ish pixels before + after the heatmap toggle.
  const heatCount = () => page.evaluate(() => {
    const cv = document.querySelector(".viewerCanvas canvas");
    const w = cv.width, h = cv.height;
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const ctx = off.getContext("2d");
    ctx.drawImage(cv, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let hot = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // amber (#f59e0b) → red (#dc2626) family: strong red, low blue, g between
      if (r > 150 && b < 90 && g < r * 0.75) hot++;
    }
    return hot;
  });
  const before = await heatCount();
  const printTab = page.locator(".tabs button", { hasText: "Printability" }).first();
  await printTab.click();
  await page.getByRole("button", { name: "Overhang heatmap" }).click();
  // Back to the 3D view so the canvas repaints with the overlay.
  await page.locator(".tabs button", { hasText: "3D View" }).first().click();
  await page.waitForTimeout(700);
  // Overhangs face DOWN — orbit so the underside comes on camera; direction of the
  // vertical drag depends on the controls' convention, so try both and take the max.
  const orbit = async (dy) => {
    const cv = await page.locator(".viewerCanvas canvas").boundingBox();
    const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + dy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  };
  const atDefault = await heatCount();
  await orbit(330);
  const lookingUp = await heatCount();
  await page.screenshot({ path: "shot-printprep-heatmap.png" });
  await orbit(-660);
  const lookingDown = await heatCount();
  const after = Math.max(atDefault, lookingUp, lookingDown);
  check("B1 heatmap paints the table's ceiling", after > before + 800, `before=${before} default=${atDefault} up=${lookingUp} down=${lookingDown}`);
  // Restore a sane view for the rest of the flow.
  await page.locator(".viewer-head").getByRole("button", { name: "3D", exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);

  // Orientation: the table must be flagged (1,600 mm² ceiling) → Apply → re-suggest says done.
  await printTab.click();
  await page.getByRole("button", { name: "Suggest orientation" }).click();
  await page.waitForTimeout(400);
  const verdict = await page.evaluate(() => [...document.querySelectorAll(".prow-note .fine")].map((x) => x.textContent).join(" | "));
  check("B2 table gets a flip suggestion", /Better orientation found: rotate 180/.test(verdict), verdict.slice(0, 140));
  await page.getByRole("button", { name: "Apply rotation" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("best printing orientation")), null, { timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Suggest orientation" }).click();
  await page.waitForTimeout(400);
  const verdict2 = await page.evaluate(() => [...document.querySelectorAll(".prow-note .fine")].map((x) => x.textContent).join(" | "));
  check("B2b after the flip no further gain is offered", /beats the current|almost no supports/.test(verdict2), verdict2.slice(0, 140));

  // Wall check (4 mm slab / 10 mm column → healthy).
  await page.getByRole("button", { name: /Check wall thickness/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".prow-note .fine")].some((x) => /Walls look healthy|sampled spots are under|Couldn't measure/.test(x.textContent)), null, { timeout: 30_000 });
  const wallTxt = await page.evaluate(() => [...document.querySelectorAll(".prow-note .fine")].map((x) => x.textContent).join(" | "));
  check("B3 wall check says healthy (≥ 4 mm)", /Walls look healthy/.test(wallTxt), wallTxt.slice(0, 140));

  // Elephant-foot chamfer: CAD-only button, applies, narrates once, model rebuilds.
  const triRow = () => page.evaluate(() => [...document.querySelectorAll(".prow")].find((r) => r.textContent.includes("Triangles"))?.textContent ?? "");
  const t0 = await triRow();
  await page.getByRole("button", { name: "Elephant-foot chamfer" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("Chamfered every bottom edge")), null, { timeout: 60_000 });
  await page.waitForTimeout(800);
  const t1 = await triRow();
  check("B4 chamfer narrated + model rebuilt (triangles changed)", t0 !== t1, `${t0} → ${t1}`);
  const errs = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble.error, .msg.error .bubble")].map((b) => b.textContent).join(" | "));
  check("B5 no errors in chat", !/Couldn't|failed/i.test(errs), errs.slice(0, 120));
  await page.screenshot({ path: "shot-printprep-panel.png" });
  await page.close();
}

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll printability-pack checks passed.");
