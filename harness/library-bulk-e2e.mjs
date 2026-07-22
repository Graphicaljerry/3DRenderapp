// Library bulk-select e2e: Select mode, tap-to-select cards, select-all/clear,
// bulk move to a new folder, bulk delete with confirm, and Done restoring normal mode.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
page.on("dialog", (d) => void d.accept("Archive")); // confirm() for delete, prompt() for new folder
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

// Seed four projects (thumbV=2 keeps the background upgrader out of the way).
await page.evaluate(async () => {
  const { putProject } = await import("/src/store/projects.ts");
  const mk = (id, name, at) => ({
    id, name, engine: "replicad", createdAt: at, updatedAt: at, thumbV: 2,
    versions: [{ id: id + "-v1", createdAt: at, summary: name, engine: "replicad" }],
  });
  await putProject(mk("b1", "Bracket A", Date.now() - 4000));
  await putProject(mk("b2", "Bracket B", Date.now() - 3000));
  await putProject(mk("b3", "Keeper C", Date.now() - 2000));
  await putProject(mk("b4", "Keeper D", Date.now() - 1000));
});

await page.getByRole("button", { name: "Library", exact: true }).click();
await page.waitForSelector(".lib-grid", { timeout: 20_000 });
const names = () => page.evaluate(() => [...document.querySelectorAll(".lib-card .lib-name")].map((x) => x.textContent));

// Enter Select mode; tap two cards.
await page.locator(".card.wide").getByTitle("Select several models to delete or move them together").click();
check("bulk bar appears", (await page.locator(".lib-bulk").count()) === 1);
await page.locator(".lib-card", { hasText: "Bracket A" }).locator(".lib-open").click();
await page.locator(".lib-card", { hasText: "Bracket B" }).locator(".lib-open").click();
check("two selected + counted", (await page.locator(".lib-bulk-count").textContent()) === "2 selected");
check("selected cards marked", (await page.locator(".lib-card.sel").count()) === 2);
check("tapping in select mode did NOT open a project", (await page.locator(".lib-grid").count()) === 1);

// Select all shown, then clear, then re-select the two brackets.
await page.getByRole("button", { name: "Select all shown" }).click();
check("select all shown → 4", (await page.locator(".lib-bulk-count").textContent()) === "4 selected");
await page.getByRole("button", { name: "Clear", exact: true }).click();
check("clear → 0", (await page.locator(".lib-bulk-count").textContent()) === "0 selected");

// Bulk move Keeper C+D into a new folder (prompt supplies "Archive").
await page.locator(".lib-card", { hasText: "Keeper C" }).locator(".lib-open").click();
await page.locator(".lib-card", { hasText: "Keeper D" }).locator(".lib-open").click();
await page.locator(".lib-bulk .lib-move").selectOption("__new__");
await page.waitForTimeout(500);
check("bulk move created the folder chip", (await page.locator(".lib-chip", { hasText: "Archive (2)" }).count()) === 1);
check("select mode exits after a bulk action", (await page.locator(".lib-bulk").count()) === 0);

// Bulk delete the two brackets.
await page.locator(".card.wide").getByTitle("Select several models to delete or move them together").click();
await page.locator(".lib-card", { hasText: "Bracket A" }).locator(".lib-open").click();
await page.locator(".lib-card", { hasText: "Bracket B" }).locator(".lib-open").click();
await page.getByRole("button", { name: /Delete selected \(2\)/ }).click();
await page.waitForTimeout(600);
const left = await names();
check("bulk delete removed exactly the selected", left.length === 2 && !left.includes("Bracket A") && !left.includes("Bracket B"), left.join(", "));
const stored = await page.evaluate(async () => {
  const { listProjects } = await import("/src/store/projects.ts");
  return (await listProjects()).map((p) => `${p.name}:${p.folder ?? "-"}`).sort();
});
check("store agrees (deletes + folders persisted)", JSON.stringify(stored) === JSON.stringify(["Keeper C:Archive", "Keeper D:Archive"]), stored.join(", "));
await page.screenshot({ path: "shot-library-bulk.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll bulk-select checks passed.");
