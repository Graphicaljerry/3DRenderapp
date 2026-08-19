// The strip has to say what each attached picture IS, not assume the first one is a front
// view of something.
//
// The bug: every first picture was tagged "Front" the moment it landed, whatever it was and
// whatever engine was going to read it. Attach a dimensioned drawing in CAD mode — where
// nothing downstream treats any picture as a viewpoint — and the app announced a fact
// nobody had stated.
//
// Three things have to hold, and the third is the one that discriminates. A label that
// merely swapped one guess for another would pass the first two:
//   * a drawing is tagged Sketch and a photograph is tagged Photo, from the pixels;
//   * no thumbnail claims a viewpoint, and the front view is named — once, in the foot
//     line — only when a mesh engine really is going to build from one;
//   * clicking a tag changes the app's mind, and that read reaches the request the model
//     actually receives, so it is a control rather than a caption.
import { chromium } from "playwright";
import { FIXTURES } from "./photokind-fixtures.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
await page.addScriptTag({ content: FIXTURES });

/** Paint one fixture and hand it back as a PNG the file input will take. */
const draw = async (name) => Buffer.from(await page.evaluate((name) => {
  const c = document.createElement("canvas");
  c.width = 760; c.height = 560;
  globalThis.FIXTURES[name](c.getContext("2d"), c.width, c.height);
  return c.toDataURL("image/png").split(",")[1];
}, name), "base64");

// A drawing first, a photograph second — so "the first one is special" and "the first one
// is a drawing" cannot be confused for each other. The third is a photograph that gets
// re-labelled by hand further down, which is what proves a correction is carried.
await page.locator(".launch-composer input[type=file]").first().setInputFiles([
  { name: "drawing.png", mimeType: "image/png", buffer: await draw("pen on white") },
  { name: "part.png", mimeType: "image/png", buffer: await draw("grey part on white paper") },
  { name: "shot.png", mimeType: "image/png", buffer: await draw("bright product shot") },
]);
await page.waitForSelector(".photostrip .ps-tag", { timeout: 20_000 });
// Every tag: the read is async (a decode plus a 96px draw) and lands a frame or two later.
await page.waitForFunction(() => document.querySelectorAll(".photostrip .ps-tag").length === 3, null, { timeout: 20_000 });

const tags = () => page.evaluate(() => [...document.querySelectorAll(".photostrip .ps-tag")].map((t) => t.textContent.trim()));
const foot = () => page.evaluate(() => document.querySelector(".photostrip .refstrip-count")?.textContent?.trim() ?? "");

const first = await tags();
check("the drawing is read as a drawing", first[0] === "Sketch", JSON.stringify(first));
check("the photographs are read as photographs", first[1] === "Photo" && first[2] === "Photo", JSON.stringify(first));
check("no thumbnail claims a viewpoint", !first.some((t) => /front/i.test(t)), JSON.stringify(first));

// ---- the viewpoint is named only where an engine uses one ----------------------------
const cadFoot = await foot();
check("no viewpoint is named before an engine is chosen", !/front view/i.test(cadFoot), cadFoot);

// Switch the engine to the mesh path through the composer's own control — the same three
// clicks a person makes. "Sculpted model" is what the menu calls it.
await page.locator(".launch-composer-foot .lo-trigger").click();
await page.locator(".lo-engines .pm-opt", { hasText: /sculpted/i }).click();
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const meshFoot = await foot();
check("the mesh path names the front view, in the foot line", /front view/i.test(meshFoot), meshFoot);
const meshTags = await tags();
check("and still does not stamp it on a thumbnail", !meshTags.some((t) => /front/i.test(t)), JSON.stringify(meshTags));

// ---- the tag is a control, not a caption ---------------------------------------------
await page.locator(".photostrip .ps-tag").first().click();
await page.waitForTimeout(200);
const flipped = await tags();
check("clicking a tag changes the app's mind", flipped[0] === "Photo", JSON.stringify(flipped));
await page.locator(".photostrip .ps-tag").first().click();
await page.waitForTimeout(200);
const back = await tags();
check("and clicking it again puts it back", back[0] === "Sketch", JSON.stringify(back));

