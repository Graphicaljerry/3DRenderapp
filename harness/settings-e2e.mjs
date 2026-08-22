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
// The status bar's printer chip, not the avatar. When this was written the avatar
// opened the sign-in popup while signed out and its menu — the one carrying Settings —
// rendered only for an account, so driving Settings from up there waited 20 s for a
// modal that was never coming. The avatar now opens a menu in every auth state with
// Settings in it, so that route works too; this one is kept because the chip opens
// Settings in one click from any state, which is still the shortest path.
await page.locator(".statusbar .bedchip").click();
await page.waitForSelector(".card .stabs", { timeout: 20_000 });
const groups = async () => page.locator(".sgroup .sgroup-head b").allInnerTexts();

await page.locator(".stabs button", { hasText: "AI brain" }).click();
// Contains, not equals — the exact-list form failed the day Before building and Spend
// joined the pane, which is a pane gaining sections rather than a defect. The two groups
// this check is about are the ones named.
const aiGroups = await groups();
check("AI tab has Brain + AI changes groups", ["Brain", "AI changes"].every((g) => aiGroups.includes(g)), aiGroups.join(", "));
await page.locator(".stabs button", { hasText: "3D engine" }).click();
const engGroups = await groups();
check("3D engine tab has Engine + Access groups", ["Engine", "Access"].every((g) => engGroups.includes(g)), engGroups.join(", "));
await page.locator(".stabs button", { hasText: "Printer" }).click();
const prnGroups = await groups();
check("Printer tab has Your printer + Print checks groups", ["Your printer", "Print checks"].every((g) => prnGroups.includes(g)), prnGroups.join(", "));
await page.locator(".stabs button", { hasText: "Sync" }).click();
const syncGroups = await groups();
check("Sync tab has Cloud account + File backup groups", ["Cloud account", "File backup"].every((g) => syncGroups.includes(g)), syncGroups.join(", "));
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
