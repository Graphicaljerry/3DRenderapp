// Settings redesign + sync-payload e2e:
// 1) gzip-inside-envelope round trip (the statement-timeout fix) + v1 back-compat.
// 2) The grouped Settings modal: every tab renders its sections, new Appearance
//    controls (theme/units/dims) actually work, Save all still saves.
import { chromium } from "playwright";
import { enterWorkspace } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);

// ---- 1) Sync payload: compressed envelope, lossless round trip. ----
const crypt = await page.evaluate(async () => {
  const { encryptPayload, decryptPayload } = await import("/src/lib/backup.ts");
  const big = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ id: i, code: "function main(replicad){ return replicad.makeBaseBox(30,30,30); } // padding padding padding" })));
  const env = await encryptPayload("uid-123", big);
  const parsed = JSON.parse(env);
  const back = await decryptPayload("uid-123", env);
  return { gz: parsed.gz === true, smaller: env.length < big.length, roundtrip: back === big, ratio: Math.round((env.length / big.length) * 100) };
});
check("sync payload is gzip-compressed inside the envelope", crypt.gz && crypt.smaller, `${crypt.ratio}% of plaintext size`);
check("compressed payload round-trips losslessly", crypt.roundtrip);

// ---- 2) Grouped Settings modal. ----
// Signed out, the profile button opens Settings directly (Sync tab).
// Signed out, the avatar's job is getting signed IN — it opens the sign-in popup, not a
// settings pane (App.tsx: "Signed out, the avatar's job is getting signed IN"). Settings
// is reached from the menu item, so open the menu and pick it.
await page.getByRole("button", { name: "Account menu" }).click();
const settingsItem = page.locator(".pm-item", { hasText: /^Settings$/ }).first();
if (await settingsItem.count()) await settingsItem.click();
await page.waitForSelector(".card .stabs", { timeout: 20_000 });
const groups = async () => page.locator(".sgroup .sgroup-head b").allInnerTexts();

await page.locator(".stabs button", { hasText: "AI brain" }).click();
check("AI tab groups: Brain + AI changes", JSON.stringify(await groups()) === JSON.stringify(["Brain", "AI changes"]), (await groups()).join(", "));
await page.locator(".stabs button", { hasText: "3D engine" }).click();
const engGroups = await groups();
check("3D engine tab has Engine + Access groups", ["Engine", "Access"].every((g) => engGroups.includes(g)), engGroups.join(", "));
await page.locator(".stabs button", { hasText: "Printer" }).click();
const prnGroups = await groups();
check("Printer tab has Your printer + Print checks groups", ["Your printer", "Print checks"].every((g) => prnGroups.includes(g)), prnGroups.join(", "));
await page.locator(".stabs button", { hasText: "Sync" }).click();
check("Sync tab groups: Cloud account + File backup", JSON.stringify(await groups()) === JSON.stringify(["Cloud account", "File backup"]), (await groups()).join(", "));
const backupHidden = await page.getByLabel("Backup passphrase").isVisible().catch(() => false);
check("file-backup details are collapsed by default", !backupHidden);

// New Appearance controls actually change things.
await page.locator(".stabs button", { hasText: "Appearance" }).click();
check("Appearance tab groups: Look + Workspace", JSON.stringify(await groups()) === JSON.stringify(["Look", "Workspace"]), (await groups()).join(", "));
await page.getByRole("radiogroup", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
await page.waitForTimeout(200);
check("theme switch applies live", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
await page.getByRole("radiogroup", { name: "Theme" }).getByRole("button", { name: "Light" }).click();
await page.getByRole("radiogroup", { name: "Units" }).getByRole("button", { name: "Inches" }).click();
await page.waitForTimeout(200);
check("units switch persists", (await page.evaluate(() => localStorage.getItem("moldable_units"))) === "in");
await page.getByRole("radiogroup", { name: "Units" }).getByRole("button", { name: "Millimetres" }).click();
await page.getByRole("radiogroup", { name: "When to show dimensions" }).getByRole("button", { name: "Always" }).click();
await page.waitForTimeout(200);
check("dimensions mode persists", (await page.evaluate(() => localStorage.getItem("moldable_dims"))) === "always");
await page.getByRole("radiogroup", { name: "When to show dimensions" }).getByRole("button", { name: "On select" }).click();

await page.screenshot({ path: "shot-settings.png" });
await page.getByRole("button", { name: "Save all", exact: true }).click();
await page.waitForTimeout(300);
check("Save all closes the modal", (await page.locator(".card .stabs").count()) === 0);

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll settings checks passed.");