// ---- the read has to reach the request, or the tag is decoration ----------------------
// Correct the third picture by hand, then send with nothing typed so the app supplies its
// own words. The strip is now [Sketch (read), Photo (read), Sketch (said)], so ONE request
// carries all three answers: the leading drawing drives the instruction, the photograph is
// introduced as a photograph, and the corrected one is introduced as a drawing.
await page.locator(".photostrip .ps-tag").nth(2).click();
await page.waitForFunction(() => document.querySelectorAll(".photostrip .ps-tag")[2]?.textContent.trim() === "Sketch", null, { timeout: 5_000 });
const bodies = [];
await page.route("http://localhost:8899/**", async (route) => {
  const d = route.request().postData();
  if (d) bodies.push(d);
  await route.continue();
});
await page.locator(".launch-composer-foot .lo-trigger").click();
await page.locator(".lo-engines .pm-opt", { hasText: /functional/i }).click();
// Plan first would stop at a spec card and never reach the build call this reads.
const planItem = page.locator(".pmenu-item", { hasText: /plan first/i });
if (await planItem.count()) await planItem.click();
await page.keyboard.press("Escape");
await page.screenshot({ path: "shot-photolabel.png" });
await page.locator(".launch-composer .send").click();
await page.waitForFunction(() => !!document.querySelector(".msg"), null, { timeout: 30_000 });
// A photo with no words earns a Quick check card; skip it — the build call is what carries
// the reference lines, and answering questions is not what this probe is about.
const skip = page.locator("button", { hasText: /build what i asked for/i }).first();
await skip.waitFor({ timeout: 30_000 }).catch(() => {});
if (await skip.count()) await skip.click();
await page.waitForFunction(() => !document.querySelector(".gen-pill"), null, { timeout: 180_000 });
await page.waitForTimeout(1000);
const build = bodies.find((b) => /replicad/i.test(b) && !/Reply with JSON only/.test(b)) ?? "";
check("a build request went out", !!build, `${bodies.length} request(s) captured`);

/** The words of the NEWEST user turn. The rolling history rides in the same body, so a
 *  retry's body also contains the previous turn's reference lines — counting across the
 *  whole request would score those twice. */
const lastAsk = (body) => {
  const last = (JSON.parse(body).messages ?? []).filter((m) => m.role === "user").at(-1);
  const parts = Array.isArray(last?.content) ? last.content : [{ type: "text", text: String(last?.content ?? "") }];
  return parts.filter((c) => c.type === "text").map((c) => c.text).join("\n");
};
const ask = build ? lastAsk(build) : "";
const count = (re, hay) => (hay.match(re) ?? []).length;
check("the drawing drives the instruction", /dimensions written on it exactly/.test(ask));
check("the photograph beside it is still introduced as a photograph",
  count(/Additional reference photo of the same object/g, ask) === 1,
  `${count(/Additional reference photo of the same object/g, ask)} photo line(s)`);
check("and the corrected one is introduced as a drawing",
  count(/Additional DRAWING/g, ask) === 1, `${count(/Additional DRAWING/g, ask)} drawing line(s)`);

// ---- a correction has to survive Retry ------------------------------------------------
// Retry restores the message's attachments from blobs alone, so a hand-set label is the
// one thing that could quietly revert to whatever the pixels say. Same provider: switching
// rows would send the retry somewhere with no key, which fails for unrelated reasons.
const before = bodies.length;
await page.locator(".msg.user .msg-actions").first().scrollIntoViewIfNeeded();
await page.locator(".msg.user").first().hover();
await page.locator(".msg.user .mp-linktrigger").first().click();
await page.waitForSelector(".mp-menu .mp-item", { timeout: 10_000 });
await page.locator(".mp-item", { hasText: /custom|compatible/i }).first().click();
// Wait for the retry's OWN request, not for the absence of a spinner: the pill takes a
// moment to appear, so "no pill on screen" is true both before the retry starts and after
// it finishes, and on a loaded machine that read the first one and asserted on nothing.
for (const deadline = Date.now() + 60_000; bodies.length === before && Date.now() < deadline; ) {
  await page.waitForTimeout(200);
}
await page.waitForFunction(() => !document.querySelector(".gen-pill"), null, { timeout: 180_000 });
await page.waitForTimeout(1500);
const again = bodies.slice(before).find((b) => /replicad/i.test(b) && !/Reply with JSON only/.test(b)) ?? "";
check("the retry went out", !!again, `${bodies.length - before} request(s) since the retry`);
const retriedAsk = again ? lastAsk(again) : "";
check("the correction survived it", count(/Additional DRAWING/g, retriedAsk) === 1,
  `${count(/Additional DRAWING/g, retriedAsk)} drawing line(s) in the retried ask`);
check("and the photograph beside it was not swept up with it",
  count(/Additional reference photo of the same object/g, retriedAsk) === 1,
  `${count(/Additional reference photo of the same object/g, retriedAsk)} photo line(s) in the retried ask`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
