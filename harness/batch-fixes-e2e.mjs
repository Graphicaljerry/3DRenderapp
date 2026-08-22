// The fixes shipped in this batch, driven through the real UI.
//
// Scope is deliberately narrow: this file proves THESE changes, and nothing else. The
// broad regressions (launchpad widths, phone chrome, menus, settings) already have their
// own scripts and are run alongside this one, not folded into it.
//
//   1  Breadcrumb at the TOP of privacy.html and terms.html
//   2  Stats view toggle survives a reload
//   3  View ▾ shows an open state, and a second press closes it
//   4  Print-time estimate: present, a real duration, moves with layer height
//   5  Improve reads as a labelled control and says why it's off when it's off
//   6  Both send buttons centre their glyph, and the Launchpad's sits on its row
//   7  Export never covers a statusbar fact at phone width
//   8  The stats card's own pickers are actually clickable
//   9  History: restoring leaves ONE row however much you browse, and rows can be removed
//  10  The Adjust slider's hover highlight arrives promptly, not a second later
//  11  estimatePrintTime returns the numbers its own header claims it was checked against
//  12  A removed step stays removed through a sync merge, not just through a reload
//  13  The build plate stays put when a size parameter changes
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { enterWorkspace, awaitBuild } from "./enter.mjs";

const PORT = process.env.PORT ?? 5173;
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

const seed = (page) => page.addInitScript(() => {
  localStorage.setItem("moldable_signin_prompted", "1");
});

// ---------------------------------------------------------------- 1. breadcrumbs ----
for (const [file, here] of [["privacy.html", "Privacy"], ["terms.html", "Terms of Use"]]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${URL}/${file}`, { waitUntil: "domcontentloaded" });
  const m = await page.evaluate((here) => {
    const nav = document.querySelector("nav.crumbs");
    if (!nav) return { ok: false, why: "no nav.crumbs" };
    const a = nav.querySelector("a");
    const h1 = document.querySelector("h1");
    return {
      ok: true,
      href: a?.getAttribute("href"),
      text: a?.textContent?.trim(),
      // "at the top" is the whole request: a way home that needs a scroll is the thing
      // that was already there at the bottom of the page.
      aboveHeading: !!h1 && nav.compareDocumentPosition(h1) === Node.DOCUMENT_POSITION_FOLLOWING,
      current: nav.querySelector('[aria-current="page"]')?.textContent?.trim(),
      wantsCurrent: here,
      navTop: Math.round(nav.getBoundingClientRect().top),
      vh: window.innerHeight,
    };
  }, here);
  check(`${file}: breadcrumb links home from above the heading`,
    m.ok && m.href === "./" && m.text === "Moldable" && m.aboveHeading && m.navTop < m.vh,
    JSON.stringify(m));
  check(`${file}: breadcrumb names the page you're on`, m.current === here, `got "${m.current}"`);
  await page.close();
}

