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
