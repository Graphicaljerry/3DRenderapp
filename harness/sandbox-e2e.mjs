// Dry-fit sandbox e2e: undo-duplicate regression, Regroup, Make it fit (carve).
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
const lastMsg = () => page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].pop()?.textContent ?? "");

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the box with lid template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("friction-fit"), null, { timeout: 120_000 });
await page.getByRole("button", { name: "Objects", exact: true }).click();

// 1) THE reported bug: separate → Undo must regroup, not duplicate the lid.
await page.getByRole("button", { name: /Separate 2 parts/ }).click();
await page.waitForSelector(".layers-panel .lp-row .lp-name");
check("separated: Part 2 exists, button says Regroup",
  (await page.locator(".layers-panel .lp-name").allInnerTexts()).some((n) => n.includes("Part 2")) &&
  (await page.getByRole("button", { name: "Regroup parts" }).count()) === 1);
await page.getByRole("button", { name: "Undo", exact: true }).click();
await page.waitForTimeout(1200);
const namesAfterUndo = await page.locator(".layers-panel .lp-name").allInnerTexts();
const sepBack = await page.getByRole("button", { name: /Separate 2 parts/ }).count();
check("undo regroups: no Part 2 left, no duplicate, Separate offered again",
  !namesAfterUndo.some((n) => n.includes("Part 2")) && sepBack === 1, namesAfterUndo.join(", "));

// 2) Regroup button does the same.
await page.getByRole("button", { name: /Separate 2 parts/ }).click();
await page.waitForSelector(".layers-panel .lp-row .lp-name");
await page.getByRole("button", { name: "Regroup parts" }).click();
await page.waitForTimeout(800);
check("Regroup parts restores the fused model",
  !(await page.locator(".layers-panel .lp-name").allInnerTexts()).some((n) => n.includes("Part 2")) &&
  (await page.getByRole("button", { name: /Separate 2 parts/ }).count()) === 1);

// 3) Make it fit with no overlap → honest "nothing to carve" message.
await page.getByRole("button", { name: /Separate 2 parts/ }).click();
await page.getByRole("button", { name: "Make it fit" }).click();
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].pop()?.textContent?.includes("Nothing to carve"), null, { timeout: 60_000 });
check("make-it-fit refuses when nothing overlaps", true);

// 4) The carve math end-to-end (same production modules): place the lid's plug into the
//    box wall region, carve with clearance, then the RAW lid must no longer intersect.
const carve = await page.evaluate(async () => {
  const eng = await import("/src/engine/selectEngine.ts");
  const tpl = await import("/src/cad/templates.ts");
  const sep = await import("/src/print/separate.ts");
  const pe = await import("/src/engine/previewEngine.ts");
  const s = await eng.getEngineSelection();
  const t = tpl.TEMPLATES.find((x) => x.id === "box-with-lid");
  const res = await s.engine.build({ kind: "code", code: t.code });
  const pieces = sep.splitConnectedParts(res.geometry);
  const box = pieces[0], lid = pieces[1];
  // Center the lid over the box in x/y and sink it so the plug enters the box mouth.
  const c = (g, i) => (g.boundingBox.min.getComponent(i) + g.boundingBox.max.getComponent(i)) / 2;
  const soup = lid.getAttribute("position").array.slice();
  const dx = c(box, 0) - c(lid, 0), dy = c(box, 1) - c(lid, 1);
  const dz = box.boundingBox.max.z - lid.boundingBox.max.z; // lid top flush with box top → plug + plate inside the walls
  for (let i = 0; i < soup.length; i += 3) { soup[i] += dx; soup[i + 1] += dy; soup[i + 2] += dz; }
  if (!(await pe.previewSetBase(box))) return { error: "setBase failed" };
  const before = sep.meshVolume(await pe.previewIntersect(soup));
  const grown = await pe.growMesh(soup, 0.2);
  if (!grown) return { error: "grow failed" };
  const carved = await pe.previewBoolean(grown, -1); // the "Make it fit" cut
  if (!carved) return { error: "carve failed" };
  // Re-check the raw lid against the carved model.
  const g2 = { boundingBox: null };
  const THREE = await import("/@fs/home/user/3DRenderapp/moldable-lite/node_modules/three/build/three.module.js");
  const carvedGeom = new THREE.BufferGeometry();
  carvedGeom.setAttribute("position", new THREE.BufferAttribute(carved, 3));
  if (!(await pe.previewSetBase(carvedGeom))) return { error: "setBase(carved) failed" };
  const after = sep.meshVolume(await pe.previewIntersect(soup));
  return { before, after, boxVol: sep.meshVolume(box.getAttribute("position").array), carvedVol: sep.meshVolume(carved) };
});
check("carve removes the interference (before > 0, after ≈ 0, model lost material)",
  !carve.error && carve.before > 100 && carve.after < 1 && carve.carvedVol < carve.boxVol,
  JSON.stringify(carve));

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll sandbox checks passed.");