// -------------------------------------------------- 2/3/4/8. workspace, desktop ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
  await seed(page);
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
  await awaitBuild(page);
  await page.waitForSelector(".mesh-stats", { timeout: 60_000 });

  const viewBtn = page.locator('.viewer-tools button[title^="View options"]');

  // --- 3. open state + close-on-second-press ---
  await viewBtn.click();
  await page.waitForSelector(".pmenu", { timeout: 10_000 });
  check("View ▾ marks itself open", await viewBtn.evaluate((b) => b.classList.contains("on") && b.getAttribute("aria-expanded") === "true"));
  await viewBtn.click();
  // The bug was that it closed on mousedown and the same press re-opened it a tick
  // later, so it "disappeared for a second and came back". Wait past that tick before
  // asking, or a passing assertion would only mean we looked too early.
  await page.waitForTimeout(600);
  check("View ▾ closes on a second press and stays closed", (await page.locator(".pmenu").count()) === 0);
  check("View ▾ drops its open state when closed", await viewBtn.evaluate((b) => !b.classList.contains("on")));

  // --- 4/8. the print-time row ---
  const timeRow = page.locator(".mesh-stats .ms-time");
  check("stats card shows a print-time estimate", (await timeRow.count()) === 1);
  const readTime = () => timeRow.locator("b").innerText();
  const t02 = await readTime();
  check("the estimate is a real duration", /\d+\s*(h|m)/.test(t02), t02);
  // 8: the pickers inside a pointer-events:none card have to opt back in, or they are
  // decoration. elementFromPoint is the honest test — a select can look fine and never
  // receive the click.
  const hit = await page.evaluate(() => {
    const s = document.querySelector(".ms-time select");
    const r = s.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el?.tagName + "." + (el?.className || "");
  });
  check("stats pickers receive the pointer", hit.startsWith("SELECT"), hit);
  // Finer layers, more of them, longer print — if the number doesn't move, the picker
  // isn't wired to the arithmetic.
  await page.selectOption(".ms-time select[aria-label='Layer height']", "0.12");
  await page.waitForTimeout(300);
  const t012 = await readTime();
  const mins = (s) => { const h = /(\d+)\s*h/.exec(s), m = /(\d+)\s*m/.exec(s); return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0); };
  check("finer layers read as a longer print", mins(t012) > mins(t02), `0.20 → ${t02}, 0.12 → ${t012}`);
  await page.selectOption(".ms-time select[aria-label='Layer height']", "0.2");

  // --- 2. Stats toggle survives a reload ---
  await viewBtn.click();
  // The row's accessible name is its label plus its hint, so match the bold label only.
  await page.locator('.pmenu button[role="menuitemcheckbox"] b').filter({ hasText: /Stats$/ }).first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("turning Stats off hides the card", (await page.locator(".mesh-stats").count()) === 0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(2500);
  check("Stats is still off after a reload", (await page.locator(".mesh-stats").count()) === 0,
    `localStorage moldable_stats = ${await page.evaluate(() => localStorage.getItem("moldable_stats"))}`);
  await page.close();
}

// ------------------------------------------------------------ 5. Improve button ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await seed(page);
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  const imp = page.locator(".launch-composer-foot .improve");
  const label = imp.locator(".improve-lab");
  check("Improve carries a readable label on the Launchpad",
    (await label.count()) === 1 && (await label.isVisible()) && (await label.innerText()).trim() === "Improve");
  const emptyTitle = await imp.getAttribute("title");
  check("greyed-out Improve says WHY it's off",
    !(await imp.isEnabled()) && /describe your part first/i.test(emptyTitle ?? ""), emptyTitle ?? "");
  await page.fill(".launch-composer textarea", "a wall bracket for a 32 mm pipe");
  await page.waitForTimeout(250);
  const fullTitle = await imp.getAttribute("title");
  check("typing enables Improve and changes what it promises",
    (await imp.isEnabled()) && /rewrite what you typed/i.test(fullTitle ?? ""), fullTitle ?? "");
  await page.close();
}

