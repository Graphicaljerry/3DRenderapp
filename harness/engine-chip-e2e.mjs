// The engine is a project-level fact, stated in the statusbar, and the CAD→mesh crossing
// is a deliberate one-way conversion rather than a segmented "mode".
//
// What this guards, specifically: the Auto/Precise/Generative segment used to sit in the
// composer forever. After the first build its "Auto" was inert (routing is gated on
// there being no model), and the other two looked like a reversible mode switch while
// actually being a conversion that costs dimensions, STEP and every CAD tool. So: the
// segment must be present on an EMPTY canvas and absent once a model exists, and the
// chip must appear only once there is something to describe.
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await enterWorkspace(page);

// --- empty canvas: the picker is the thing that shows, the readout is not ---
check("empty canvas offers the engine picker", await page.locator(".modebar-row .seg").count() === 1);
check("empty canvas shows no engine chip", await page.locator(".engine-chip").count() === 0);

// --- build a real CAD part from a template (no LLM involved) ---
await page.locator(".topbar button, .empty-actions button").filter({ hasText: /template/i }).first().click();
await page.waitForSelector(".overlay .tpl-grid", { timeout: 30_000 });
await page.locator(".overlay .tpl-grid .tpl-card").first().click();
await page.waitForSelector(".overlay", { state: "detached", timeout: 30_000 });
await awaitBuild(page);

// --- with a model: the readout appears, the picker goes ---
const chip = page.locator(".engine-chip");
check("engine chip appears once a model exists", await chip.count() === 1);
const label = (await chip.first().innerText()).trim();
check("chip names the CAD engine", /precise/i.test(label), label);
check("engine picker is gone once a model exists", await page.locator(".modebar-row .seg").count() === 0);
// The chip must sit in the statusbar next to the dimensions, not float somewhere else.
const placed = await page.evaluate(() => !!document.querySelector(".statusbar .engine-chip"));
check("chip lives in the statusbar", placed);

// --- the chip is the door: first what you have, then what changing it costs ---
await chip.first().click();
await page.waitForSelector(".engine-menu", { timeout: 10_000 });
const first = await page.locator(".engine-menu").innerText();
check("menu states how the part was built", /exact CAD|dimensions/i.test(first), first.slice(0, 70));
const sculpt = page.locator(".engine-menu .pm-item").filter({ hasText: /sculpt as mesh/i });
check("menu offers the crossing", await sculpt.count() === 1);

await sculpt.first().click();
const warn = await page.locator(".engine-menu").innerText();
// The three things a mode switch would not have told you: it is lossy, it is
// recoverable, and it costs money.
check("confirm step names what is lost", /lose|STEP|dimensions/i.test(warn), warn.slice(0, 80));
check("confirm step says the CAD version survives", /History|Undo/i.test(warn));
check("confirm step states the cost", /\$0\.10|paid/i.test(warn));
check("confirm step has an explicit go button", await page.locator(".engine-menu .primary").filter({ hasText: /sculpt as mesh/i }).count() === 1);
// Backing out must leave the part exactly as it was — this is the escape hatch that a
// segmented control never had.
await page.locator(".engine-menu .ghost").filter({ hasText: /back/i }).click();
check("Back returns to the readout", /exact CAD|dimensions/i.test(await page.locator(".engine-menu").innerText()));
await page.keyboard.press("Escape");

const stillCad = await page.evaluate(() => {
  const n = window.__viewerS?.()?.mesh?.geometry?.getAttribute?.("position")?.count ?? 0;
  // innerText, not textContent: the chip carries BOTH spellings ("Precise CAD" for
  // desktop, "CAD" for a phone) and hides one by CSS. textContent reads both and
  // reports "Precise CADCAD", which looks like a rendering bug and is not one.
  return { verts: n, chip: document.querySelector(".engine-chip")?.innerText?.trim() };
});
check("model untouched after backing out", stillCad.verts > 0 && /precise/i.test(stillCad.chip ?? ""), JSON.stringify(stillCad));

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
