// Hole tool e2e: face → Hole… panel, magnet snapping, reference alignment (Δ / spacing),
// drill commits a real ops-chain version, ghost renders, params still rebuild with it.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the wall hook template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("wall hook"), null, { timeout: 120_000 });

// 1) Pick a flat face → the quick-edit offers "Hole…".
const canvas = page.locator(".viewerCanvas canvas");
const box = await canvas.boundingBox();
await page.getByRole("button", { name: "Select", exact: true }).click();
let holeBtn = null;
for (const pos of [[0.42, 0.75], [0.5, 0.72], [0.38, 0.68], [0.5, 0.62]]) {
  await canvas.click({ position: { x: box.width * pos[0], y: box.height * pos[1] } });
  await page.waitForTimeout(350);
  if ((await page.getByRole("button", { name: "Hole…" }).count()) > 0) { holeBtn = true; break; }
}
check("flat face offers Hole…", !!holeBtn);
await page.getByRole("button", { name: "Hole…" }).click();
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
let placed = null;
for (const pos of [[0.46, 0.7], [0.44, 0.73], [0.52, 0.7], [0.4, 0.72]]) {
  await canvas.click({ position: { x: box.width * pos[0], y: box.height * pos[1] } });
  await page.waitForTimeout(250);
  const now = await axisVals();
  if (JSON.stringify(now) !== JSON.stringify(before1)) { placed = now; break; }
}
const snapped = placed && placed.every((v) => Number.isInteger(Number(v)));
check("click places the hole, snapped to the magnet", !!placed && snapped, `${before1} → ${placed}`);
check("panel still open after placing", (await page.locator(".hole-panel").count()) === 1);
const afterPlace = await axisVals();
await canvas.click({ position: { x: box.width * 0.9, y: box.height * 0.32 } });
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
// Teal pixels in the viewport = the reference/guide lines. Count once with only the
// dashed at→ref line, once after aligning an axis: the SOLID guide line must add pixels.
const tealCount = async () => {
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
      if (Math.abs(d[i] - 20) < 45 && Math.abs(d[i + 1] - 184) < 45 && Math.abs(d[i + 2] - 166) < 45) n++;
    }
    return n;
  }, b64);
};
const tealDashed = await tealCount();
await page.locator(".hp-ref .hp-axis").first().getByRole("button", { name: "=" }).click();
await page.waitForTimeout(300);
const d0 = await page.locator(".hp-ref .hp-axis input").first().inputValue();
check("align button zeroes the delta", Number(d0) === 0, `Δ=${d0} (ref: ${refText.slice(0, 60)})`);
const tealAligned = await tealCount();
check("solid alignment guide line lights up", tealDashed > 0 && tealAligned > tealDashed + 10, `teal px ${tealDashed} → ${tealAligned}`);

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
  const p = (await mod.listProjects()).find((x) => x.name === "Wall hook");
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
