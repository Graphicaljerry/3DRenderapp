/** Land in the workspace, from wherever the app boots.
 *
 *  Until build 429 every script seeded `moldable_entered: "1"` and the app opened
 *  straight into the workspace, so waiting for `.topbar` right after `goto` worked. That
 *  flag is inert now — the app always boots on the Launchpad unless a recent session is
 *  being resumed — and 54 of the 61 scripts here were left waiting 60 s for a selector
 *  that was never going to appear.
 *
 *  Seeding the new freshness stamp would not fix them either: resuming needs a project
 *  that already exists, and these scripts create theirs during the run. The honest
 *  equivalent of the old flag is the Launchpad's own "Open an empty workspace" door, so
 *  that is what this clicks.
 *
 *  Safe to call when already inside the workspace — it returns immediately. */
export async function enterWorkspace(page, timeout = 60_000) {
  // Whichever screen we landed on. `.launchpad` and `.topbar` are mutually exclusive.
  await page.waitForSelector(".launchpad, .topbar", { timeout });
  if (!(await page.$(".topbar"))) {
    // Both Launchpad variants (with and without a project shelf) carry this door; the
    // onboarding screen offers "Skip" instead. Match on text, not position.
    let opened = false;
    for (const re of [/open an empty workspace/i, /^skip$/i]) {
      const door = page.locator("button").filter({ hasText: re }).first();
      if (await door.count()) { await door.click(); opened = true; break; }
    }
    if (!opened) throw new Error("enterWorkspace: on the Launchpad but found no way into the workspace");
  }
  // `.topbar` exists one commit before its buttons do, and callers click Templates or
  // Library on the very next line — returning early made those clicks land on nothing and
  // hang on `.overlay`. Wait for the chrome to be populated, not merely present.
  await page.waitForSelector(".topbar", { timeout });
  await page.waitForFunction(
    () => (document.querySelector(".topbar")?.querySelectorAll("button").length ?? 0) >= 3
      && !!document.querySelector(".canvas-rail"),
    null,
    { timeout },
  );
}

/** Wait for a build to actually land: the viewer holds real geometry and nothing is still
 *  generating.
 *
 *  Scripts used to detect this by waiting for a chat bubble to mention the template's
 *  name. That was brittle twice over — it broke when the template set was rebuilt (the
 *  name no longer existed) and again when the blurb was reworded (the bubble says "A
 *  headphone hook that clamps to your desk…", never "headphone desk hook") — and it never
 *  actually checked that a model appeared. This asks the question the scripts meant. */
export async function awaitBuild(page, timeout = 180_000) {
  await page.waitForFunction(() => {
    const n = window.__viewerS?.()?.mesh?.geometry?.getAttribute?.("position")?.count ?? 0;
    return n > 0 && !document.querySelector(".gen-pill");
  }, null, { timeout });
}

/** Click the model until a face actually picks, and return true when one did.
 *
 *  Fixed canvas fractions — [0.42, 0.75] and friends — are a guess. The viewer frames the
 *  part itself, so where it lands on screen depends on its shape and the camera, and a
 *  miss is silent: nothing selects, the verb never appears, and the probe reports a
 *  missing feature. Projecting real surface vertices through the SAME matrices the viewer
 *  renders with means every click is on the part by construction.
 *
 *  Picking also needs a tool armed at all. Modify absorbed the standalone Select tool
 *  (044ab7f) and owns picking outright, so a bare canvas click selects nothing. */
export async function pickFace(page, { arm = true } = {}) {
  if (arm) {
    const modify = page.locator(".canvas-rail").getByRole("button", { name: "Modify" });
    if (await modify.count()) {
      await modify.click();
      // Step off the rail: its flyout stays up under the pointer and then intercepts the
      // clicks that follow, which reads as a dead canvas.
      await page.mouse.move(900, 500);
      await page.waitForTimeout(400);
    }
  }
  const pts = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const s = window.__viewerS?.();
    if (!s?.mesh) return [];
    const r = s.renderer.domElement.getBoundingClientRect();
    const pos = s.mesh.geometry.getAttribute("position");
    s.mesh.updateMatrixWorld(true);
    s.camera.updateMatrixWorld(true);
    const out = [];
    for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 80))) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
        .applyMatrix4(s.mesh.matrixWorld).project(s.camera);
      if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1) continue;
      out.push([r.x + ((p.x + 1) / 2) * r.width, r.y + ((-p.y + 1) / 2) * r.height]);
    }
    return out;
  });
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    if (await page.locator(".sel-acts").count()) return true;
  }
  return false;
}
