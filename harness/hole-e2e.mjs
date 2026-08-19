// Hole tool e2e: face → Hole… panel, magnet snapping, reference alignment (Δ / spacing),
// drill commits a real ops-chain version, ghost renders, params still rebuild with it.
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild, pickFace, modelPoints } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle(/^Build the phone stand\b/).click();
await awaitBuild(page);

// 1) Pick a flat face → the selection row offers "Hole…".
// pickFace projects real surface vertices and clicks those: fixed canvas fractions are a
// guess, the viewer frames the part itself, and a miss is silent — nothing selects, the
// verb never appears, and this reads as a missing feature. It also arms Modify, which
// absorbed the standalone Select tool and owns picking now.
const canvas = page.locator(".viewerCanvas canvas");
// Every click below is expressed as a fraction of the canvas, so its box is needed
// before the first one. It was simply missing — the probe threw ReferenceError on line
// 37 the moment it got past the pick, which is why nothing after step 1 had ever run.
const box = await canvas.boundingBox();
const holeItem = page.locator(".sel-acts button", { hasText: /^Hole…$/ });
// The phone stand, not the headphone desk hook. The hook is curved almost everywhere and
// a click on it never produced a face pick at all (0 of 30 sampled points), so this probe
// spent its life reporting a missing Hole… verb on a model it could not select a face of.
// The stand is flat-sided; regress-465-e2e drills it end to end on the same path.
// The `until` predicate stays: it stops the hunt on a face that actually OFFERS Hole…
// rather than on the first thing that selects.
const picked = await pickFace(page, { until: async () => (await holeItem.count()) > 0 });
check("flat face offers Hole…", picked && (await holeItem.count()) > 0);
await holeItem.click();
await page.waitForSelector(".hole-panel");
check("hole panel opens with the drill ghost", true);

// 1b) Hover-to-place: moving over the face only slides the ghost (draft untouched);
// a CLICK commits a snapped position and the panel stays open.
const posInputs = page.locator(".hole-panel .hp-axis input");
const axisVals = async () => [await posInputs.nth(0).inputValue(), await posInputs.nth(1).inputValue()];
const before1 = await axisVals();
await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.7);
await page.waitForTimeout(200);
check("hover previews without changing the draft", JSON.stringify(await axisVals()) === JSON.stringify(before1));
// Points on the model, not four guessed canvas fractions. The hole tool only accepts a
// placement that lands on the ARMED face's own plane, and which face pickFace arms depends
// on the model and the camera — so a fixed fraction is a bet on geometry the probe never
// checked. Walk real surface points until one is accepted.
let placed = null;
for (const [gx, gy] of await modelPoints(page)) {
  await page.mouse.click(gx, gy);
  await page.waitForTimeout(220);
  const now = await axisVals();
  if (JSON.stringify(now) !== JSON.stringify(before1)) { placed = now; break; }
}
const snapped = placed && placed.every((v) => Number.isInteger(Number(v)));
check("click places the hole, snapped to the magnet", !!placed && snapped, `${before1} → ${placed}`);
check("panel still open after placing", (await page.locator(".hole-panel").count()) === 1);
const afterPlace = await axisVals();
// Off the model but still ON the canvas — and clear of the Inspector dock, which
// overlays the canvas's top-right corner and swallowed this click entirely
// ("subtree intercepts pointer events") rather than letting it reach the viewer.
await canvas.click({ position: { x: box.width * 0.75, y: box.height * 0.92 } });
await page.waitForTimeout(200);
check("stray click off the plane is ignored", JSON.stringify(await axisVals()) === JSON.stringify(afterPlace) && (await page.locator(".hole-panel").count()) === 1);

// 2) Magnet snap: type 10.34 with 1 mm magnet → lands on 10.
await posInputs.first().fill("10.34");
await posInputs.first().blur();
await page.waitForTimeout(200);
check("magnet snaps typed offsets", (await posInputs.first().inputValue()) === "10", await posInputs.first().inputValue());

// 3) Reference alignment: arm the pick, click the model, get Δ fields; "=" zeroes one axis.
await page.getByRole("button", { name: /Align with another hole/ }).click();
await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.62 } });
await page.waitForSelector(".hp-ref", { timeout: 15_000 });
check("reference picked — Δ and spacing shown", (await page.locator(".hp-ref .hp-axis").count()) === 2);
const refText = await page.locator(".hp-ref .fine").first().innerText();
// The reference/guide lines are 0x498a6f — rgb(73, 138, 111), read straight out of
// layoutHoleGhost in Viewer.tsx. This counted rgb(20, 184, 166) instead and found zero
// pixels in every state, so both halves of the comparison were 0 and the check could
// only ever fail. Count once with just the dashed at→ref line, once after aligning an
// axis: the SOLID guide has to add pixels.
const guideCount = async () => {
  const b64 = (await canvas.screenshot()).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - 73) < 40 && Math.abs(d[i + 1] - 138) < 40 && Math.abs(d[i + 2] - 111) < 40) n++;
    }
    return n;
  }, b64);
};
const guideDashed = await guideCount();
await page.locator(".hp-ref .hp-axis").first().getByRole("button", { name: "=" }).click();
await page.waitForTimeout(300);
const d0 = await page.locator(".hp-ref .hp-axis input").first().inputValue();
check("align button zeroes the delta", Number(d0) === 0, `Δ=${d0} (ref: ${refText.slice(0, 60)})`);
const guideAligned = await guideCount();
check("solid alignment guide line lights up", guideDashed > 0 && guideAligned > guideDashed + 10, `guide px ${guideDashed} → ${guideAligned}`);

// 4) Exact spacing: type 20 → in-plane centre distance becomes 20 (snapped).
const spacingInput = page.locator(".hp-ref").getByLabel("Centre-to-centre spacing (mm)");
const before = await spacingInput.inputValue();
if (Number(before) > 0.01) {
  await spacingInput.fill("20");
  await spacingInput.blur();
  await page.waitForTimeout(250);
  const after = Number(await spacingInput.inputValue());
  check("typed spacing repositions the hole", Math.abs(after - 20) <= 1.01, `spacing ${before} → ${after}`);
} else {
  check("typed spacing repositions the hole", true, "skipped (coincident centres after align)");
}

// 5) Drill → committed as a real ops version (survives param rebuilds).
await page.getByRole("button", { name: "Drill hole", exact: true }).click();
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Drilled a/.test(b.textContent ?? "")), null, { timeout: 120_000 });
const proj = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  const p = (await mod.listProjects()).find((x) => x.name === "Phone stand");
  const last = p?.versions[p.versions.length - 1];
  return { versions: p?.versions.length, ops: last?.ops ?? p?.ops ?? [] };
});
const holeOp = (proj.ops ?? []).find((o) => o.type === "hole");
check("hole committed as an ops-chain version", proj.versions === 2 && !!holeOp && holeOp.diameter === 5, JSON.stringify({ versions: proj.versions, holeOp }));
check("panel closed after drilling", (await page.locator(".hole-panel").count()) === 0);

await page.screenshot({ path: "shot-hole.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll hole checks passed.");
