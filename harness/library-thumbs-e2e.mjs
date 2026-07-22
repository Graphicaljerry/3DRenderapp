// Library thumbnail upgrade e2e: a project saved with an OLD-style thumb (no
// thumbV stamp) gets silently rebuilt off-screen and re-shot studio-style when
// the Library opens; fresh captures are stamped with the current style version.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

const OLD_THUMB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+cX5AAAAABJRU5ErkJggg==";

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

// Seed a stale-thumbnail CAD project through the real store.
await page.evaluate(async (oldThumb) => {
  const { putProject } = await import("/src/store/projects.ts");
  const code = `const defaultParams = { size: 24 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  return replicad.makeBaseBox(p.size, p.size, 10);
}`;
  await putProject({
    id: "stale-thumb-test",
    name: "Stale thumb project",
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now() - 86_400_000,
    engine: "replicad",
    code,
    versions: [{ id: "v1", createdAt: Date.now() - 86_400_000, summary: "old box", engine: "replicad", code }],
    thumb: oldThumb, // pre-studio capture, no thumbV stamp
  });
}, OLD_THUMB);

// Wait for the CAD kernel (the upgrader needs it), then open the Library.
await page.waitForFunction(() => document.body.textContent.includes("Engine · replicad"), null, { timeout: 120_000 });
await page.getByRole("button", { name: "Library", exact: true }).click();

// The upgrade runs in the background: poll the store until the stamp lands.
await page.waitForFunction(async () => {
  const { getProject } = await import("/src/store/projects.ts");
  const p = await getProject("stale-thumb-test");
  return !!(p && p.thumbV === 2);
}, null, { timeout: 60_000 });
const upgraded = await page.evaluate(async () => {
  const { getProject } = await import("/src/store/projects.ts");
  const p = await getProject("stale-thumb-test");
  return { thumb: (p?.thumb ?? "").slice(0, 22), len: (p?.thumb ?? "").length };
});
check("stale project re-stamped to thumbV=2", true);
check("thumb replaced with a studio webp", upgraded.thumb.startsWith("data:image/webp") && upgraded.len > 2000, JSON.stringify(upgraded));

// The open Library repaints with the new shot (its card shows an <img> whose src is the new webp).
await page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll(".lib-grid img")];
  return imgs.some((i) => i.src.startsWith("data:image/webp") && i.closest(".lib-card")?.textContent?.includes("Stale thumb project"));
}, null, { timeout: 20_000 }).then(() => check("library card repainted with the studio shot", true)).catch(() => check("library card repainted with the studio shot", false));
await page.screenshot({ path: "shot-library-upgraded.png" });

// Fresh captures stamp the style version too: build a template, let the auto-thumb run.
await page.keyboard.press("Escape");
await page.locator(".overlay .x, .overlay button.x").first().click().catch(() => {});
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the coaster template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.toLowerCase().includes("coaster"), null, { timeout: 120_000 });
const fresh = await page.waitForFunction(async () => {
  const { listProjects } = await import("/src/store/projects.ts");
  const p = (await listProjects()).find((x) => x.name === "Coaster" && x.thumb);
  return p && p.thumbV === 2 ? true : false;
}, null, { timeout: 30_000 }).then(() => true).catch(() => false);
check("fresh captures carry thumbV=2", fresh);

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll library-thumbnail checks passed.");
