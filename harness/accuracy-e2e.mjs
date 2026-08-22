// The five accuracy fixes, through the real UI.
//
// 1. A full-regeneration AI edit must keep the user's committed slider values AND the
//    ops they added by hand (here: the elephant-foot chamfer). Before, the regen path
//    rebuilt from bare code — sliders reverted, the op chain vanished, and the loss was
//    baked into the committed version with only "Updated the model" on screen.
// 2. A clean build at the WRONG size gets a caution naming the missing figure; a build
//    at the right size stays quiet.
// 3. extractParams refuses ambiguity: a computed default, a nested object and a number
//    inside a comment must produce NO slider rather than a wrong one.
// 4. Part fit reaches the model on an ordinary Precise build, not only the guided flow.
import { chromium } from "playwright";
import { newChat } from "./enter.mjs";

await fetch("http://localhost:8899/_reset");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
  // Apply automatically: this probe is about what lands in the committed version.
  localStorage.setItem("moldable_ai_apply", "auto");
});
const bodies = [];
await page.route("http://localhost:8899/**", async (route) => {
  const d = route.request().postData();
  if (d) bodies.push(d);
  await route.continue();
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

// Plan off — these probes are about the build request, not the spec card.
const chip = page.locator(".launch-composer-foot .lo-trigger");
await chip.click();
await page.locator(".lo-engines .pm-opt", { hasText: /functional/i }).click();
const planItem = page.locator(".pmenu-item", { hasText: /plan first/i });
if (await planItem.count()) await planItem.click();
await page.keyboard.press("Escape");

const idle = () => page.waitForFunction(() => !document.querySelector(".gen-pill") && !document.querySelector(".bubble-open"), null, { timeout: 240_000 });
// ALL assistant bubbles: the plan card stays in the transcript below the reply, so the
// last bubble is often the card, not the text being asserted on.
const chatText = () => page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble, .msg.assistant .bubble-open")].map((b) => b.innerText).join(" | "));
const sbDims = () => page.evaluate(() => document.querySelector(".statusbar .dims")?.textContent ?? "");
const send = async (text, first = false) => {
  const box = page.locator(".launch-composer textarea, .composer textarea").first();
  await box.fill(text);
  await box.press("Enter");
  if (first) {
    // Every NEW part deliberately resets plan mode to on (App's startFresh), so each
    // fresh chat earns a plan card — answer it, don't fight the design — and skipping
    // the plan still runs clarify, so a Quick check card follows. Both are answered by
    // ONE poll: whichever door is on screen gets clicked until the build starts.
    for (const t = Date.now() + 60_000; Date.now() < t; ) {
      if (await page.locator(".gen-pill").count()) break;
      const plan = page.locator("button", { hasText: /skip the plan/i }).first();
      const quick = page.locator("button", { hasText: /build what i asked for/i }).first();
      if (await plan.count()) { await plan.click({ timeout: 5000 }).catch(() => {}); console.log("  [send] answered the plan card"); }
      else if (await quick.count()) { await quick.click({ timeout: 5000 }).catch(() => {}); console.log("  [send] answered the quick check"); }
      await page.waitForTimeout(400);
    }
  }
  await page.waitForSelector(".gen-pill", { timeout: 15_000 }).catch(() => {});
  await idle();
  await page.waitForTimeout(900);
};
/** The committed HEAD version's op types + params, straight from the store. */
const headSource = () => page.evaluate(async () => {
  const mod = await import("/src/store/projects.ts");
  const all = await mod.listProjects();
  const proj = all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const head = proj?.versions?.[proj.head ?? proj.versions.length - 1] ?? proj?.versions?.at(-1);
  return { ops: (head?.ops ?? []).map((o) => o.type), params: head?.params ?? null, code: head?.code ?? proj?.code ?? "" };
});

// ---- 1) build, then check the fit directive reached the request --------------------
await send("A small plate 30 x 20 x 5 mm", true);
check("baseline build lands", /30 × 20 × 5/.test(await sbDims()), await sbDims());
// The BUILD request, not the clarify/quick-check one that precedes it — only the build
// carries the replicad system prompt, and only it gets the fit directive.
const buildReq = bodies.find((b) => /replicad/i.test(b) && /small plate/.test(b)) ?? "";
check("Part fit directive rides on an ordinary Precise build", /\[Fit: snug/.test(buildReq));
check("right-size build stays quiet", !/⚠/.test(await chatText()), (await chatText()).slice(-90));

// ---- 2) commit a slider change the next edit must not touch ------------------------
await page.getByRole("button", { name: "Adjust", exact: true }).click();
const thickRow = page.locator(".prow", { hasText: /thickness/i }).first();
await thickRow.waitFor({ timeout: 20_000 });
const inp = thickRow.locator(".pf-input");
await inp.fill("8");
await inp.press("Enter");
await page.waitForFunction(() => /30 × 20 × 8/.test(document.querySelector(".statusbar .dims")?.textContent ?? ""), null, { timeout: 90_000 });
check("slider commit applied", true);

// ---- 3) add a real op (elephant-foot chamfer) --------------------------------------
await page.getByRole("button", { name: "Printability", exact: true }).click();
const bevel = page.locator("button", { hasText: /elephant-foot bevel/i }).first();
await bevel.waitFor({ timeout: 20_000 });
await bevel.click();
await page.waitForFunction(async () => {
  const mod = await import("/src/store/projects.ts");
  const all = await mod.listProjects();
  const proj = all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const head = proj?.versions?.[proj.head ?? proj.versions.length - 1] ?? proj?.versions?.at(-1);
  return (head?.ops ?? []).some((o) => o.type === "chamferBottom");
}, null, { timeout: 90_000 });
check("chamfer op committed", true);

// ---- 4) the AI edit through the FULL REGEN path must keep both ---------------------
// REGENPATH makes the stub 500 the edit-mode request, so the app falls through to the
// regeneration loop — the path that used to lose everything.
await send("make the small plate WIDER, REGENPATH please");
const afterDims = await sbDims();
check("regen edit widened the part", /50 × 20/.test(afterDims), afterDims);
check("…and the committed slider value SURVIVED it", /50 × 20 × 8/.test(afterDims), afterDims);
const head = await headSource();
check("…and the hand-added chamfer op survived into the committed version", head.ops.includes("chamferBottom"), JSON.stringify(head.ops));
check("…with the kept value recorded, not the whole map", !!head.params && head.params.thickness === 8, JSON.stringify(head.params));

// ---- 5) wrong-size build earns the caution -----------------------------------------
await newChat(page);
// New chat empties the workspace chat in place — the composer survives. Wait for
// the transcript to actually clear so the send lands in the fresh conversation.
await page.waitForFunction(() => document.querySelectorAll(".msg").length === 0, null, { timeout: 30_000 });
await send("A SHORTPART bracket exactly 75 mm wide", true);
// Waited for, not sampled: the caution is appended when the reply settles.
await page.waitForFunction(() => /⚠/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
const warn = await chatText();
check("wrong-size build is cautioned, naming the figure", /⚠/.test(warn) && /75 mm/.test(warn), warn.slice(-140));

// ---- 6) extractParams refuses ambiguity through the real Adjust panel --------------
await newChat(page);
await page.waitForFunction(() => document.querySelectorAll(".msg").length === 0, null, { timeout: 30_000 });
await send("A TRICKY bracket please", true);
// Prove the TRICKY build landed before reading its sliders — Adjust would otherwise
// show whatever project was on screen last.
await page.waitForFunction(() => /44 × 22 × 9/.test(document.querySelector(".statusbar .dims")?.textContent ?? ""), null, { timeout: 90_000 });
await page.getByRole("button", { name: "Adjust", exact: true }).click();
await page.locator(".prow").first().waitFor({ timeout: 20_000 });
const rows = await page.evaluate(() => [...document.querySelectorAll(".prow .pn-human")].map((e) => e.textContent?.trim().toLowerCase()));
check("clean params get sliders", ["width", "depth", "height", "wall"].every((k) => rows.some((r) => r?.includes(k))), JSON.stringify(rows));
check("computed default gets NO slider (no wrong number beats a slider)", !rows.some((r) => r?.includes("half")), JSON.stringify(rows));
check("nested object's keys don't leak as sliders", !rows.some((r) => r?.includes("dia")), JSON.stringify(rows));

await page.screenshot({ path: "shot-accuracy.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll accuracy checks passed.");
