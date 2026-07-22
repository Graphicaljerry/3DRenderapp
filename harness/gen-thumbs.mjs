// Generate template card thumbnails by driving the REAL app: open the Templates
// gallery, tap each card, let the OCCT kernel build it, then save the app's own
// captured project thumbnail (clean 3/4 render, 384×288 webp) as the card image.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "/home/user/3DRenderapp/moldable-lite/src/assets/templates";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

let templates = await page.evaluate(async () => {
  const mod = await import("/src/cad/templates.ts");
  return mod.TEMPLATES.map((t) => ({ id: t.id, name: t.name }));
});
if (process.argv[2]) templates = templates.filter((t) => t.id === process.argv[2]);

for (const t of templates) {
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle(`Build the ${t.name.toLowerCase()} template`).click();
  // The thumb effect writes project.thumb ~500ms after the geometry renders.
  let dataUrl = null;
  const deadline = Date.now() + 120_000;
  while (!dataUrl && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    dataUrl = await page.evaluate(async (name) => {
      const mod = await import("/src/store/projects.ts");
      const all = await mod.listProjects();
      const p = all.find((x) => x.name === name && x.thumb);
      return p ? p.thumb : null;
    }, t.name);
  }
  if (!dataUrl) throw new Error(`${t.id}: no thumbnail after 120 s`);
  const m = /^data:image\/(webp|png);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error(`${t.id}: unexpected thumb format: ${String(dataUrl).slice(0, 80)}`);
  const file = `${OUT}/${t.id}.${m[1] === "webp" ? "webp" : "png"}`;
  writeFileSync(file, Buffer.from(m[2], "base64"));
  console.log(`saved ${file} (${Math.round((m[2].length * 3) / 4 / 1024)} KB)`);
}

await browser.close();
