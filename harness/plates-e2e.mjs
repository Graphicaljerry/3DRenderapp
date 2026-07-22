// Build plates e2e: dynamic plates UI, assignment menu, persistence, project-3MF content.
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "/home/user/3DRenderapp/moldable-lite/node_modules/fflate/esm/browser.js";

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

// Build a model (template = fastest zero-key path).
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the phone stand template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("phone stand"), { timeout: 120_000 });

// 1) Objects panel: add a plate, assign the model to it from the menu.
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForSelector(".layers-panel");
await page.locator(".lp-plates .lp-add").click();
check("objects panel can add a plate", (await page.locator(".lp-plates button", { hasText: "P2" }).count()) === 1);

// Plate bar appears once there's more than one plate.
await page.waitForSelector(".plate-bar");
check("plate bar appears with 2 plates", true);
let tabs = await page.locator(".plate-bar .pb-tab").allInnerTexts();
check("bar shows All + 2 plate tabs", tabs.length === 3, tabs.join("|"));

// Assign the model to plate 2 via the menu (no blind cycling).
await page.locator(".layers-panel .lp-row").first().locator(".lp-plate").click();
await page.locator(".pmenu .pmenu-item", { hasText: "Plate 2" }).click();
const counts = await page.locator(".plate-bar .pb-count").allInnerTexts();
check("counts move to plate 2", counts.join("|") === "0|1", counts.join("|"));

// 2) "+ New plate" from the object's own menu.
await page.locator(".layers-panel .lp-row").first().locator(".lp-plate").click();
await page.locator(".pmenu .pmenu-item", { hasText: "New plate" }).click();
tabs = await page.locator(".plate-bar .pb-tab").allInnerTexts();
check("menu's New plate adds plate 3 and moves the model", tabs.length === 4 && (await page.locator(".layers-panel .lp-row").first().locator(".lp-plate").innerText()).includes("P3"), tabs.join("|"));

// 3) Focus a plate from the bar, then remove it — objects fall back a plate.
await page.locator(".plate-bar .pb-tab").nth(3).click(); // plate 3
await page.locator(".plate-bar .pb-x").click();
tabs = await page.locator(".plate-bar .pb-tab").allInnerTexts();
const modelPlate = await page.locator(".layers-panel .lp-row").first().locator(".lp-plate").innerText();
check("removing plate 3 lands its objects on plate 2", tabs.length === 3 && modelPlate.includes("P2"), `${tabs.join("|")} ${modelPlate}`);

// 4) Persistence: plates survive a reload via the project store.
await page.waitForTimeout(900); // debounced persist
const stored = await page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  const all = await mod.listProjects();
  return all.find((x) => x.name === "Phone stand")?.plates ?? null;
});
check("plate layout persisted with the project", stored && stored.count === 2 && stored.of.model === 2, JSON.stringify(stored));

// 5) Project 3MF: exercise the real writer and validate the archive.
const b64 = await page.evaluate(async () => {
  const THREE = await import("/@fs/home/user/3DRenderapp/moldable-lite/node_modules/three/build/three.module.js");
  const ec = await import("/src/print/exportClient.ts");
  const box = (w) => { const g = new THREE.BoxGeometry(w, 20, 10); g.translate(0, 0, 5); return g; };
  const blob = ec.platesToProject3MF(
    [
      { geometry: box(30), name: "part A", plate: 1 },
      { geometry: box(12), name: "part B", plate: 2 },
    ],
    3,
    { x: 256, y: 256 },
  );
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
});
const files = unzipSync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const names = Object.keys(files);
check("archive has core + model_settings", names.includes("3D/3dmodel.model") && names.includes("Metadata/model_settings.config"), names.join(", "));
const model = strFromU8(files["3D/3dmodel.model"]);
const cfg = strFromU8(files["Metadata/model_settings.config"]);
check("model marked as Bambu project", model.includes('name="BambuStudio:3mfVersion"') && model.includes("Application"));
check("2 objects, both named", model.includes('name="part A"') && model.includes('name="part B"'));
const plateBlocks = cfg.match(/<plate>/g)?.length ?? 0;
check("3 plates declared (incl. empty plate 3)", plateBlocks === 3, String(plateBlocks));
check("plate 1 holds object 1, plate 2 holds object 2",
  /plater_id" value="1"[\s\S]*?object_id" value="1"[\s\S]*?plater_id" value="2"[\s\S]*?object_id" value="2"/.test(cfg));
check("assemble section present", cfg.includes("<assemble>") && (cfg.match(/assemble_item/g)?.length ?? 0) === 2);
// World placement: plate 1 group centred at (128,128); plate 2 at (1.2*256 + 128).
const t1 = /objectid="1" transform="1 0 0 0 1 0 0 0 1 ([-\d. ]+)"/.exec(model)?.[1].split(" ").map(Number);
const t2 = /objectid="2" transform="1 0 0 0 1 0 0 0 1 ([-\d. ]+)"/.exec(model)?.[1].split(" ").map(Number);
check("plate 1 part centred on bed 1", t1 && Math.abs(t1[0] - 128) < 0.01 && Math.abs(t1[1] - 128) < 0.01 && Math.abs(t1[2]) < 0.01, JSON.stringify(t1));
check("plate 2 part offset one stride right", t2 && Math.abs(t2[0] - (307.2 + 128)) < 0.01 && Math.abs(t2[1] - 128) < 0.01, JSON.stringify(t2));

// 6) The bar's export menu triggers a real download.
const dl = page.waitForEvent("download", { timeout: 30_000 });
await page.locator(".plate-bar .pb-export").click();
await page.locator(".pmenu .pmenu-item", { hasText: "One project .3mf" }).click();
const download = await dl;
check("bar exports a project .3mf", (download.suggestedFilename() ?? "").endsWith(".3mf"), download.suggestedFilename());

await page.screenshot({ path: "shot-plates.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll plate checks passed.");
