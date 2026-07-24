// The composer engine switch now has three options — Auto (default), Precise (CAD),
// Generative (AI mesh) — Auto lets the app classify each new ask and pick the engine.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

// fresh context → localStorage is empty, so no stored preference → Auto is the default
// (don't clear the pref in initScript — it runs on every reload and would break persistence)
await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".modebar .seg", { timeout: 60_000 });

const seg = page.locator(".modebar .seg button");
const labels = await seg.allInnerTexts();
check("A1 three engine options: Auto · Precise · Generative", labels.length === 3 && labels[0] === "Auto" && /Precise/.test(labels[1]) && /Generative/.test(labels[2]), JSON.stringify(labels));
const onLabel = async () => (await page.locator(".modebar .seg button.on").innerText()).trim();
check("A2 Auto is the default selection", (await onLabel()) === "Auto", await onLabel());
check("A3 Auto hint explains it picks the engine", /Auto picks/i.test(await page.locator(".modehint").innerText()), (await page.locator(".modehint").innerText()).slice(0, 60));

// switch to Precise → the CAD brain picker stays; switch to Generative → engine picker
await page.locator(".modebar .seg button", { hasText: "Precise" }).click();
check("A4 picking Precise selects it", (await onLabel()) === "Precise (CAD)", await onLabel());
await page.locator(".modebar .seg button", { hasText: "Generative" }).click();
check("A5 picking Generative selects it", (await onLabel()) === "Generative (AI mesh)", await onLabel());

// preference persists across reload
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".modebar .seg", { timeout: 60_000 });
check("A6 the chosen engine persists across reload", (await onLabel()) === "Generative (AI mesh)", await onLabel());

// back to Auto, persists
await page.locator(".modebar .seg button", { hasText: "Auto" }).click();
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".modebar .seg", { timeout: 60_000 });
check("A7 Auto persists across reload", (await onLabel()) === "Auto", await onLabel());

// Auto + an unmistakably organic ask → routed to Generative (heuristic, no key needed).
// The routing note posts before the (network) build runs, so assert the note + the mode flip.
await page.locator(".composer textarea").fill("a cute dragon figurine holding a sword");
await page.locator(".composer button.send, .composer .send, button[aria-label='Send']").first().click().catch(() => {});
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Auto chose/i.test(b.textContent || "")), null, { timeout: 30_000 }).catch(() => {});
const routed = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.textContent || "").find((t) => /Auto chose/i.test(t)) || "");
check("A8 Auto routes an organic ask to Generative", /Auto chose \*\*?Generative/i.test(routed) || /Generative \(AI mesh\)/.test(routed), routed.slice(0, 90) || "(no routing note)");

await browser.close();
if (fails.length) { console.log(`\n${fails.length} CHECK(S) FAILED`); process.exit(1); }
console.log("\nAll auto-mode checks passed.");
