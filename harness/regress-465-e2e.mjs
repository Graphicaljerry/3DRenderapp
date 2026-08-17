// The four app bugs the full suite pass turned up, and the proof they are gone.
//
// 1. DRILLING A HOLE HAD NO REACHABLE ENTRY POINT. `Hole…` lives in DirectOpBar, which
//    only renders inside a ContextBar gated on `!p.modifyCtl.op`. Modify absorbed the
//    Select tool and is now the only thing that arms face-picking — and it sets an op as
//    it arms. So the gate could never be satisfied: having a face picked always meant
//    modifyCtl.op was set. Every surface was affected (the bar, the More… dock panel),
//    while the help text still read "Drill holes: click a face → Hole…".
//
// 2. THE SHIFT-DRAG BOX-SELECT HINT WAS UNREACHABLE for exactly the same reason.
//
// 3. ESCAPE STOPPED CANCELLING MARK AFTER THE FIRST USE. MarkOverlay was the one overlay
//    in the app not using the shared useEscape stack; its own window listener was keyed
//    on a callback the parent reallocates every render, so it churned its subscription
//    and stopped answering, leaving Cancel as the only way out of a second session.
//
// 4. THE FINISHED STEP LIST ALWAYS DROPPED ITS LAST STEP. setStage archives the stage it
//    is REPLACING, so whichever ran last was still in the active row when the reply
//    overwrote it — the kernel pass, the step people most want to see, was never in the
//    trail.
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild } from "./enter.mjs";

const BASE = `http://localhost:${process.env.PORT ?? 5173}/`;
const STUB = "http://localhost:8899";
await fetch(`${STUB}/_reset`).catch(() => {});
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
const seed = (page) => page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_signin_prompted", "1");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
});

/** Click the model until a face actually picks. Raycasting from the page is the only
 *  reliable way in: the part is framed by the viewer, not placed by us, so a fixed
 *  canvas coordinate is a guess that silently misses and reads as "the tool is broken". */
async function modelPoints(page) {
  // three comes from the dev server so the projection uses the SAME matrices the viewer
  // renders with. (An earlier cut reached for a THREE that isn't on window, silently fell
  // back to a blind canvas grid, and reported "the tool is broken" when it had simply
  // never clicked the part.)
  return page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const s = window.__viewerS?.();
    if (!s?.mesh) return [];
    const r = s.renderer.domElement.getBoundingClientRect();
    const g = s.mesh.geometry;
    const pos = g.getAttribute("position");
    s.mesh.updateMatrixWorld(true);
    s.camera.updateMatrixWorld(true);
    const step = Math.max(1, Math.floor(pos.count / 60));
    const out = [];
    for (let i = 0; i < pos.count; i += step) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
        .applyMatrix4(s.mesh.matrixWorld).project(s.camera);
      if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1) continue; // off screen
      out.push([r.x + ((p.x + 1) / 2) * r.width, r.y + ((-p.y + 1) / 2) * r.height]);
    }
    return out;
  });
}

async function pickAFace(page) {
  for (const [x, y] of await modelPoints(page)) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    if (await page.locator(".sel-acts").count()) return true;
  }
  return false;
}

