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
    //
    // WAIT for the door, don't sample for it: `.launchpad` exists a render before its
    // buttons do, and this was read once and thrown on. The gap is invisible on a warm
    // machine and reliable after a reload mid-probe (resize-e2e's B6), where it reported
    // "found no way into the workspace" about a screen that grew one a moment later.
    const doors = [/open an empty workspace/i, /^skip$/i];
    await page.waitForFunction(
      (pats) => [...document.querySelectorAll("button")].some((b) => pats.some((p) => new RegExp(p.source, p.flags).test(b.textContent ?? ""))),
      doors.map((r) => ({ source: r.source, flags: r.flags })),
      { timeout },
    ).catch(() => {});
    let opened = false;
    for (const re of doors) {
      const door = page.locator("button").filter({ hasText: re }).first();
      if (await door.count()) { await door.click(); opened = true; break; }
    }
    if (!opened) {
      // Name what WAS on screen. This throw has fired twice under three-lane suite load
      // and passed on the same probe run alone, so the next occurrence needs to say
      // whether the Launchpad rendered a different set of buttons or none at all.
      const seen = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter(Boolean));
      throw new Error(`enterWorkspace: on the Launchpad but found no way into the workspace. Buttons present: ${seen.length ? seen.join(" | ") : "(none)"}`);
    }
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
    if (document.querySelector(".gen-pill")) return false; // a build is still running
    // The viewer's own state is the truest answer, but it is installed behind
    // `import.meta.env.DEV` (Viewer.tsx), so a bundle from `vite build` — which is what
    // pwa-e2e drives through `vite preview` — carries no hook at all and the vertex count
    // reads 0 for a model that built perfectly. Ask the hook only when it EXISTS; a count
    // of zero WITH a hook still means no model, so every dev-server probe is unchanged.
    const hook = window.__viewerS;
    if (typeof hook === "function")
      return (hook()?.mesh?.geometry?.getAttribute?.("position")?.count ?? 0) > 0;
    // Production fallback, read from markup the app actually ships: the statusbar's
    // Export button carries `disabled={!p.geometry}` and the dims readout is an em dash
    // until a build lands. The digit test is not decoration — a build that produced an
    // empty shape reports "0 × 0 × 0 mm", which is neither the em dash nor a model.
    const ex = document.querySelector(".statusbar .export-cta");
    const dims = document.querySelector(".statusbar .dims")?.textContent ?? "";
    return !!ex && !ex.disabled && /[1-9]/.test(dims);
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
/** Screen coordinates that are definitely ON the model, projected through the same
 *  matrices the viewer renders with. Shared because "click a canvas fraction" is a guess
 *  that misses silently — and a probe that misses reads whatever was already on screen.
 *
 *  Triangle CENTROIDS, not vertices. A vertex sits on an edge or a corner, where the
 *  hover-adaptive picker prefers the edge or the corner — and on a curved shell it often
 *  resolves to nothing at all. Measured on the phone stand from Top view with Modify
 *  armed: clicking 20 projected vertices selected once; clicking 30 projected centroids
 *  selected 29 times and offered Hole… 29 times. Centroids are interior points of real
 *  triangles, so they land in the middle of a face by construction. */
export async function modelPoints(page) {
  return page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const s = window.__viewerS?.();
    if (!s?.mesh) return [];
    const r = s.renderer.domElement.getBoundingClientRect();
    const geo = s.mesh.geometry;
    const pos = geo.getAttribute("position");
    const idx = geo.getIndex();
    s.mesh.updateMatrixWorld(true);
    s.camera.updateMatrixWorld(true);
    const corner = (i) => {
      const k = idx ? idx.getX(i) : i;
      return new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k));
    };
    const tris = Math.floor((idx ? idx.count : pos.count) / 3);
    const out = [];
    for (let t = 0; t < tris; t += Math.max(1, Math.floor(tris / 120))) {
      const p = corner(t * 3).add(corner(t * 3 + 1)).add(corner(t * 3 + 2)).multiplyScalar(1 / 3)
        .applyMatrix4(s.mesh.matrixWorld).project(s.camera);
      if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1) continue;
      out.push([r.x + ((p.x + 1) / 2) * r.width, r.y + ((-p.y + 1) / 2) * r.height]);
    }
    return out;
  });
}

export async function pickFace(page, { arm = true, until = null } = {}) {
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
  const pts = await modelPoints(page);
  // `until` matters more than it looks. Stopping at the FIRST selection is wrong whenever
  // the caller needs a particular KIND of one: the headphone desk hook is mostly curved,
  // and Hole… is deliberately offered only on a flat face (holeCtl.canStart requires
  // kind === "face" && !curved). Without a predicate the helper stops on a curved face,
  // the verb is correctly absent, and the probe reports a missing feature that is working.
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    if (!(await page.locator(".sel-acts").count())) continue;
    if (!until) return true;
    if (await until()) return true;
  }
  return false;
}
