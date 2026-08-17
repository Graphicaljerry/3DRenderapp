// Printability-pack verification.
// Part A (unit, via Vite's TS transform in the browser): orient/overhang/thinwalls
// on synthetic shapes with known answers. Part B (e2e): the Print tab flow on real
// templates — heatmap pixels, orientation suggest, wall check, elephant-foot chamfer.
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild } from "./enter.mjs";

// Same convention as meshrepair-e2e: PORT lets this run against a private vite when
// someone else's dev server owns 5173.
const BASE = `http://localhost:${process.env.PORT ?? 5173}/`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

// ---------- Part A: module-level checks on synthetic geometry ----------
{
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
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
  // Error recorder for B5. Only a failed BUILD REPLY stays in the transcript now
  // (`visible = messages.filter((m) => !m.error || m.reply)`); every other failure —
  // including the ones this flow can raise, like a bad Re-run — appears as a canvas
  // toast that takes itself away after 9 s. Watching the chat alone would be blind to
  // exactly the failures this probe can produce, so record the toasts as they appear.
  // (`document`, not `documentElement`: the latter can still be null this early.)
  await page.addInitScript(() => {
    window.__toasts = [];
    const grab = () => document.querySelectorAll(".canvas-toast-text").forEach((n) => {
      const t = n.textContent?.trim();
      if (t && !window.__toasts.includes(t)) window.__toasts.push(t);
    });
    new MutationObserver(grab).observe(document, { childList: true, subtree: true });
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  // The canvas tab strip is gone: its sections moved into the Inspector dock, where each
  // row carries aria-label={label} whether the list is showing names or packed to icons.
  const section = (label) => page.locator(".dock-list").getByRole("button", { name: label, exact: true });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(/^Build the phone stand\b/).click();
  // Was: wait for a chat bubble to say "phone stand". The blurb no longer repeats the
  // template's name, and a bubble was never proof a model appeared — awaitBuild asks
  // the viewer whether it is holding geometry.
  await awaitBuild(page);
  await page.waitForTimeout(600);

  // Swap in a "table" via the Source section: a 10×10×20 column under a 40×40×4 slab —
  // a guaranteed 1,600 mm² ceiling that needs support, unlike the (well-designed,
  // support-free) templates.
  await section("Source").click();
  const TABLE = `const defaultParams = {};
function main(replicad, params) {
  const col = replicad.makeBaseBox(10, 10, 20);
  const top = replicad.makeBaseBox(40, 40, 4).translate([0, 0, 20]);
  return col.fuse(top);
}`;
  await page.locator("textarea.code").fill(TABLE);
  await page.getByRole("button", { name: "Re-run" }).click();
  await page.waitForFunction(() => document.querySelector(".statusbar")?.textContent?.includes("40 × 40 × 24"), null, { timeout: 60_000 });
  // No "back to 3D View" step any more: the stage is never hidden — every Inspector
  // section docks BESIDE a live viewer instead of covering it.
  await page.waitForTimeout(600);

  // Canvas heat pixels: count amber/red-ish pixels before + after the heatmap toggle.
  // The renderer is built without preserveDrawingBuffer, so drawImage-ing the canvas
  // from an idle tick reads a CLEARED buffer — every count came back 0 regardless of
  // what was on screen. Render one frame through the viewer's own state and read it in
  // the same tick, exactly as the app's own capture paths do.
  const heatCount = () => page.evaluate(() => {
    const s = window.__viewerS?.();
    if (!s) throw new Error("viewer state not exposed on window.__viewerS");
    s.renderer.render(s.scene, s.camera);
    const cv = s.renderer.domElement;
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
  const printPanel = section("Printability");
  await printPanel.click();
  await page.getByRole("button", { name: "Overhang heatmap" }).click();
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
  await orbit(-660);
  const lookingDown = await heatCount();
  const after = Math.max(atDefault, lookingUp, lookingDown);
  // Shoot the pose that actually has the ceiling on camera — the old shot was taken
  // mid-sweep and saved a picture of the model's grey top.
  await page.screenshot({ path: "shot-printprep-heatmap.png" });
  check("B1 heatmap paints the table's ceiling", after > before + 800, `before=${before} default=${atDefault} up=${lookingUp} down=${lookingDown}`);
  // Restore a sane view for the rest of the flow. The old `.viewer-head` "3D" button is
  // gone with the tab strip; re-framing now lives in the head's View menu.
  await page.locator(".viewer-head").getByRole("button", { name: "View" }).click();
  await page.getByRole("menuitem", { name: /Reset view/ }).click();
  await page.waitForTimeout(300);

  // Orientation: the table must be flagged (1,600 mm² ceiling) and flipped.
  //
  // This used to be two buttons — "Suggest orientation" wrote a verdict into the panel,
  // "Apply rotation" acted on it. The panel now carries one button, "Lay flat — best
  // orientation", that scores the poses AND applies the winner, and it clears the
  // suggestion as it commits. So the suggestion text is no longer a stable thing to
  // read: the flip is asserted where it lands instead — the narration, and History's
  // record of the applied angle (the "rotate 180°" the old check was really after).
  await printPanel.click();
  await page.getByRole("button", { name: /Lay flat/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("best printing orientation")), null, { timeout: 60_000 });
  await page.waitForTimeout(800);
  const rows = () => page.evaluate(() => [...document.querySelectorAll(".vrow")].map((r) => r.textContent));
  await section("History").click();
  const hist = await rows();
  check("B2 the table is flipped ~180° onto its slab", /Rotated 1(79|80|81)°/.test(hist.join(" | ")), hist.join(" | ").slice(0, 160));
  // Second pass: the flipped table rests slab-down, so the same button must now report
  // that nothing is left to win — and say so without rotating anything again, which is
  // why History is re-read: a no-op must not author a version.
  await printPanel.click();
  await page.getByRole("button", { name: /Lay flat/ }).click();
  await page.waitForTimeout(600);
  const verdict2 = await page.evaluate(() => [...document.querySelectorAll(".prow-note .fine")].map((x) => x.textContent).join(" | "));
  check("B2b after the flip no further gain is offered", /beats the current|almost no supports/.test(verdict2), verdict2.slice(0, 140));
  await section("History").click();
  const hist2 = await rows();
  check("B2c the no-op rotates nothing (no new version)", hist2.length === hist.length, `${hist.length} → ${hist2.length}`);
  await printPanel.click();

  // Wall check (4 mm slab / 10 mm column → healthy).
  await page.getByRole("button", { name: /Check wall thickness/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".prow-note .fine")].some((x) => /No thin walls in|sampled spots are under|Couldn't measure/.test(x.textContent)), null, { timeout: 30_000 });
  const wallTxt = await page.evaluate(() => [...document.querySelectorAll(".prow-note .fine")].map((x) => x.textContent).join(" | "));
  // "Walls look healthy" was reworded — the clean verdict now names the sample count and
  // the thinnest wall it actually measured, and says outright that it is a sample, not a
  // proof. Assert both halves: nothing flagged, and the measurement matches the 4 mm slab
  // (the thinnest feature in this model) rather than some sliver the check invented.
  const thinnest = Number(/thinnest measured ≈ ([\d.]+) mm/.exec(wallTxt)?.[1] ?? NaN);
  check("B3 wall check says healthy, thinnest ≈ the 4 mm slab", /No thin walls in \d+ sampled spots/.test(wallTxt) && thinnest >= 3.5, wallTxt.slice(0, 160));

  // Elephant-foot bevel: CAD-only button, applies, narrates once, model rebuilds.
  const triRow = () => page.evaluate(() => [...document.querySelectorAll(".prow")].find((r) => r.textContent.includes("Triangles"))?.textContent ?? "");
  const t0 = await triRow();
  await page.getByRole("button", { name: /Elephant-foot bevel/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("Chamfered every bottom edge")), null, { timeout: 60_000 });
  await page.waitForTimeout(800);
  const t1 = await triRow();
  check("B4 chamfer narrated + model rebuilt (triangles changed)", t0 !== t1, `${t0} → ${t1}`);
  // An errored message is `.msg <role> err` — never `.msg.error`, and the bubble inside
  // carries no class of its own, so BOTH old selectors matched nothing and the check
  // could only ever pass. Read the bubbles the app really paints red, plus every toast
  // recorded above — and require both surfaces to be empty, since anything on either one
  // in this flow is a failure.
  const errs = await page.evaluate(() => [
    ...[...document.querySelectorAll(".msg.err .bubble")].map((b) => b.textContent),
    ...(window.__toasts ?? []),
  ].join(" | "));
  check("B5 no errors in the chat or on the canvas", errs === "", errs.slice(0, 160));
  await page.screenshot({ path: "shot-printprep-panel.png" });
  await page.close();
}

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll printability-pack checks passed.");
