// Measure v2 + composer e2e, on the phone stand template from Top view:
// 1. Composer textarea wraps/grows; Shift+Enter = newline.
// 2. Hole tool drills an EXACT ⌀7 through-hole (deterministic, no AI).
// 3. Drag-a-line measure with vertex snap reads that hole as 7 mm.
// 4. Classic two-click measure still works.
// 5. Measurement labels stay small when zoomed way in (max-px clamp).
import { chromium } from "playwright";
import { enterWorkspace, pickFace, modelPoints } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };
// The sign-in modal opens the first time the composer takes focus, and its backdrop then
// swallows every click that follows — including the ones this probe makes on the canvas.
await page.addInitScript(() => { localStorage.setItem("moldable_signin_prompted", "1"); });
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle(/^Build the phone stand\b/).click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.toLowerCase().includes("phone stand"), null, { timeout: 120_000 });
await page.waitForTimeout(800);

// ---- 1) Composer wraps: long text grows the box; Shift+Enter adds a line. ----
const ta = page.locator(".composer textarea");
const h0 = await ta.evaluate((el) => el.clientHeight);
await ta.fill("make the rim a little taller and rounder, add a drainage channel around the inside edge, and emboss my initials JR on the bottom face so they show when it is flipped over");
await page.waitForTimeout(150);
const h1 = await ta.evaluate((el) => el.clientHeight);
check("composer grows to show long text", h1 > h0 + 14, `${h0}px → ${h1}px`);
await ta.press("Shift+Enter");
await ta.type("second line");
const val = await ta.inputValue();
check("Shift+Enter inserts a newline", val.includes("\n"));
const h2 = await ta.evaluate((el) => el.clientHeight);
check("wrapped text is fully visible (no overflow)", await ta.evaluate((el) => el.scrollHeight <= el.clientHeight + 2) || h2 >= 130, `client ${h2}`);
await ta.fill("");
await page.waitForTimeout(120);
check("composer shrinks back when cleared", (await ta.evaluate((el) => el.clientHeight)) <= h0 + 2);

// ---- 2) Top view, drill an exact ⌀7 hole in the middle of the phone stand. ----
const canvas = page.locator(".viewerCanvas canvas");
const box = await canvas.boundingBox();
await page.getByRole("button", { name: "Top", exact: true }).click();
await page.waitForTimeout(600);
// Arm a face that squarely faces the Top camera — and then work on THAT face.
//
// Two assumptions were quietly load-bearing here and both were wrong. pickFace stops at
// the first face that offers Hole…, which on the phone stand can be the leaning support;
// and the hole tool only accepts a placement click that lands on the ARMED face's own
// plane (Viewer.tsx holeHover: the hit must be co-facing within 0.98 and within 0.8 mm of
// the anchor plane). So a click at the canvas CENTRE had nothing to do with the armed
// face, both calibration clicks were silently rejected, and the readback moved 0 mm for
// 60 px — which then made pxPerMm Infinity and killed the run in mouse.move.
//
// The panel names its own two editable axes, so "is this face Z-facing" is answerable from
// the DOM: holeAxes returns [X, Y] only when the normal's Z dominates. Keep hunting until
// it does.
const holeItem = page.locator(".sel-acts button", { hasText: /^Hole…$/ });
const pickedTop = await pickFace(page, {
  until: async () => {
    if (!(await holeItem.count())) return false;
    await holeItem.first().click();
    await page.waitForSelector(".hole-panel", { timeout: 5_000 });
    const ax = (await page.locator(".hole-panel .hp-axis b").allInnerTexts()).join("");
    if (ax === "XY") return true;
    await page.locator(".hole-panel .x").click(); // wrong face — put it back and keep looking
    await page.waitForTimeout(120);
    return false;
  },
});
check("flat top (Z-facing) face offers Hole…", pickedTop);
await page.locator(".hole-panel").getByLabel("Hole diameter (mm)").fill("7");

