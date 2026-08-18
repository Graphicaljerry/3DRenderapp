// Expanding a chat photo has to show the PHOTO, not an enlarged thumbnail.
//
// The transcript deliberately keeps only 420px thumbnails (chatThumb) — that is what
// stops a multi-megabyte camera roll from ending up in the chat JSON and the sync row.
// The lightbox then stretched one of those to 1100px, a 2.6x upscale, so "click to
// enlarge" produced something visibly softer than the picture the user had uploaded
// seconds earlier. The full-resolution copy is now kept beside the transcript as a blob.
//
// Two assertions carry this probe, and the second is the one that discriminates:
//   * the expanded picture's naturalWidth is the UPLOAD's, not the thumbnail's;
//   * it is still the upload's after a reload, which only the on-disk copy can do —
//     the in-memory map that Retry uses dies with the tab.
// The two photos are deliberately different sizes: the viewer is asked for picture N of
// message M, so a mixed-up index shows the wrong photo at a plausible-looking size.
import { chromium } from "playwright";

await fetch("http://localhost:8899/_reset");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

const shoot = async (w, h, a, b) => Buffer.from(await page.evaluate(([w, h, a, b]) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.fillStyle = a; x.fillRect(0, 0, w, h);
  x.fillStyle = b; x.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
  return c.toDataURL("image/png").split(",")[1];
}, [w, h, a, b]), "base64");

await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

const FRONT = await shoot(1400, 1050, "#2f5d8a", "#e8c07d"); // landscape
const REF = await shoot(900, 1200, "#7a3b3b", "#cfe8a0");    // portrait, different both ways

// Plan off — a plan card would sit between the send and the built model for no reason.
const chip = page.locator(".lo-trigger");
if (/plan first/i.test(await chip.innerText())) {
  await chip.click();
  await page.locator(".pmenu-item", { hasText: /no plan/i }).first().click();
  await page.keyboard.press("Escape");
}

await page.locator(".launch-composer input[type=file]").first().setInputFiles([
  { name: "front.png", mimeType: "image/png", buffer: FRONT },
  { name: "ref.png", mimeType: "image/png", buffer: REF },
]);
await page.waitForSelector(".photostrip", { timeout: 20_000 });
await page.waitForTimeout(900); // downscaleImage is async
await page.locator(".launch-composer textarea").fill("A bracket like the one in these photos");
await page.locator(".launch-composer .send").click();
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
await page.waitForTimeout(1500);

// ---- the transcript keeps thumbnails, as designed ----
const thumbs = await page.evaluate(() => [...document.querySelectorAll(".msg.user img")].map((i) => i.naturalWidth));
check("both photos are in the transcript", thumbs.length === 2, JSON.stringify(thumbs));
check("the transcript still carries thumbnails, not originals", thumbs.every((w) => w > 0 && w <= 420), JSON.stringify(thumbs));

/** Open picture `sel`, wait for the viewer to resolve it, and report what it shows. */
async function expand(sel) {
  await page.locator(sel).first().click();
  await page.waitForSelector(".img-lightbox .lb-img", { timeout: 10_000 });
  // The HD copy is fetched and decoded after the thumbnail paints; give it a moment
  // rather than racing it, and report whatever is on screen when the wait ends.
  await page.waitForFunction(() => (document.querySelector(".lb-img")?.naturalWidth ?? 0) > 420, null, { timeout: 10_000 }).catch(() => {});
  return page.evaluate(() => {
    const img = document.querySelector(".lb-img");
    return {
      w: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0,
      shown: Math.round(img?.getBoundingClientRect().width ?? 0),
      note: document.querySelector(".lb-dim")?.textContent ?? "",
    };
  });
}
const close = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(250); };

// ---- A) the front photo expands to the photo that was uploaded ----
const front = await expand(".msg.user .bubble-img");
check("front photo expands at full resolution", front.w === 1400 && front.h === 1050, JSON.stringify(front));
check("the viewer reports the real pixel size", /1400\s*×\s*1050/.test(front.note), front.note);
check("expanded is materially bigger than the thumbnail", front.shown > 420, `${front.shown}px on screen`);

// Actual size: the picture renders at its own width, in a box you can drag.
await page.locator(".lb-bar button", { hasText: /actual size/i }).click();
await page.waitForTimeout(300);
const actual = await page.evaluate(() => {
  const img = document.querySelector(".lb-img");
  const stage = document.querySelector(".lb-stage");
  return { shown: Math.round(img.getBoundingClientRect().width), scrollable: stage.scrollWidth > stage.clientWidth + 2 };
});
check("actual size renders 1:1", actual.shown === 1400, JSON.stringify(actual));
check("…inside a pannable window", actual.scrollable, JSON.stringify(actual));
await page.screenshot({ path: "shot-hd-photo.png" });
await close();

// ---- B) the reference photo is the REFERENCE photo (index alignment) ----
const ref = await expand(".msg.user .ref-strip img");
check("reference photo expands to its own original", ref.w === 900 && ref.h === 1200, JSON.stringify(ref));
await close();

// ---- C) it survives a reload — the on-disk copy, not the session map ----
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".msg.user img", { timeout: 60_000 });
await page.waitForTimeout(2500);
const reopened = await expand(".msg.user .bubble-img");
check("still HD after a reload", reopened.w === 1400 && reopened.h === 1050, JSON.stringify(reopened));
const reopenedRef = await (async () => { await close(); return expand(".msg.user .ref-strip img"); })();
check("…and so is the reference photo", reopenedRef.w === 900 && reopenedRef.h === 1200, JSON.stringify(reopenedRef));
await close();

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll HD-photo checks passed.");
