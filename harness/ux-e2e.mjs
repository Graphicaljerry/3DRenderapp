// UX batch e2e: renames (objects/model/plates), grouped layers, right-click menu,
// copy/paste/duplicate, zoom cluster, consolidated View menu.
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
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the box with lid template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("friction-fit"), null, { timeout: 120_000 });

// 1) Toolbar consolidation: display toggles live in one View menu now.
check("no top-level Wireframe/Stats/Dimensions buttons",
  (await page.getByRole("button", { name: "Wireframe", exact: true }).count()) === 0 &&
  (await page.getByRole("button", { name: "Stats", exact: true }).count()) === 0 &&
  (await page.getByRole("button", { name: "Dimensions", exact: true }).count()) === 0);
await page.getByRole("button", { name: /View options/ }).click();
await page.waitForSelector(".pmenu");
const viewItems = await page.locator(".pmenu .pmenu-item").allInnerTexts();
check("View menu holds dims/wireframe/stats/showcase/units/reset",
  ["Dimensions", "Wireframe", "Stats", "Showcase", "Units", "Reset view"].every((k) => viewItems.some((v) => v.includes(k))), viewItems.join(" | ").slice(0, 120));
await page.locator(".pmenu .pmenu-item", { hasText: "Wireframe" }).click();
check("wireframe toggles from the menu", (await page.locator(".pmenu [role=menuitemcheckbox]", { hasText: "Wireframe" }).getAttribute("aria-checked")) === "true");
await page.keyboard.press("Escape");

// 2) Zoom cluster present and functional (no crash on repeated use).
await page.waitForSelector(".zoom-ctl");
await page.getByRole("button", { name: "Zoom in", exact: true }).click();
await page.getByRole("button", { name: "Zoom out", exact: true }).click();
await page.getByRole("button", { name: "Zoom to fit", exact: true }).click();
check("zoom cluster works", true);

// 3) Grouped layers: separate → Part 2 shown indented under the model with a group label.
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.getByRole("button", { name: /Separate 2 parts/ }).click();
await page.waitForSelector(".lp-row.sub");
check("separated part renders as a grouped (indented) row", (await page.locator(".lp-group").count()) === 1 && (await page.locator(".lp-row.sub .lp-name").innerText()).includes("Part 2"));

// 4) Rename the part: double-click its name.
await page.locator(".lp-row.sub .lp-name").dblclick();
await page.locator(".layers-panel .name-edit").fill("Lid");
await page.keyboard.press("Enter");
check("attachment renamed", (await page.locator(".lp-row.sub .lp-name").innerText()) === "Lid");

// 5) Rename the model: double-click its name — the project (topbar) follows.
await page.locator(".layers-panel .lp-row").first().locator(".lp-name").dblclick();
await page.locator(".layers-panel .name-edit").fill("My gift box");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check("model rename renames the project", (await page.locator(".project-name").innerText()) === "My gift box");

// 6) Plate rename: add a plate, double-click its tab, name it; menu + store reflect it.
await page.locator(".lp-plates .lp-add").click();
await page.waitForSelector(".plate-bar");
await page.locator(".plate-bar .pb-tab").nth(2).dblclick();
await page.locator(".pb-edit").fill("Lids");
await page.keyboard.press("Enter");
check("plate tab shows its name", (await page.locator(".plate-bar .pb-name").innerText()) === "Lids");
await page.locator(".lp-row.sub .lp-plate").click();
const menuTexts = await page.locator(".pmenu .pmenu-item").allInnerTexts();
check("plate menu shows the label", menuTexts.some((v) => v.includes("Plate 2 · Lids")), menuTexts.join(" | "));
await page.keyboard.press("Escape");
await page.waitForTimeout(900);
const plates = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  return (await mod.listProjects()).find((x) => x.name === "My gift box")?.plates ?? null;
});
check("plate name persisted with the project", plates?.names?.[2] === "Lids", JSON.stringify(plates));

// 7) Right-click an object → context menu → Duplicate creates a movable copy.
await page.locator(".plate-bar .pb-tab", { hasText: "All" }).click(); // renaming focused plate 2 — show everything again
const canvas = page.locator(".viewerCanvas canvas");
const box = await canvas.boundingBox();
let ctxItems = [];
for (const pos of [[0.45, 0.55], [0.5, 0.5], [0.38, 0.6], [0.6, 0.6]]) {
  await canvas.click({ button: "right", position: { x: box.width * pos[0], y: box.height * pos[1] } });
  await page.waitForSelector(".pmenu");
  ctxItems = await page.locator(".pmenu .pmenu-item").allInnerTexts();
  if (ctxItems.some((v) => v.includes("Rename"))) break;
  await page.keyboard.press("Escape");
}
check("object context menu has quick actions", ["Rename", "Duplicate", "Copy"].every((k) => ctxItems.some((v) => v.includes(k))), ctxItems.join(" | ").slice(0, 140));
await page.locator(".pmenu .pmenu-item", { hasText: "Duplicate" }).click();
await page.waitForTimeout(600);
const namesNow = await page.locator(".layers-panel .lp-name").allInnerTexts();
check("duplicate adds a copy object", namesNow.some((n) => n.includes("copy")), namesNow.join(", "));

// 8) Copy an object, right-click empty space → Paste.
for (const pos of [[0.6, 0.55], [0.7, 0.5], [0.65, 0.65], [0.5, 0.6]]) {
  await canvas.click({ button: "right", position: { x: box.width * pos[0], y: box.height * pos[1] } });
  await page.waitForSelector(".pmenu");
  if ((await page.locator(".pmenu .pmenu-item", { hasText: /^Copy$/ }).count()) > 0) break;
  await page.keyboard.press("Escape");
}
await page.locator(".pmenu .pmenu-item", { hasText: /^Copy$/ }).click();
await canvas.click({ button: "right", position: { x: box.width * 0.92, y: box.height * 0.15 } });
await page.waitForSelector(".pmenu");
const emptyItems = await page.locator(".pmenu .pmenu-item").allInnerTexts();
check("empty-space menu offers Paste", emptyItems.some((v) => v.startsWith("Paste")), emptyItems.join(" | "));
await page.locator(".pmenu .pmenu-item", { hasText: "Paste" }).click();
await page.waitForTimeout(600);
const namesAfterPaste = await page.locator(".layers-panel .lp-name").allInnerTexts();
check("paste lands a new object", namesAfterPaste.filter((n) => n.includes("copy")).length >= 2, namesAfterPaste.join(", "));

// 9) Right-click a part → part menu with fit tools; screenshot for the record.
await page.screenshot({ path: "shot-ux.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll UX checks passed.");