// ------------------------------------------- 6/7. phone: composer + statusbar ----
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
  await seed(page);
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);

  // 6: the in-project composer's send glyph, centred in its own circle.
  const c = await page.evaluate(() => {
    const b = document.querySelector(".composer .send");
    if (!b) return null;
    const br = b.getBoundingClientRect(), sr = b.querySelector("svg").getBoundingClientRect();
    return {
      dx: Math.round(((sr.left + sr.right) / 2 - (br.left + br.right) / 2) * 100) / 100,
      dy: Math.round(((sr.top + sr.bottom) / 2 - (br.top + br.bottom) / 2) * 100) / 100,
    };
  });
  check("chat send glyph is centred in its button", !!c && Math.abs(c.dx) <= 0.5 && Math.abs(c.dy) <= 0.5, JSON.stringify(c));

  // The button this batch actually MOVED is the Launchpad's, so measure that one too —
  // the check above passes whether or not the fix landed, because the in-project composer
  // was never touched. Its centre-line-vs-the-row check lives in launchpad-widths-e2e;
  // what belongs here is that the glyph is centred in the circle at phone width.
  const lp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await seed(lp);
  await lp.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await lp.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  const lc = await lp.evaluate(() => {
    const b = document.querySelector(".launch-composer .send");
    if (!b) return null;
    const br = b.getBoundingClientRect(), sr = b.querySelector("svg").getBoundingClientRect();
    const row = document.querySelector(".launch-composer-foot");
    return {
      dx: Math.round(((sr.left + sr.right) / 2 - (br.left + br.right) / 2) * 100) / 100,
      dy: Math.round(((sr.top + sr.bottom) / 2 - (br.top + br.bottom) / 2) * 100) / 100,
      inRow: !!row && row.contains(b),
    };
  });
  check("Launchpad send glyph is centred, and the button is in the controls row",
    !!lc && Math.abs(lc.dx) <= 0.5 && Math.abs(lc.dy) <= 0.5 && lc.inRow, JSON.stringify(lc));
  // The row spans the composer now, so it must not eat clicks meant for the text field.
  // Aim at the measured GAP between the last chip and the send circle — a hardcoded x
  // just lands on whichever control happens to be there at this width.
  const gap = await lp.evaluate(() => {
    const row = document.querySelector(".launch-composer-foot");
    const send = row.querySelector(".send").getBoundingClientRect();
    const chips = [...row.children].filter((e) => !e.classList.contains("send"))
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const lastRight = Math.max(...chips.map((r) => r.right));
    const r = row.getBoundingClientRect();
    return { x: (lastRight + send.left) / 2, y: (r.top + r.bottom) / 2, width: send.left - lastRight };
  });
  check("the controls row leaves a gap to click through", gap.width > 12, `${Math.round(gap.width)}px`);
  await lp.mouse.click(gap.x, gap.y);
  const focused = await lp.evaluate(() => document.activeElement?.tagName);
  check("clicking the empty part of the controls row still reaches the text field",
    focused === "TEXTAREA", `focus went to ${focused}`);
  await lp.close();

  // 7: with a model on the plate the statusbar carries its full set of facts, which is
  // the state where Export was covering the printer chip.
  await page.locator(".topbar .profile").click();
  await page.locator(".pmenu.account-menu button", { hasText: /^Templates$/ }).click();
  await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
  await awaitBuild(page);
  await page.waitForTimeout(1200);
  const bar = await page.evaluate(() => {
    const ex = document.querySelector(".export-wrap");
    const exr = ex.getBoundingClientRect();
    // What the EYE sees of a chip: its own box, intersected with every ancestor that
    // clips. A chip inside an overflow:auto row reports its full geometry even when most
    // of it has been scrolled out of sight, so raw rects call pixels "covered" that were
    // never painted.
    //
    // Walking the ancestors rather than naming one container is the point: an earlier
    // version of this check read a single ".statusbar-facts", and when that element was
    // display:contents its rect was 0×0 — so every chip clipped to nothing, the loop
    // examined none of them, and the check passed against a layout that WAS broken.
    // Hence `examined` below: a scan that inspected nothing is a failure, not a pass.
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      let box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX === "visible") continue;
        const pr = p.getBoundingClientRect();
        if (pr.width < 1 || pr.height < 1) continue; // display:contents and friends clip nothing
        box = { left: Math.max(box.left, pr.left), right: Math.min(box.right, pr.right), top: Math.max(box.top, pr.top), bottom: Math.min(box.bottom, pr.bottom) };
      }
      return box;
    };
    const covered = [];
    let examined = 0;
    for (const el of document.querySelectorAll(".statusbar .dims, .statusbar .engine-wrap, .statusbar .bedchip, .statusbar .p2p, .statusbar .build-tag")) {
      const v = visible(el);
      if (v.right - v.left < 2 || v.bottom - v.top < 2) continue;
      examined++;
      const ox = Math.min(v.right, exr.right) - Math.max(v.left, exr.left);
      const oy = Math.min(v.bottom, exr.bottom) - Math.max(v.top, exr.top);
      if (ox > 1 && oy > 1) covered.push(`${el.className.toString().split(" ")[0]} ${Math.round(ox)}×${Math.round(oy)}px`);
    }
    const onTop = document.elementFromPoint((exr.left + exr.right) / 2, (exr.top + exr.bottom) / 2);
    return { covered, examined, onTopIsExport: !!onTop?.closest(".export-cta"), vw: innerWidth, reachable: exr.right <= innerWidth + 1 && exr.left >= 0 };
  });
  check("Export covers no statusbar fact at phone width",
    bar.examined >= 2 && bar.covered.length === 0,
    bar.examined < 2 ? `only ${bar.examined} facts were on screen to check` : bar.covered.join("; "));
  check("nothing is painted over the Export button", bar.onTopIsExport, JSON.stringify(bar));
  check("Export is still fully on screen", bar.reachable, JSON.stringify(bar));
  await page.close();
}

