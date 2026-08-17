// Three defects an audit reproduced, and the proof they are gone.
//
// 1. REMOVING THE FRONT PHOTO DELETED ALL OF THEM. Every thumbnail in the strip has its
//    own ✕, but index 0's was wired to clearImage() — which revokes the front image, the
//    other attached photos, AND all three named view slots. On a strip of five, dropping
//    the blurry first one silently took the other four. That is the exact "clear the lot
//    and re-pick" cost the strip was built to end, still being charged to whoever's first
//    photo was the bad one.
//
// 2. A FAILED FIRST BUILD GREW THE PROJECT ON EVERY REOPEN. A build that fails saves a
//    shell project — chat, no code, no versions. Reopening it handed the kernel an empty
//    program, which threw, and the catch appended a fresh error turn. That turn is hidden
//    from the transcript (no `reply`) but NOT from the canvas banner, so the project put
//    on one invisible message per open, forever, and greeted the user with a kernel error
//    about code they never wrote. It also syncs, into the one row the cloud layer already
//    worries about timing out.
//
// 3. STOP DID NOTHING ONCE THE STREAM HAD RESOLVED. Aborting the fetch cannot touch the
//    kernel pass that follows, and that pass is the SLOW half of a real build. The button
//    stayed on screen, live, doing nothing, and the part was delivered and billed anyway.
//    The existing stop-e2e misses this: it stops during a deliberately hung stream, which
//    is the one window that always worked.
import { chromium } from "playwright";

const STUB = "http://localhost:8899";
await fetch(`${STUB}/_reset`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
const seed = (page) => page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
const planOff = async (page) => {
  const chip = page.locator(".lo-trigger");
  if (!/no plan/i.test(await chip.innerText())) {
    await chip.click();
    await page.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
    await page.keyboard.press("Escape");
  }
};

// ---- 1. the front photo's ✕ removes ONE photo ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await seed(page);
  await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  const P = [];
  for (const c of ["#0000ff", "#ff0000", "#00ff00", "#ffff00", "#ff00ff"]) {
    P.push(Buffer.from(await page.evaluate(async (col) => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 120;
      const x = cv.getContext("2d"); x.fillStyle = col; x.fillRect(0, 0, 120, 120);
      return cv.toDataURL("image/png").split(",")[1];
    }, c), "base64"));
  }
  await page.locator(".launch-composer input[type=file]").first()
    .setInputFiles(P.map((buf, i) => ({ name: `p${i}.png`, mimeType: "image/png", buffer: buf })));
  await page.waitForSelector(".photostrip", { timeout: 20_000 });
  await page.waitForTimeout(500);
  const before = await page.locator(".ps-thumbs .refthumb").count();
  check("five photos attached", before === 5, `${before}`);
  await page.locator(".ps-thumbs .refthumb").first().locator(".mv-x").click();
  await page.waitForTimeout(500);
  const after = await page.locator(".ps-thumbs .refthumb").count();
  check("removing the FRONT photo removes exactly one", after === 4, `5 -> ${after}`);
  // …and the one that was second is now leading.
  const frontTagged = await page.locator(".ps-thumbs .refthumb.ps-front").count();
  check("the next photo takes over as Front", frontTagged === 1, `${frontTagged} tagged`);
  // Removing the last remaining one clears the strip entirely.
  for (let i = 0; i < 4; i++) {
    await page.locator(".ps-thumbs .refthumb").first().locator(".mv-x").click();
    await page.waitForTimeout(250);
  }
  check("removing them one by one empties the strip", await page.locator(".photostrip").count() === 0);
  await page.close();
}

// ---- 2. a failed build's project does not grow on reopen ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await seed(page);
  await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  await planOff(page);
  await page.locator(".launch-composer textarea").fill("A SPECIFIC bracket, BADCODE please");
  await page.locator(".launch-composer .send").click();
  await page.waitForFunction(() => /BADCODE/i.test(document.body.innerText), null, { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 240_000 });
  await page.waitForTimeout(2500);

  const turns = () => page.evaluate(() => new Promise((res) => {
    const open = indexedDB.open("moldable", 1);
    open.onsuccess = () => {
      const req = open.result.transaction("projects", "readonly").objectStore("projects").getAll();
      req.onsuccess = () => {
        const p = req.result[0];
        const chat = p?.chat ?? [];
        res({ total: chat.length, hiddenErrors: chat.filter((t) => t.error && !t.reply).length });
      };
      req.onerror = () => res({ total: -1, hiddenErrors: -1 });
    };
    open.onerror = () => res({ total: -1, hiddenErrors: -1 });
  }));

  const t0 = await turns();
  for (let i = 0; i < 3; i++) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
  }
  const t1 = await turns();
  check("reopening a failed project does not add turns", t1.total === t0.total, `${t0.total} -> ${t1.total} after 3 reopens`);
  check("no hidden error turns accumulate", t1.hiddenErrors === 0, `${t1.hiddenErrors} hidden`);
  check("no stale kernel error on the canvas", !(await page.evaluate(() =>
    /must define|function main/i.test(document.querySelector(".canvas-toast")?.textContent ?? ""))));
  await page.close();
}

// ---- 3. Stop works during the KERNEL pass, not just the stream ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await seed(page);
  await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  await planOff(page);
  // "rounded holder" is a real OCCT fillet — the kernel pass is long enough to click in.
  await page.locator(".launch-composer textarea").fill("A SPECIFIC rounded holder");
  await page.locator(".launch-composer .send").click();
  // Click the INSTANT the kernel stage appears. Polling from the test runner and then
  // issuing a click is too slow — the stub answers immediately, so the kernel window is
  // the only real work in the build and a round trip through Playwright can miss it
  // entirely, which reads as "Stop was ignored" when Stop was never pressed.
  const clicked = await page.evaluate(() => new Promise((res) => {
    const t0 = Date.now();
    const tick = () => {
      const stage = document.body.innerText;
      const btn = document.querySelector(".composer .send.stop");
      if (btn && /CAD kernel/i.test(stage)) { btn.click(); return res("clicked during the kernel pass"); }
      if (Date.now() - t0 > 60000) return res("never saw the kernel stage with Stop live");
      requestAnimationFrame(tick);
    };
    tick();
  }));
  check("the probe actually pressed Stop mid-kernel", /clicked/.test(clicked), clicked);
  await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const said = await page.evaluate(() =>
    [...document.querySelectorAll(".msg.assistant")].map((e) => e.innerText).join(" | "));
  check("stopping during the kernel pass is acknowledged", /stopped/i.test(said), said.slice(-140).replace(/\n/g, " "));
  check("…and no part was delivered", await page.evaluate(() => !window.__viewerGeom?.()));
  await page.close();
}

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
