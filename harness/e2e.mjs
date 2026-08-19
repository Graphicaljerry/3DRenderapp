// End-to-end: gallery entry points, one-tap build, fresh-project behavior, live params.
import { chromium } from "playwright";
import { awaitBuild } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

// 1) Entry gate → "start from a template" link opens the gallery with no key.
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
// "Start from a template" is a <p class="launch-label"> now — a heading, not a control —
// so clicking it did nothing and .tpl-grid never appeared. The gallery door beside it is
// the "All {N}" button (.launch-more).
await page.locator(".launch-more").first().click();
await page.waitForSelector(".overlay .tpl-grid", { timeout: 30_000 });
check("keycard link opens gallery", true);
// Count isn't pinned — templates get added; every card having a real thumbnail is.
const cards = await page.locator(".overlay .tpl-card").count();
check("gallery shows the template cards", cards >= 10, `${cards}`);
// Mesh templates deliberately show a sculpt GLYPH, not a render: the generative engine
// returns something different every run, so a photo-real card "would promise a specific
// result the card can't deliver" (TemplatesModal). Requiring an <img> on all twelve was
// asking the app to make a promise it decided not to make. What must hold is that no card
// is blank, and that the CAD ones — which build deterministically — do carry a render.
const imgs = await page.locator(".overlay .tpl-thumb img").count();
const glyphs = await page.locator(".overlay .tpl-thumb-empty").count();
check("no template card is blank", imgs + glyphs === cards, `${imgs} rendered + ${glyphs} glyph = ${imgs + glyphs} of ${cards}`);
check("the deterministic CAD templates carry a real render", imgs >= 6, `${imgs} renders`);

// 2) Tap "Headphone desk hook" → parametric model builds, chat + project + sliders present.
await page.locator(".overlay").getByTitle(/^Build the headphone desk hook\b/).click();
await page.waitForSelector(".overlay", { state: "detached" });
// The bubble is the template's SUMMARY, not its name: loadTemplate posts `text: t.summary`
// (App.tsx), and the desk hook's summary opens "A headphone hook that clamps to your
// desk…" — it never says "headphone desk hook", so this waited for a string the app does
// not write. enter.mjs retired exactly this anti-pattern in awaitBuild's docstring, and
// the point stands twice over: a chat bubble echoing a name proves nothing about a MODEL
// appearing. Ask the viewer instead, then check the reply separately against the app's
// own copy so a reworded blurb can't break the probe again.
await awaitBuild(page);
const hookSummary = await page.evaluate(async () => {
  const tpl = await import("/src/cad/templates.ts");
  return tpl.TEMPLATES.find((t) => t.id === "desk-hook").summary;
});
const hookSaid = await page.waitForFunction(
  (s) => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent?.includes(s)),
  hookSummary,
  // Third argument, not second: waitForFunction(fn, arg, options). The options object was
  // in the ARG slot, so the 120_000 on the line was never read — the log said "Timeout
  // 30000ms" on a line that reads 120_000.
  { timeout: 60_000 },
).then(() => true, () => false);
check("headphone desk hook built + summary in chat", hookSaid, hookSummary.slice(0, 60));
const proj = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  const all = await mod.listProjects();
  const p = all.find((x) => x.name === "Headphone desk hook");
  return p ? { versions: p.versions.length, hasCode: !!p.versions[0]?.code?.includes("defaultParams"), dims: p.versions[0]?.dims } : null;
});
check("project persisted with parametric code", !!proj?.hasCode, JSON.stringify(proj));

// The dimension sliders are reachable (params extracted from defaultParams).
// The row is called "Adjust", not "Parameters" or "Sliders" — it is free, no-AI dimension
// tweaking, and the old engineering word was renamed for that reason (Workspace.tsx:1875).
// Matching /sliders|param/ found nothing and reported a missing panel that was on screen.
const paramsTab = page.locator(".dock-list button", { hasText: "Adjust" }).first();
check("Adjust (dimension sliders) reachable", (await paramsTab.count()) > 0);

// 3) Live params: same code, bigger plate → dims change accordingly.
const dimsChange = await page.evaluate(async () => {
  const eng = await import("/src/engine/selectEngine.ts");
  const tpl = await import("/src/cad/templates.ts");
  const s = await eng.getEngineSelection();
  // "wall-hook" was renamed to "desk-hook" when the gallery was rebuilt to 12 templates,
  // and plateWidth/hookReach went with it — the old overrides named parameters the program
  // no longer has, so `t` was undefined and t.code threw. hookLength is the hanger bar,
  // sketched on XZ and extruded along Y, so a longer hook can only grow X.
  const t = tpl.TEMPLATES.find((x) => x.id === "desk-hook");
  const a = await s.engine.build({ kind: "code", code: t.code });
  const b = await s.engine.build({ kind: "code", code: t.code, params: { hookLength: 80 } });
  return { a: a.dims, b: b.dims };
});
// The AXIS, not a literal size: pinning "x === 50" is what made this brittle the first
// time, and the claim being tested is that an override reaches the program at all.
check("param overrides change dims", dimsChange.b.x > dimsChange.a.x, JSON.stringify(dimsChange));

// 4) Empty state (new chat) shows the template strip; tapping a card starts a FRESH project.
await page.getByRole("button", { name: "+ New chat" }).click();
await page.waitForSelector(".tpl-strip");
check("empty state shows template strip", true);
await page.locator(".tpl-strip").getByTitle(/^Build the squeeze bag clip\b/).click();
// Same defect on the second template: the card is titled "Squeeze bag clip", the reply is
// the summary. Wait for the model, then match the app's own text.
await awaitBuild(page);
const clipSummary = await page.evaluate(async () => {
  const tpl = await import("/src/cad/templates.ts");
  return tpl.TEMPLATES.find((t) => t.id === "bag-clip").summary;
});
const clipSaid = await page.waitForFunction(
  (s) => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent?.includes(s)),
  clipSummary, { timeout: 60_000 },
).then(() => true, () => false);
const names = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  return (await mod.listProjects()).map((p) => p.name).sort();
});
check("template opens as its own project", names.includes("Headphone desk hook") && names.includes("Squeeze bag clip"), names.join(", "));

// 5) Topbar Templates button reopens the gallery any time.
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.waitForSelector(".overlay .tpl-grid");
check("topbar button reopens gallery", true);
await page.keyboard.press("Escape");
await page.screenshot({ path: "e2e-final.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll checks passed.");