// --------------------------------------------- 10. Adjust hover highlight speed ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
  await seed(page);
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
  await awaitBuild(page);
  await page.waitForTimeout(1200);

  const cv = page.locator("canvas").first();
  const cb = await cv.boundingBox();
  // A small clip over the middle of the model. Capturing the whole 1440px canvas costs
  // ~118ms per poll, which is coarser than the latency being measured; 180×180 costs ~34.
  const CLIP = { x: Math.round(cb.x + cb.width / 2 - 90), y: Math.round(cb.y + cb.height / 2 - 90), width: 180, height: 180 };
  const shot = () => page.screenshot({ clip: CLIP });

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await page.waitForSelector(".prow", { timeout: 20_000 });
  await page.waitForTimeout(14_000); // let the background probes fill the cache

  // Rows 4 and 5 have never been hovered: this is a FIRST look, which is the case that
  // was slow. Measured before the fix at 730-816ms on this model (and the 1-2s people
  // reported on a fillet-heavy one); after it, 247-265ms. 450 leaves room for a loaded
  // machine without being able to pass on the old code.
  const times = [];
  for (const row of [4, 5]) {
    const rb = await page.locator(".prow").nth(row).boundingBox();
    // The row's box is read BEFORE the clock starts: locator.hover() runs actionability
    // checks first, and timing those as app latency added ~200ms to every reading.
    await page.mouse.move(1200, 200);
    await page.waitForTimeout(700);
    const base = await shot();
    const t0 = Date.now();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    let ms = null;
    for (;;) {
      if (!(await shot()).equals(base)) { ms = Date.now() - t0; break; }
      if (Date.now() - t0 > 6000) break;
    }
    times.push(ms);
  }
  check("hovering a slider highlights its part promptly",
    times.every((t) => t !== null && t <= 450), `${times.map((t) => (t === null ? "never" : t + "ms")).join(", ")}`);
  await page.close();
}

