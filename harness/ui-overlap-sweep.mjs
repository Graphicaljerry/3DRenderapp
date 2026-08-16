// Sweep: open every menu/popup at several widths and report any that overlap another
// interactive element (or run off-screen). Finds the "toolbar elements and popups
// overlap" cases without having to guess which one the user hit.
import { chromium } from "playwright";
import { enterWorkspace, awaitBuild } from "./enter.mjs";

const SIZES = [[1194, 834], [1024, 768], [834, 1194], [1366, 1024]]; // real iPad landscape / split / PORTRAIT / 12.9"
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const found = [];

const PROBE = [".pmenu", ".canvas-rail .rail-fly", ".layers-panel", ".mesh-stats", ".zoom-ctl",
  ".view-snaps", ".plate-bar", ".ai-preview-bar", ".viewer-head", ".tabs", ".statusbar",
  ".canvas-rail", ".inspector", ".pin-panel", ".hole-panel", ".snap-menu"];

for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
  await page.addInitScript(() => { localStorage.setItem("moldable_theme", "dark"); });
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(/^Build the box with lid\b/).click();
  await awaitBuild(page);

  const scan = (label) => page.evaluate(({ PROBE, label }) => {
    const boxes = PROBE.flatMap((s) => [...document.querySelectorAll(s)].map((el) => {
      const r = el.getBoundingClientRect();
      return { s, x: r.x, y: r.y, w: r.width, h: r.height, z: Number(getComputedStyle(el).zIndex) || 0 };
    })).filter((b) => b.w > 2 && b.h > 2);
    const out = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.s === b.s) continue;
      // Containers legitimately contain their own children.
      const contains = (p, c) => c.x >= p.x - 1 && c.y >= p.y - 1 && c.x + c.w <= p.x + p.w + 1 && c.y + c.h <= p.y + p.h + 1;
      if (contains(a, b) || contains(b, a)) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 3 && oy > 3) out.push(`${label}: ${a.s} ∩ ${b.s} = ${Math.round(ox)}×${Math.round(oy)}px (z ${a.z} vs ${b.z})`);
    }
    // Anything running off the right/bottom edge.
    for (const b of boxes) {
      if (b.x + b.w > innerWidth + 1) out.push(`${label}: ${b.s} runs ${Math.round(b.x + b.w - innerWidth)}px off the right edge`);
      if (b.x < -1) out.push(`${label}: ${b.s} runs ${Math.round(-b.x)}px off the left edge`);
    }
    return out;
  }, { PROBE, label });

  const click = async (name, where = "") => {
    const loc = where ? page.locator(where).getByRole("button", { name, exact: true }) : page.getByRole("button", { name, exact: true });
    if (!(await loc.count())) return false;
    await loc.first().click();
    await page.waitForTimeout(350);
    return true;
  };

  found.push(...await scan(`${width}x${height} base`));
  // Objects panel + each rail tool (the flyouts extend rightwards into the panel).
  if (await click("Objects")) {
    found.push(...await scan(`${width}x${height} objects`));
    for (const tool of ["Select", "Transform", "Measure", "Paint"]) {
      if (await click(tool, ".canvas-rail")) {
        found.push(...await scan(`${width}x${height} objects+${tool}`));
        await click(tool, ".canvas-rail");
      }
    }
    await click("Objects");
  }
  // Header menus.
  for (const m of ["View", "Export ▾", "Export"]) {
    if (await click(m)) { found.push(...await scan(`${width}x${height} menu:${m}`)); await page.keyboard.press("Escape"); }
  }
  await page.close();
}

await browser.close();
console.log(found.length ? "OVERLAPS FOUND:" : "no overlaps found at any width");
for (const f of [...new Set(found)]) console.log("  " + f);
