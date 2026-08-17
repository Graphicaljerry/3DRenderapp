// Retry and Edit must resend the PHOTOS, and the part must be deletable from the plate.
//
// Three things Jerry hit in one sitting, verified together because they share a session:
//
//  1. Opus 5 was missing from the model picker — the app's MODELS list was a release
//     behind, so the newest model simply wasn't offered.
//  2. Retry under a bubble resent the words alone. The composer is emptied on every
//     successful send and the transcript keeps only 420px thumbnails, so by the time the
//     Retry menu is on screen the real attachments are gone from both places: a build
//     made FROM a photo was silently retried as a text-only guess. The retried bubble
//     showing no pictures was the only clue, and it reads as a display bug.
//  3. Right-click on the part had no Delete. Attachments had one; the thing the project
//     is about did not, so the only way to clear the plate was to start a new project
//     and lose the conversation with it.
//
// Read the two #2 assertions together, and don't trust either alone. The payload check
// (the stub saw images) PASSED against the broken build — a canvas snapshot and a
// composer the send hadn't cleared yet both put pictures on the wire without the user's
// photo being among them. The bubble-thumbnail check is what actually discriminated,
// because the thumbnail and the payload are computed from the same `image` in the same
// breath: no thumbnail means the send had nothing staged, whatever else went out.
import { chromium } from "playwright";

const STUB = "http://localhost:8899";
const stats = () => fetch(`${STUB}/_stats`).then((r) => r.json());
await fetch(`${STUB}/_reset`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

// A real PNG, not a 1x1: chatThumb and downscaleImage both decode it, and a photo the
// size of a postage stamp would sail through a budget path that a real one wouldn't.
const PHOTO = Buffer.from(
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 640; c.height = 480;
    const x = c.getContext("2d");
    x.fillStyle = "#3a6ea5"; x.fillRect(0, 0, 640, 480);
    x.fillStyle = "#e8c07d"; x.fillRect(120, 90, 400, 300);
    return c.toDataURL("image/png").split(",")[1];
  }),
  "base64",
);

await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

// ---- 1. the model list ----
// Read from the running app, not the source: the picker is what Jerry looked at.
const claudeRows = await page.evaluate(async () => {
  const mod = await import("/src/llm/anthropic.ts");
  return mod.MODELS.map((m) => m.label);
});
check("the picker offers Claude Opus 5", claudeRows.some((l) => /opus 5/i.test(l)), claudeRows.join(" | "));

// Plan off — this probe is about the resend, not the plan card.
const planOff = async () => {
  const chip = page.locator(".lo-trigger");
  if (!/no plan/i.test(await chip.innerText())) {
    await chip.click();
    await page.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
    await page.keyboard.press("Escape");
  }
};
await planOff();

// ---- 2. a build FROM a photo ----
await page.locator(".launch-composer input[type=file]").first().setInputFiles({ name: "part.png", mimeType: "image/png", buffer: PHOTO });
await page.waitForTimeout(800); // downscaleImage is async; the chip appears when it lands
await page.locator(".launch-composer textarea").fill("A SPECIFIC bracket from this photo");
await page.locator(".launch-composer .send").click();
await page.waitForFunction(() => /SPECIFIC bracket/i.test(document.body.innerText), null, { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
await page.waitForTimeout(1200);

const afterFirst = await stats();
const firstBuild = afterFirst.filter((s) => s.images > 0).length;
check("the first send carried the photo to the model", firstBuild > 0,
  `${afterFirst.length} request(s), ${firstBuild} with images`);
check("the model actually built", await page.evaluate(() => !!window.__viewerGeom?.()));

const cursor = afterFirst.length;

// ---- the retry ----
// Stay on the SAME provider (the stub): switching to a Claude row would send the retry
// at api.anthropic.com with no key, which fails for a reason that has nothing to do
// with photos.
// The Retry control is a ModelMenu with label="Retry" — a .mp-linktrigger, and its
// options are .mp-item (the canvas context menu's .pmenu-item is a different widget).
await page.locator(".msg.user .msg-actions").first().scrollIntoViewIfNeeded();
await page.locator(".msg.user").first().hover();
await page.locator(".msg.user .mp-linktrigger").first().click();
await page.waitForSelector(".mp-menu .mp-item", { timeout: 10_000 });
const sameProvider = page.locator(".mp-item", { hasText: /custom|compatible/i }).first();
await sameProvider.click();

await page.waitForFunction((n) => document.querySelectorAll(".msg.user").length > n, 1, { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
await page.waitForTimeout(1200);

const afterRetry = (await stats()).slice(cursor);
const retryWithImgs = afterRetry.filter((s) => s.images > 0).length;
check("the retry sent the photo again, not just the words", retryWithImgs > 0,
  `${afterRetry.length} request(s) since the retry, ${retryWithImgs} with images`);

// And the transcript says so: a retried photo request that shows no photo reads as a
// dropped attachment even when the payload was right.
const userImgs = await page.evaluate(() =>
  [...document.querySelectorAll(".msg.user")].map((r) => ({
    text: r.innerText.replace(/\s+/g, " ").slice(0, 40),
    imgs: r.querySelectorAll("img").length,
  })));
check("the retried message shows its photo in the chat",
  userImgs.length > 1 && userImgs[userImgs.length - 1].imgs > 0,
  JSON.stringify(userImgs));

// ---- Edit resends them too ----
// Same bug, same fix, different button — and the one people reach for when the words
// were the problem and the photo never was.
const beforeEdit = (await stats()).length;
await page.locator(".msg.user").first().hover();
await page.locator(".msg.user .msg-act", { hasText: /^Edit$/ }).first().click();
const ta = page.locator(".bubble-edit textarea").first();
await ta.fill("A SPECIFIC bracket, EDITED, from this photo");
await ta.press("Enter");
await page.waitForFunction(() => /EDITED/i.test(document.body.innerText), null, { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
await page.waitForTimeout(1200);
const afterEdit = (await stats()).slice(beforeEdit);
check("an edited message resends the photo as well",
  afterEdit.some((s) => s.images > 0), `${afterEdit.length} request(s), ${afterEdit.filter((s) => s.images > 0).length} with images`);
check("the edited message shows its photo in the chat", await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".msg.user")];
  const last = rows[rows.length - 1];
  return /EDITED/i.test(last?.innerText ?? "") && last.querySelectorAll("img").length > 0;
}));

// ---- 3. delete the part off the plate ----
const canvas = page.locator(".viewer canvas, canvas").first();
const box = await canvas.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
await page.waitForSelector(".pmenu-item", { timeout: 10_000 });
const menuText = await page.locator(".pmenu-item").allInnerTexts();
check("right-clicking the part offers Delete", menuText.some((t) => /^delete/i.test(t.trim())),
  menuText.join(" | ").slice(0, 160));

await page.locator(".pmenu-item", { hasText: /^Delete/ }).first().click();
await page.waitForTimeout(1500);
check("the part leaves the plate", await page.evaluate(() => !window.__viewerGeom?.()));
// A delete that also wiped the conversation would be a new project by another name.
check("the chat survives the delete", await page.evaluate(() => /SPECIFIC bracket/i.test(document.body.innerText)));

const putBack = page.locator("button", { hasText: /put it back/i }).first();
check("the delete offers a way back", await putBack.count() > 0);
if (await putBack.count()) {
  await putBack.click();
  await page.waitForTimeout(1500);
  check("Put it back restores the part", await page.evaluate(() => !!window.__viewerGeom?.()));
}

check("no uncaught exception took the render down", pageErrors.length === 0, pageErrors.join(" | "));

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
