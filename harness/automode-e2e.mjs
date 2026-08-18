// The composer engine switch now has three options — Auto (default), Precise (CAD),
// Generative (AI mesh) — Auto lets the app classify each new ask and pick the engine.
import { chromium } from "playwright";
import { enterWorkspace } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

// fresh context → localStorage is empty, so no stored preference → Auto is the default
// (don't clear the pref in initScript — it runs on every reload and would break persistence)
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
// The app boots on the Launchpad — `entered` is in-session only — so waiting for
// workspace chrome straight after a goto or a reload waited 60 s for something that was
// never coming. Every one of the three load points here needs the door clicked.
await enterWorkspace(page);
await page.waitForSelector(".modebar .seg", { timeout: 60_000 });

const seg = page.locator(".modebar .seg button");
const labels = await seg.allInnerTexts();
check("A1 three engine options: Auto · Precise · Generative", labels.length === 3 && labels[0] === "Auto" && /Precise/.test(labels[1]) && /Generative/.test(labels[2]), JSON.stringify(labels));
const onLabel = async () => (await page.locator(".modebar .seg button.on").innerText()).trim();
check("A2 Auto is the default selection", (await onLabel()) === "Auto", await onLabel());
// A3 RETIRED, not rewritten. The "Auto picks…" hint was deliberately deleted: it
// "used to restate the mode on every idle frame … which is what the ? beside Auto is
// for, and cost a whole row above the input for nothing" (Workspace.tsx). .modehint now
// renders only when it says something the controls do not already show — what Auto
// actually CHOSE, the photo/markup states, and generative pricing. Asserting the old copy
// is asking the app to keep a line it decided was noise; the thing this guarded is gone
// as a concept, so the check goes with it rather than being loosened into something
// trivially true. What Auto chose is covered by A8 below and by routing-e2e.

// switch to Precise → the CAD brain picker stays; switch to Generative → engine picker
await page.locator(".modebar .seg button", { hasText: "Precise" }).click();
check("A4 picking Precise selects it", (await onLabel()) === "Precise (CAD)", await onLabel());
await page.locator(".modebar .seg button", { hasText: "Generative" }).click();
check("A5 picking Generative selects it", (await onLabel()) === "Generative (AI mesh)", await onLabel());

// preference persists across reload
await page.reload({ waitUntil: "domcontentloaded" });
await enterWorkspace(page);
await page.waitForSelector(".modebar .seg", { timeout: 60_000 });
check("A6 the chosen engine persists across reload", (await onLabel()) === "Generative (AI mesh)", await onLabel());

// back to Auto, persists
await page.locator(".modebar .seg button", { hasText: "Auto" }).click();
await page.reload({ waitUntil: "domcontentloaded" });
await enterWorkspace(page);
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
