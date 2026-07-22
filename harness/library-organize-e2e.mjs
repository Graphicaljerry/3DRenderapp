// Library organization e2e: search, sort, engine filter, live model count, and
// flat folders (create via prompt, chip filtering, persistence + sync stamp).
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
page.on("dialog", (d) => void d.accept("Prototypes")); // the New folder… prompt
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

// Seed three projects (thumbV=2 so the background upgrader leaves them alone).
await page.evaluate(async () => {
  const { putProject } = await import("/src/store/projects.ts");
  const mk = (id, name, engine, at, summary) => ({
    id, name, engine,
    createdAt: at, updatedAt: at,
    thumbV: 2,
    versions: [{ id: id + "-v1", createdAt: at, summary, engine }],
  });
  await putProject(mk("p-hook", "Wall hook mount", "replicad", Date.now() - 3000, "a wall hook"));
  await putProject(mk("p-box", "Storage box", "replicad", Date.now() - 2000, "a box with lid"));
  await putProject(mk("p-dragon", "Dragon figurine", "generative", Date.now() - 1000, "a dragon mesh"));
});

await page.getByRole("button", { name: "Library", exact: true }).click();
await page.waitForSelector(".lib-grid", { timeout: 20_000 });
const cardNames = () => page.evaluate(() => [...document.querySelectorAll(".lib-card .lib-name")].map((x) => x.textContent));

// Count + default sort (newest first).
const count0 = await page.locator(".lib-count").textContent();
check("model count shown", /3 models/.test(count0), count0);
check("default sort newest first", (await cardNames())[0] === "Dragon figurine", (await cardNames()).join(", "));

// Search narrows + count reflects it.
await page.locator(".lib-search").fill("hook");
await page.waitForTimeout(200);
check("search narrows to the hook", (await cardNames()).join() === "Wall hook mount", (await cardNames()).join(", "));
check("count shows filtered total", /1 of 3 models/.test(await page.locator(".lib-count").textContent()));
await page.locator(".lib-search").fill("");

// Engine filter: mesh only.
await page.locator(".lib-toolbar select").nth(1).selectOption("mesh");
await page.waitForTimeout(200);
check("engine filter → generative only", (await cardNames()).join() === "Dragon figurine", (await cardNames()).join(", "));
await page.locator(".lib-toolbar select").nth(1).selectOption("all");

// Sort by name.
await page.locator(".lib-toolbar select").nth(0).selectOption("name");
await page.waitForTimeout(200);
check("sort by name A–Z", (await cardNames())[0] === "Dragon figurine" && (await cardNames())[2] === "Wall hook mount", (await cardNames()).join(", "));

// Folders: move the box into a new "Prototypes" folder via the card's select.
const boxCard = page.locator(".lib-card", { hasText: "Storage box" });
await boxCard.locator(".lib-move").selectOption("__new__");
await page.waitForTimeout(500);
check("folder chip appears with count", await page.locator(".lib-chip", { hasText: "Prototypes (1)" }).count() === 1);
check("card badges its folder", (await boxCard.locator(".lib-meta").last().textContent()).includes("Prototypes"));

// Chip filters to the folder; Unfiled shows the rest.
await page.locator(".lib-chip", { hasText: "Prototypes" }).click();
await page.waitForTimeout(200);
check("folder chip filters", (await cardNames()).join() === "Storage box", (await cardNames()).join(", "));
await page.locator(".lib-chip", { hasText: "Unfiled" }).click();
await page.waitForTimeout(200);
check("Unfiled chip shows the rest", (await cardNames()).length === 2 && !(await cardNames()).includes("Storage box"), (await cardNames()).join(", "));

// Persistence: the folder is stored on the project (and updatedAt bumped for sync).
const stored = await page.evaluate(async () => {
  const { getProject } = await import("/src/store/projects.ts");
  const p = await getProject("p-box");
  return { folder: p?.folder, bumped: (p?.updatedAt ?? 0) > Date.now() - 60_000 };
});
check("folder persisted + sync-stamped", stored.folder === "Prototypes" && stored.bumped, JSON.stringify(stored));
await page.screenshot({ path: "shot-library-organize.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll library-organization checks passed.");
