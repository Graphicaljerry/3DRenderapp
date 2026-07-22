// End-to-end: gallery entry points, one-tap build, fresh-project behavior, live params.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

// 1) Entry gate → "start from a template" link opens the gallery with no key.
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.getByText("Or start from a template").click();
await page.waitForSelector(".overlay .tpl-grid", { timeout: 30_000 });
check("keycard link opens gallery", true);
const cards = await page.locator(".overlay .tpl-card").count();
check("gallery shows 10 cards", cards === 10, `${cards}`);
const thumbs = await page.locator(".overlay .tpl-thumb img").count();
check("cards have real thumbnails", thumbs === 10, `${thumbs}`);

// 2) Tap "Wall hook" → parametric model builds, chat + project + sliders present.
await page.locator(".overlay").getByTitle("Build the wall hook template").click();
await page.waitForSelector(".overlay", { state: "detached" });
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("wall hook"), { timeout: 120_000 });
check("wall hook built + summary in chat", true);
const proj = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  const all = await mod.listProjects();
  const p = all.find((x) => x.name === "Wall hook");
  return p ? { versions: p.versions.length, hasCode: !!p.versions[0]?.code?.includes("defaultParams"), dims: p.versions[0]?.dims } : null;
});
check("project persisted with parametric code", !!proj?.hasCode, JSON.stringify(proj));

// Sliders tab reachable (params extracted from defaultParams).
const paramsTab = page.getByRole("button", { name: /sliders|param/i }).first();
check("params/sliders tab present", (await paramsTab.count()) > 0);

// 3) Live params: same code, bigger plate → dims change accordingly.
const dimsChange = await page.evaluate(async () => {
  const eng = await import("/src/engine/selectEngine.ts");
  const tpl = await import("/src/cad/templates.ts");
  const s = await eng.getEngineSelection();
  const t = tpl.TEMPLATES.find((x) => x.id === "wall-hook");
  const a = await s.engine.build({ kind: "code", code: t.code });
  const b = await s.engine.build({ kind: "code", code: t.code, params: { plateWidth: 50, hookReach: 50 } });
  return { a: a.dims, b: b.dims };
});
check("param overrides change dims", dimsChange.b.x === 50 && dimsChange.b.z > dimsChange.a.z, JSON.stringify(dimsChange));

// 4) Empty state (new chat) shows the template strip; tapping a card starts a FRESH project.
await page.getByRole("button", { name: "+ New chat" }).click();
await page.waitForSelector(".tpl-strip");
check("empty state shows template strip", true);
await page.locator(".tpl-strip").getByTitle("Build the cable clip template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("cable clip"), { timeout: 120_000 });
const names = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  return (await mod.listProjects()).map((p) => p.name).sort();
});
check("template opens as its own project", names.includes("Wall hook") && names.includes("Cable clip"), names.join(", "));

// 5) Topbar Templates button reopens the gallery any time.
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.waitForSelector(".overlay .tpl-grid");
check("topbar button reopens gallery", true);
await page.keyboard.press("Escape");
await page.screenshot({ path: "e2e-final.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll checks passed.");
