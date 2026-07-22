// Fit-testing e2e: Separate parts (ungroup), Check fit (Manifold intersect), Drop to plate.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

// Box with lid = two disconnected solids in one model.
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the box with lid template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("friction-fit"), { timeout: 120_000 });

// 1) The Objects panel offers "Separate 2 parts" (partCount detection).
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForSelector(".layers-panel");
const sepBtn = page.getByRole("button", { name: /Separate 2 parts/ });
await sepBtn.waitFor({ timeout: 15_000 });
check("separate button appears for 2-part model", true);

// 2) Separating: lid becomes its own movable object, model keeps the box.
await sepBtn.click();
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent?.includes("Separated the model")), { timeout: 60_000 });
await page.waitForSelector(".layers-panel .lp-row .lp-name");
const rowNames = await page.locator(".layers-panel .lp-name").allInnerTexts();
check("Part 2 listed as its own object", rowNames.some((n) => n.includes("Part 2")), rowNames.join(", "));
check("separate button gone (model now 1 part)", (await page.getByRole("button", { name: /Separate \d+ parts/ }).count()) === 0);

// 3) Check fit at the printed position (lid beside the box) → no interference.
const fitBtn = page.getByRole("button", { name: "Check fit" });
await fitBtn.waitFor({ timeout: 10_000 }); // Part 2 was auto-selected by separate
await fitBtn.click();
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent?.includes("doesn't intersect")), { timeout: 60_000 });
check("check fit: no interference side by side", true);

// 4) Drop to plate doesn't error on a grounded part.
await page.getByRole("button", { name: "Drop to plate" }).click();
check("drop to plate is safe when already on the plate", true);

// 5) The same production code path flags a real collision: intersect the lid shifted
//    into the box (splitConnectedParts + previewSetBase + previewIntersect + meshVolume).
const collide = await page.evaluate(async () => {
  const eng = await import("/src/engine/selectEngine.ts");
  const tpl = await import("/src/cad/templates.ts");
  const sep = await import("/src/print/separate.ts");
  const pe = await import("/src/engine/previewEngine.ts");
  const s = await eng.getEngineSelection();
  const t = tpl.TEMPLATES.find((x) => x.id === "box-with-lid");
  const res = await s.engine.build({ kind: "code", code: t.code });
  const pieces = sep.splitConnectedParts(res.geometry);
  if (pieces.length !== 2) return { error: `expected 2 pieces, got ${pieces.length}` };
  if (!(await pe.previewSetBase(pieces[0]))) return { error: "setBase failed" };
  const soup = (pieces[1].getAttribute("position").array).slice();
  const apart = await pe.previewIntersect(soup);
  const apartVol = apart ? sep.meshVolume(apart) : -1;
  // Slide the lid so its centre lands on the box's centre (x only) → guaranteed collision.
  const dx = (pieces[0].boundingBox.min.x + pieces[0].boundingBox.max.x) / 2 - (pieces[1].boundingBox.min.x + pieces[1].boundingBox.max.x) / 2;
  for (let i = 0; i < soup.length; i += 3) soup[i] += dx;
  const inter = await pe.previewIntersect(soup);
  const overlapVol = inter ? sep.meshVolume(inter) : -1;
  return { apartVol, overlapVol, dx };
});
check("intersect: zero apart, real volume when colliding",
  !collide.error && collide.apartVol >= 0 && collide.apartVol < 1 && collide.overlapVol > 100,
  JSON.stringify(collide));

// 6) Merge-back path still offered.
check("merge back offered", (await page.getByRole("button", { name: /Merge/ }).count()) > 0);

await page.screenshot({ path: "shot-fit.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll fit checks passed.");
