// Drilling on a SLANTED face: every click along the face has to place the hole, not just
// the first one or two.
//
// holeHover composes the placed point as "the draft's anchor, with the two in-plane axes
// overwritten" (Viewer.tsx). On an axis-aligned face that is exactly right — the third
// coordinate is constant across the whole plane. On a TILTED face it is not: the third
// coordinate varies with position, so pinning it to the anchor's value pushes the placed
// point OFF the face by (distance moved x the tilt). That point becomes the new anchor,
// and holeHover rejects any hit more than 0.8 mm off the anchor plane — so after a step or
// two the tool stops responding to clicks at all, silently.
//
// The face is found by its own geometry rather than by a hard-coded spot: raycast the
// projected surface points and take one whose world normal is NOT axis-aligned.
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild, modelPoints } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => { localStorage.setItem("moldable_signin_prompted", "1"); });
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle(/^Build the phone stand\b/).click();
await awaitBuild(page);
await page.waitForTimeout(600);

/** What the viewer's own raycaster sees at a screen point: the world normal and the hit. */
const probeAt = (x, y) => page.evaluate(async ([x, y]) => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const s = window.__viewerS?.();
  if (!s?.mesh) return null;
  const r = s.renderer.domElement.getBoundingClientRect();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), s.camera);
  const h = rc.intersectObject(s.mesh, false).find((i) => i.face);
  if (!h) return null;
  const n = h.face.normal.clone().transformDirection(s.mesh.matrixWorld).normalize();
  return { n: n.toArray(), p: h.point.toArray() };
}, [x, y]);

const pts = await modelPoints(page);
const hits = [];
for (const [x, y] of pts) {
  const h = await probeAt(x, y);
  if (h) hits.push({ at: [x, y], ...h });
}
const tilt = (n) => Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]));
const slanted = hits.filter((h) => tilt(h.n) < 0.98);
check("the phone stand has a slanted face on screen", slanted.length > 0,
  `${slanted.length} of ${hits.length} sampled points are on a non-axis-aligned face`);
if (!slanted.length) { await browser.close(); process.exit(1); }

// Arm the tool on that face. Modify owns picking; step off the rail so its flyout can't
// intercept the click that follows.
await page.locator(".canvas-rail").getByRole("button", { name: "Modify" }).click();
await page.mouse.move(1200, 880);
await page.waitForTimeout(400);
const holeItem = page.locator(".sel-acts button", { hasText: /^Hole…$/ });
let armed = null;
for (const c of slanted) {
  await page.mouse.click(c.at[0], c.at[1]);
  await page.waitForTimeout(140);
  if (await holeItem.count()) { armed = c; break; }
}
check("a slanted face offers Hole…", !!armed, armed ? `normal ${armed.n.map((v) => Math.round(v * 100) / 100).join(",")}` : "no slanted face picked");
if (!armed) { await browser.close(); process.exit(1); }
await holeItem.first().click();
await page.waitForSelector(".hole-panel");

// Walk ALONG that face: points whose normal matches the armed one, spaced far enough apart
// that each is a real move rather than a re-snap to the same millimetre.
const same = slanted
  .filter((h) => h.n[0] * armed.n[0] + h.n[1] * armed.n[1] + h.n[2] * armed.n[2] >= 0.98)
  .sort((a, b) => Math.hypot(...a.p.map((v, i) => v - armed.p[i])) - Math.hypot(...b.p.map((v, i) => v - armed.p[i])));
const march = [];
for (const c of same) {
  const far = march.every((m) => Math.hypot(...c.p.map((v, i) => v - m.p[i])) >= 3);
  if (far && Math.hypot(...c.p.map((v, i) => v - armed.p[i])) >= 3) march.push(c);
  if (march.length === 4) break;
}
check("there is room to walk along the face", march.length >= 3, `${march.length} well-spaced point(s)`);

const posInputs = page.locator(".hole-panel .hp-axis input");
const vals = async () => [await posInputs.nth(0).inputValue(), await posInputs.nth(1).inputValue()];
let prev = await vals();
const moved = [];
for (const c of march) {
  await page.mouse.click(c.at[0], c.at[1]);
  await page.waitForTimeout(220);
  const now = await vals();
  moved.push(JSON.stringify(now) !== JSON.stringify(prev));
  prev = now;
}
check("every click along the slanted face places the hole", moved.every(Boolean),
  `${moved.filter(Boolean).length} of ${moved.length} clicks were accepted — [${moved.map((m) => (m ? "ok" : "IGNORED")).join(", ")}]`);

await page.screenshot({ path: "shot-hole-tilted.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll slanted-face hole checks passed.");
