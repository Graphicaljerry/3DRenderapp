// The credits chip has to move the moment money is spent — and never bounce back up.
//
// Two failure modes, both real:
//   * The chip only changed when OpenRouter's ledger endpoint was next polled, so a build
//     finished and the number sat still — "the counter is broken".
//   * OpenRouter's own figure lags a spend by minutes, so a poll right after a build
//     returns the PRE-spend number; accepting it verbatim made the chip jump back UP.
//
// Everything OpenRouter is intercepted in-page, so this drives the real provider path —
// the openrouter.ai request bodies, the SSE parser, the credits fetch — with no network.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

await page.addInitScript(() => {
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "openrouter", model: "auto" }));
  localStorage.setItem("moldable_llm_keys", JSON.stringify({ openrouter: "sk-or-probe" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});

// The account: $10 granted, $1.836 used → $8.164 left → 8,164 credits on the chip.
// `served` is what the ledger endpoint reports; it stays STALE after the build on
// purpose, because that is exactly what OpenRouter does for a few minutes.
let served = { total_credits: 10, total_usage: 1.836 };
let creditsHits = 0; // how many times the app has polled the ledger — the anchor below
const PROGRAM = "Here is the part.\n\n```js\nconst defaultParams = { width: 30, depth: 20, thickness: 5 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  const { drawRoundedRectangle } = replicad;\n  return drawRoundedRectangle(p.width, p.depth, 3).sketchOnPlane(\"XY\").extrude(p.thickness);\n}\n```";
await page.route("https://openrouter.ai/**", async (route) => {
  const url = route.request().url();
  if (url.includes("/credits")) {
    creditsHits += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: served }) });
  }
  if (url.includes("/models")) {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  }
  if (url.includes("/chat/completions")) {
    const sse = [
      { choices: [{ delta: { content: PROGRAM } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5000, completion_tokens: 400, cost: 0.00421 } },
    ].map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
    return route.fulfill({ contentType: "text/event-stream", body: sse });
  }
  return route.fulfill({ status: 404, body: "{}" });
});

await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
await page.locator(".launch-composer-foot .lo-trigger").click();
await page.locator(".lo-engines .pm-opt", { hasText: /functional/i }).click();
const planItem = page.locator(".pmenu-item", { hasText: /plan first/i });
if (await planItem.count()) await planItem.click();
await page.keyboard.press("Escape");

await page.locator(".launch-composer textarea").fill("A small plate 30 x 20 x 5 mm");
await page.locator(".launch-composer .send").click();
await page.waitForSelector(".balance-chip .balance-n", { timeout: 60_000 });
const hitsBeforeIdle = creditsHits;
await page.waitForFunction(() => !document.querySelector(".gen-pill"), null, { timeout: 180_000 });
// Anchor to the app's own post-build ledger poll COMPLETING, not to a sleep: the
// "no bounce" check below is only a check at all once the stale answer has actually
// arrived and been considered. Without this, removing the guard could still pass
// whenever the read raced ahead of the poll.
for (const t = Date.now() + 30_000; creditsHits <= hitsBeforeIdle && Date.now() < t; ) await page.waitForTimeout(150);
await page.waitForTimeout(600); // let the accepted/rejected figure paint

const chip = () => page.locator(".balance-chip .balance-n").innerText();
// The build streamed usage for every call it made (routing/clarify included may add
// more spends) — the chip must be BELOW the starting figure without waiting for any poll.
const after = (await chip()).replace(/,/g, "");
check("the app re-polled the ledger after the build", creditsHits > hitsBeforeIdle, `${creditsHits} poll(s)`);
check("the chip moved down the moment the build was paid for", Number(after) < 8164 && Number(after) > 8000, `${after} (was 8164)`);
check("the stale ledger poll did not bounce it back up", Number(after) <= 8164 - 4, after);

// ---- a top-up must show up even inside the lag window -----------------------------------
// The designed flow is: run low, add credits on openrouter.ai, come back, press refresh.
// That lands within 90s of the last spend — a manual refresh must accept the HIGHER figure.
served = { total_credits: 20, total_usage: 1.85 }; // topped up: $18.15 left → 18,150
await page.locator(".balance-chip").click();
await page.locator(".cp-refresh").click();
await page.waitForFunction(() => document.querySelector(".balance-chip .balance-n")?.textContent?.replace(/,/g, "") === "18150", null, { timeout: 15_000 }).catch(() => {});
const topped = (await chip()).replace(/,/g, "");
check("a manual refresh shows a top-up immediately", topped === "18150", topped);
await page.keyboard.press("Escape");

// ---- the provider catches up: a refresh must accept the fresh, lower figure ------------
served = { total_credits: 10, total_usage: 1.85 }; // $8.15 left → 8,150
await page.locator(".balance-chip").click();
await page.locator(".cp-refresh").click();
await page.waitForFunction(() => {
  const n = document.querySelector(".balance-chip .balance-n")?.textContent?.replace(/,/g, "");
  return n === "8150";
}, null, { timeout: 15_000 }).catch(() => {});
const reconciled = (await chip()).replace(/,/g, "");
check("a genuinely fresher figure is accepted", reconciled === "8150", reconciled);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