// ---------- 1 + 2: the hole entry point, and the box-select hint ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await seed(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(/^Build the phone stand\b/).click();
  await awaitBuild(page);
  await page.waitForTimeout(800);

  // Arm Modify — the only tool that arms face-picking now.
  await page.locator(".canvas-rail").getByRole("button", { name: "Modify" }).click();
  // Step off the rail. Its hover flyout (.rail-fly) stays up while the pointer rests on
  // the button Playwright just clicked, and it overlaps the panels that open next — a
  // later click then fails with "subtree intercepts pointer events", which looks like a
  // dead button and is really a tooltip nobody dismissed.
  await page.mouse.move(900, 500);
  await page.waitForTimeout(400);

  // The hint is the "nothing picked yet" state, so it has to be read BEFORE picking.
  check("box-select hint is reachable with picking armed", await page.locator(".box-hint").count() > 0,
    (await page.locator(".box-hint").first().innerText().catch(() => "")).slice(0, 60));

  const picked = await pickAFace(page);
  check("a face picks with Modify armed", picked);

  const holeBtn = page.locator(".sel-acts button", { hasText: /^Hole…$/ });
  check("Hole… is offered on a picked face", await holeBtn.count() > 0,
    (await page.locator(".sel-acts").innerText().catch(() => "")).replace(/\n/g, " · "));

  if (await holeBtn.count()) {
    const t0 = await page.evaluate(() => window.__viewerS?.()?.mesh?.geometry?.getAttribute?.("position")?.count ?? 0);
    await holeBtn.first().click();
    await page.waitForTimeout(500);
    check("clicking it opens the hole panel", await page.locator(".hole-panel, .holepanel").count() > 0
      || /diameter/i.test(await page.evaluate(() => document.body.innerText)));
    // Scope to the hole panel. The Modify tool's own "Apply" is also on screen and comes
    // first in the DOM, so an unscoped button lookup grabs that one — which is disabled
    // until a face is picked and reads as "drilling is broken" when nothing is wrong.
    const drill = page.locator(".hole-panel").getByRole("button", { name: "Drill hole" });
    check("the panel offers Drill hole", await drill.count() > 0);
    // Place it somewhere on the part first — the default spot is the face centre, but
    // clicking makes the placement explicit and exercises the placement path.
    const spots = await modelPoints(page);
    if (spots.length) { await page.mouse.click(...spots[Math.floor(spots.length / 2)]); await page.waitForTimeout(250); }
    await page.mouse.move(900, 500); // keep the rail flyout down before reaching for Drill
    if (await drill.count() && await drill.isEnabled()) {
      await drill.click();
      await page.waitForFunction((before) => {
        const n = window.__viewerS?.()?.mesh?.geometry?.getAttribute?.("position")?.count ?? 0;
        return n > 0 && n !== before;
      }, t0, { timeout: 120_000 }).catch(() => {});
      const t1 = await page.evaluate(() => window.__viewerS?.()?.mesh?.geometry?.getAttribute?.("position")?.count ?? 0);
      check("drilling changes the model", t1 !== t0 && t1 > 0, `${t0} → ${t1}`);
    } else {
      check("drilling changes the model", false, "Drill hole never became clickable");
    }
  }
  await page.screenshot({ path: "shot-regress-hole.png" });
  await page.close();
}

// ---------- 3: Escape cancels Mark every time, not just the first ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await seed(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(/^Build the phone stand\b/).click();
  await awaitBuild(page);
  await page.waitForTimeout(600);

  const markBtn = page.locator(".canvas-rail").getByRole("button", { name: "Mark" });
  const state = () => page.evaluate(() => ({
    overlay: document.querySelectorAll(".mark-overlay, canvas.markcv").length
      + (document.body.innerText.includes("Circle the part") ? 1 : 0),
    pressed: document.querySelector('.canvas-rail [aria-label="Mark"]')?.getAttribute("aria-pressed") === "true",
  }));
  for (const round of [1, 2, 3]) {
    await markBtn.click();
    await page.waitForTimeout(400);
    const on = await state();
    check(`Mark session ${round} opens`, on.pressed, JSON.stringify(on));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const off = await state();
    check(`Escape cancels Mark session ${round}`, !off.pressed, JSON.stringify(off));
  }
  await page.close();
}

// ---------- 4: the finished trail keeps its last step ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await seed(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  const chip = page.locator(".lo-trigger");
  if (!/no plan/i.test(await chip.innerText())) {
    await chip.click();
    await page.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
    await page.keyboard.press("Escape");
  }
  await page.locator(".launch-composer textarea").fill("A SPECIFIC bracket");
  await page.locator(".launch-composer .send").click();
  await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 240_000 });
  await page.waitForTimeout(2000);

  // Open the collapsed trail if it is behind a "Completed N steps" summary.
  const sum = page.locator("summary, .steps-toggle", { hasText: /Completed \d+ steps?/i }).first();
  if (await sum.count()) await sum.click().catch(() => {});
  await page.waitForTimeout(400);
  const trail = await page.evaluate(() => document.body.innerText);
  check("the trail includes the CAD kernel step", /CAD kernel/i.test(trail),
    (trail.match(/Completed \d+ steps?[\s\S]{0,220}/i)?.[0] ?? "no trail found").replace(/\n/g, " / ").slice(0, 220));
  await page.close();
}

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all four regressions fixed");
await browser.close();
process.exit(fails.length ? 1 : 0);