// Calibrate px/mm from two placements the app ACTUALLY accepted, on the armed face, using
// the real pixel distance between them — not from an assumed 60 px that may never have
// landed anywhere.
const posInputs = page.locator(".hole-panel .hp-axis input");
const vals = async () => [Number(await posInputs.nth(0).inputValue()), Number(await posInputs.nth(1).inputValue())];
const placed = [];
let prev = await vals();
for (const [gx, gy] of await modelPoints(page)) {
  if (placed.length >= 12) break;
  await page.mouse.click(gx, gy);
  await page.waitForTimeout(180);
  const now = await vals();
  if (JSON.stringify(now) === JSON.stringify(prev)) continue; // off the armed plane, or the same snapped mm
  prev = now;
  placed.push({ at: [gx, gy], mm: now });
}
// Drill in the MIDDLE of the accepted region, not at the first point that happened to
// work. The first accepted placement sat at x=7 mm on a face that starts at x≈6, so the
// drag in step 3 began 4 mm to its left — off the part — and no measurement was created
// at all. The centroid of the accepted placements is interior by construction.
const mid = placed.length
  ? [placed.reduce((a, p) => a + p.at[0], 0) / placed.length, placed.reduce((a, p) => a + p.at[1], 0) / placed.length]
  : null;
const near = (t) => placed.slice().sort((a, b) => Math.hypot(a.at[0] - t[0], a.at[1] - t[1]) - Math.hypot(b.at[0] - t[0], b.at[1] - t[1]))[0];
const A = mid ? near(mid) : null;
// The far end of the same face gives the longest baseline, so the ratio carries the least
// rounding from the 1 mm magnet.
const B = A ? placed.slice().sort((a, b) => Math.hypot(b.at[0] - A.at[0], b.at[1] - A.at[1]) - Math.hypot(a.at[0] - A.at[0], a.at[1] - A.at[1]))[0] : null;
const ptA = A?.at, ptB = B?.at;
const dPx = A && B ? Math.hypot(ptB[0] - ptA[0], ptB[1] - ptA[1]) : 0;
const dMm = A && B ? Math.hypot(B.mm[0] - A.mm[0], B.mm[1] - A.mm[1]) : 0;
check("hover-place calibration click moved the hole", dMm > 2,
  placed.length ? `${dMm.toFixed(2)} mm for ${Math.round(dPx)} px over ${placed.length} accepted placements`
    : "no placement on the armed face was accepted at all");
const pxPerMm = dPx / dMm;
if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) {
  // Everything below is measured in these units. Without the guard the run died inside
  // mouse.move with "Invalid parameters" — a protocol error standing in for a failed check.
  console.log("\nFAILED: calibration produced no usable px/mm — the checks below cannot run");
  await browser.close();
  process.exit(1);
}
// Put the draft back on the first accepted point and drill there; everything downstream
// measures at that spot, so it has to be a place the app agreed to.
const px = ptA[0] - box.x, py = ptA[1] - box.y;
await page.mouse.click(ptA[0], ptA[1]);
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Drill hole", exact: true }).click();
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Drilled a/.test(b.textContent ?? "")), null, { timeout: 120_000 });
await page.waitForTimeout(400);

// ---- 3) Drag-a-line measure across the hole → snapped ends read exactly 7 mm. ----
await page.getByRole("button", { name: "Measure", exact: true }).click();
const rPx = 3.5 * pxPerMm;
// Both ends of the tape have to land ON the mesh: the drag only arms on a press that hits
// the model, and it only records an end while the pointer is over it. The seat this hole
// sits in has a slot cut through it, so a line through the hole centre can leave the
// material on one side. Ask the viewer's own raycaster which candidate line works instead
// of assuming the first one does.
const onMesh = (x, y) => page.evaluate(async ([x, y]) => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const s = window.__viewerS?.();
  if (!s?.mesh) return false;
  const r = s.renderer.domElement.getBoundingClientRect();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), s.camera);
  return rc.intersectObject(s.mesh, false).length > 0;
}, [x, y]);
// Vertical candidates first. From Top the seat is ~70 mm along screen Y and only ~15 mm
// across screen X, so a horizontal tape has barely a millimetre of material past the rim
// on each side — and none at all once the hole sits near the slot. Along Y there is room.
const reach = rPx + 1;
const cands = [];
for (const off of [0, -6, 6, -12, 12]) {
  cands.push([[box.x + px + off, box.y + py - reach], [box.x + px + off, box.y + py + reach]]);
  cands.push([[box.x + px - reach, box.y + py + off], [box.x + px + reach, box.y + py + off]]);
}
let from = null, to = null;
for (const [a, b] of cands) {
  if ((await onMesh(a[0], a[1])) && (await onMesh(b[0], b[1]))) { from = a; to = b; break; }
}
check("a tape line across the hole has material at both ends", !!from,
  from ? `${Math.round(from[0])},${Math.round(from[1])} → ${Math.round(to[0])},${Math.round(to[1])}` : `nothing usable around ${Math.round(px)},${Math.round(py)}`);