// ---------------------------------------------------------------- 9. History ----
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
  await seed(page);
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
  await awaitBuild(page);

  // Two more recorded steps, through the real editors.
  await page.getByRole("button", { name: "Printability", exact: true }).click();
  await page.locator(".dock-body button", { hasText: /^Elephant-foot bevel$/ }).click();
  await awaitBuild(page);
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.locator(".pocket-row .x, .pocket-row button[aria-label^='Remove']").first().click();
  await awaitBuild(page);

  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.waitForSelector(".vrow", { timeout: 20_000 });
  const rows = () => page.locator(".vrow").count();
  const settled = async () => {
    await page.waitForFunction(() => !document.querySelector(".vrow.loading"), null, { timeout: 120_000 });
    await page.waitForTimeout(400);
  };
  const before = await rows();
  check("three edits recorded three steps", before >= 3, `${before} rows`);

  // Rows render newest-first, so the LAST one is the oldest.
  const oldest = () => page.locator(".vrow").last();
  await oldest().click();
  await settled();
  const afterFirst = await rows();
  check("going back records one step", afterFirst === before + 1, `${before} → ${afterFirst}`);
  check("the new step is marked as a restore", (await page.locator(".vrow .vtag", { hasText: /^restored$/ }).count()) >= 1);
  // The reported bug: pressing the same row again appended another near-identical copy.
  // It can't now, because the row you restored reads as where you ARE — a restore step
  // stands for the snapshot it copied, so both rows say Current and neither is pressable.
  // Asserting the state is the honest version of this check: asserting "clicking it adds
  // nothing" passed just as well when the click silently did nothing at all, which is
  // what the first pass shipped.
  const twoCurrent = await page.locator(".vrow.current").count();
  check("the step you went back to reads as current, not as somewhere to go",
    twoCurrent === 2 && (await oldest().isDisabled()), `${twoCurrent} rows marked current`);
  // And browsing on to a DIFFERENT step replaces the restore row rather than stacking.
  const other = page.locator(".vrow:not(.current):not([disabled])").last();
  await other.click();
  await settled();
  check("browsing to another step leaves one restore row, not two", (await rows()) === afterFirst, `${afterFirst} → ${await rows()}`);
  check("…and still exactly one place is marked current", (await page.locator(".vrow.current").count()) === 2,
    `${await page.locator(".vrow.current").count()} rows marked current`);

  // --- per-step delete ---
  const target = page.locator(".vrow-wrap").filter({ has: page.locator(".vdel") }).first();
  const n0 = await rows();
  await target.hover();
  await target.locator(".vdel").click();
  check("removing a step asks first", (await page.locator(".vdel-ask").count()) === 1);
  await page.locator(".vdel-yes").first().click();
  await page.waitForTimeout(600);
  check("confirming removes exactly one step", (await rows()) === n0 - 1, `${n0} → ${await rows()}`);
  // Gone for good: a reload re-reads the stored project.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.waitForSelector(".vrow", { timeout: 20_000 });
  check("the removal survives a reload", (await rows()) === n0 - 1, `${await rows()} rows`);
  // The step you're ON can never be removed — there would be nothing on screen.
  check("the current step offers no remove control",
    (await page.locator(".vrow-wrap:has(.vrow.current) .vdel").count()) === 0);
  await page.close();
}

// ------------------------------- 13. the bed does not move when the part changes ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
  await page.addInitScript(() => { localStorage.setItem("moldable_signin_prompted", "1"); localStorage.setItem("moldable_theme", "dark"); });
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
  await awaitBuild(page);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await page.waitForSelector(".prow", { timeout: 20_000 });

  const cv = page.locator("canvas").first();
  const grab = async () => PNG.sync.read(await cv.screenshot());
  /** How much a strip of the canvas changed. The strip is BELOW the part and above the
   *  canvas edge, so in both frames it is bare bed — grid lines and nothing else. If the
   *  bed is where a bed belongs, those pixels are identical no matter what the part does.
   *
   *  Deliberately not a colour threshold: the slab, the void and the backdrop are all
   *  dark neutrals within a few counts of each other, and three attempts to separate
   *  them by colour ended up measuring the canvas edge instead of the bed. */
  const stripDiff = (a, b) => {
    // Measured band. A row-by-row diff of this exact scene showed the part occupying
    // roughly 30-66% of the canvas height and the dimension label — a sprite drawn INTO
    // the canvas, whose text changes with the size — living below 85%. Between them,
    // 68-83% is bed and nothing else.
    const y0 = Math.round(a.height * 0.68), y1 = Math.round(a.height * 0.83);
    let n = 0, tot = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < a.width; x++) {
        const i = (a.width * y + x) << 2;
        const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        tot++;
        if (d > 12) n++;
      }
    }
    return { pct: +(100 * n / tot).toFixed(2), tot };
  };

  const before = await grab();
  const row = page.locator(".prow").filter({ has: page.locator(".pn-human", { hasText: /^Inner width$/ }) }).first();
  await row.locator(".pf-input").click();
  await row.locator(".pf-input").fill("95");
  await row.locator(".pf-input").press("Enter");
  await awaitBuild(page);
  await page.waitForTimeout(1800);
  const after = await grab();
  const dims = await page.locator(".statusbar .dims").innerText();
  const d = stripDiff(before, after);
  check("widening the part actually rebuilt it", /210/.test(dims), dims);
  // Calibrated, not guessed: measured 1.5% with the bed pinned and 5.13% with the old
  // follow-the-model behaviour, on this exact scene. The 1.5% floor is the part's contact
  // shadow spreading as it grows, which is real and should change. 3% sits between them.
  // `tot` is asserted too — a strip that sampled nothing would score 0% and pass.
  check("the build plate stays where the printer's bed is",
    d.pct < 3 && d.tot > 50_000, `${d.pct}% of the bare-bed strip changed (${d.tot}px sampled)`);
  await page.close();
}

// ------------------------------------- 11/12. the two things only code can be asked ----
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
  await seed(page);
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea, .topbar", { timeout: 60_000 });

  // 11: the header of printtime.ts states three checked figures. Pin them, with the input
  // stated, so changing the arithmetic has to face them instead of quietly drifting.
  const t = await page.evaluate(async () => {
    const m = await import("/src/print/printtime.ts");
    // A 3DBenchy: ~9.5 cm³ of extruded plastic, 48 mm tall, 0.2 mm layers, 0.4 nozzle.
    const at = (id) => Math.round(m.estimatePrintTime(9500, 48, m.speedClassById(id), 0.2, 0.4).minutes);
    return { fast: at("fast"), standard: at("standard"), slow: at("slow"), fmt: m.fmtDuration(59.6) };
  });
  check("print-time estimate matches the figures its header claims",
    Math.abs(t.fast - 22) <= 3 && Math.abs(t.standard - 40) <= 4 && Math.abs(t.slow - 95) <= 8,
    JSON.stringify(t));
  // 59.6 minutes must read "1 h", not "60 m" — rounding has to happen before the wording.
  check("a duration just under the hour rounds up to hours", t.fmt === "1 h", t.fmt);

  // 12: the reason Project.dropped exists. A reload re-reads IndexedDB and never touches
  // the merge, so "the removal survives a reload" would pass with the tombstone filter
  // deleted. This drives mergeProjects directly — the path a second tab and the sync
  // cycle both take — and is the check that actually fails without it.
  const merged = await page.evaluate(async () => {
    const V = await import("/src/store/versions.ts");
    const M = await import("/src/store/merge.ts");
    const mk = (id, at) => ({ id, createdAt: at, summary: `step ${id}`, engine: "replicad", code: "x" });
    const base = {
      id: "p1", name: "t", createdAt: 1, updatedAt: 10, engine: "replicad",
      versions: [mk("a", 1), mk("b", 2), mk("c", 3)], headId: "c",
    };
    // One device removes step "b"; the other still has it and knows nothing about that.
    const mine = V.deleteVersion(base, "b");
    const theirs = { ...base, updatedAt: 20 };
    const out = M.mergeProjects(mine, theirs);
    const back = M.mergeProjects(theirs, mine); // and the other way round
    return {
      ids: out.versions.map((v) => v.id),
      idsReversed: back.versions.map((v) => v.id),
      tomb: out.dropped ?? [],
      head: out.headId,
    };
  });
  check("a removed step is not handed back by a merge",
    !merged.ids.includes("b") && !merged.idsReversed.includes("b"), JSON.stringify(merged));
  check("the merge carries the tombstone on, so the next device honours it too",
    merged.tomb.includes("b"), JSON.stringify(merged.tomb));
  check("the merge keeps everything that was not removed",
    merged.ids.join() === "a,c" && merged.head === "c", JSON.stringify(merged));
  await page.close();
}

await browser.close();
console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
process.exit(fails.length ? 1 : 0);