if (from) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] + (to[0] - from[0]) * 0.3, from[1] + (to[1] - from[1]) * 0.3, { steps: 2 });
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
}
await page.waitForTimeout(350);
// A finished drag is a PENDING measurement now, not a saved one: it posts a .measure-confirm
// bar carrying the distance and Save / Discard, and only Save puts it in measureCtl.items.
// This probe was written before that lifecycle existed, so it went straight to the Objects
// panel, found no row, and reported "drag created a measurement" as false — while the
// measurement was on the canvas the whole time, waiting to be kept.
const confirmBar = page.locator(".measure-confirm");
const dragMade = await confirmBar.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
check("drag created a measurement", dragMade);
const reading = dragMade ? await confirmBar.locator(".mc-dist").innerText() : "";
const mmVal = parseFloat(reading);
check("snapped drag across the ⌀7 hole reads 7 mm", Math.abs(mmVal - 7) <= 0.15, `read "${reading}" (px/mm ${Math.round(pxPerMm * 100) / 100})`);
await confirmBar.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForSelector(".layers-panel");
const measRows = () => page.locator(".layers-panel .lp-row").filter({ hasText: /Measure \d/ });
check("Save keeps it in the Objects list", (await measRows().count()) === 1);

// ---- 4) Classic two-click measure still works alongside. ----
// Close the Objects panel first — it overlays the canvas, so the two clicks below would
// land on the panel instead of the model.
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForTimeout(200);
// Two points the viewer confirms are on the mesh. Fixed ±90 px offsets in screen X ran
// off the seat, which from Top is only ~15 mm wide — the clicks landed on the build plate
// and no measurement was ever started.
let c1 = null, c2 = null;
for (const d of [40, 60, 80, 30]) {
  const a = [ptA[0], ptA[1] - d], b = [ptA[0], ptA[1] + d];
  if ((await onMesh(a[0], a[1])) && (await onMesh(b[0], b[1]))) { c1 = a; c2 = b; break; }
}
if (c1) {
  await page.mouse.click(c1[0], c1[1]);
  await page.waitForTimeout(300);
  await page.mouse.click(c2[0], c2[1]);
  await page.waitForTimeout(400);
}
const clickMade = await confirmBar.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
check("two-click measure still records", !!c1 && clickMade,
  clickMade ? await confirmBar.locator(".mc-dist").innerText() : "no pending measurement after two clicks");
if (clickMade) await confirmBar.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForSelector(".layers-panel");
check("both measurements are listed", (await measRows().count()) === 2, `${await measRows().count()} row(s)`);

// ---- 5) Zoom way in: the measure label pill stays small (max-px clamp). ----
await page.getByRole("button", { name: "Objects", exact: true }).click(); // close panel — it overlays the canvas
for (let i = 0; i < 8; i++) await page.locator(".zoom-ctl button").first().click();
await page.waitForTimeout(500);
// The clamp is arithmetic, so measure the arithmetic. Counting teal pixels in a fixed
// 110 px strip of a screenshot was reading whatever happened to sit at an x taken BEFORE
// eight zoom steps — an empty strip measured 0 px ("the clamp failed"), and a strip that
// drifted over the tool rail measured 418. The render loop sets each label's world height
// to `min(30, max(min, baseH / worldPerPx)) * worldPerPx`, so dividing the sprite's own
// scale back by worldPerPx gives the on-screen height in pixels, exactly.
const labelPx = await page.evaluate(() => {
  const s = window.__viewerS?.();
  if (!s) return null;
  const vpH = s.renderer.domElement.clientHeight;
  const tan = Math.tan((s.camera.fov * Math.PI) / 180 / 2);
  const out = [];
  for (const o of s.measures?.children ?? []) {
    if (!o.isSprite || !o.userData?.dimLabel) continue;
    const worldPerPx = (2 * s.camera.position.distanceTo(o.position) * tan) / vpH;
    out.push(Math.round(o.scale.y / worldPerPx));
  }
  return out;
});
check("label pill stays clamped when zoomed in",
  !!labelPx && labelPx.length > 0 && labelPx.every((h) => h > 4 && h <= 31),
  `label heights ${JSON.stringify(labelPx)} px (clamp is 30)`);
await page.screenshot({ path: "shot-measure2.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll measure/composer checks passed.");
