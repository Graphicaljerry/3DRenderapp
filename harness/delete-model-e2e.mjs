// Right-click → Delete on the part, in the state people are actually in when they want it.
//
// The canvas menu let you delete a logo layer but not the part itself, so clearing the
// plate meant starting a new project and losing the conversation with it.
//
// The case that matters is the one this probe leads with: a part you JUST asked for is
// still an un-applied proposal — its mesh is `geometry` while `result` is whatever came
// before, which on a first build is null. A delete written against `result` no-ops there,
// and no-ops silently, which is indistinguishable from a dead menu item. That is exactly
// how the first cut of this shipped-to-nowhere, and it passed a probe that deleted an
// already-applied model.
//
// Deleting a proposal must also leave it a PROPOSAL when it comes back: a part that
// returns already committed has quietly used the delete to answer a question (Apply?
// Discard?) that the user never answered.
import { chromium } from "playwright";

const STUB = "http://localhost:8899";
await fetch(`${STUB}/_reset`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
const onPlate = () => page.evaluate(() => !!window.__viewerGeom?.());

await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
  // "ask" is the default and the interesting one: the build lands as a proposal.
  localStorage.setItem("moldable_ai_apply", "ask");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

const chip = page.locator(".lo-trigger");
if (!/no plan/i.test(await chip.innerText())) {
  await chip.click();
  await page.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
  await page.keyboard.press("Escape");
}
await page.locator(".launch-composer textarea").fill("A SPECIFIC bracket to delete");
await page.locator(".launch-composer .send").click();
await page.waitForFunction(() => /bracket to delete/i.test(document.body.innerText), null, { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
await page.waitForTimeout(2000);

check("the build landed as a proposal, not a commit", await page.locator(".ai-preview-bar").count() > 0);
check("there is a part on the plate to delete", await onPlate());

const rightClickPart = async () => {
  const box = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250); // the menu suppresses itself if the pointer was dragging
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.waitForSelector(".pmenu-item", { timeout: 10_000 });
};

await rightClickPart();
const items = await page.locator(".pmenu-item").allInnerTexts();
check("the part's menu offers Delete", items.some((t) => /^delete/i.test(t.trim())), items.map((t) => t.split("\n")[0]).join(" | "));
await page.locator(".pmenu-item", { hasText: /^Delete/ }).first().click();

// Poll rather than sleep: this is the assertion the silent no-op defeated, so it must
// not be able to pass on a slow frame.
await page.waitForFunction(() => !window.__viewerGeom?.(), null, { timeout: 20_000 }).catch(() => {});
check("deleting a still-proposed part clears the plate", !(await onPlate()));
check("the conversation is untouched", await page.evaluate(() => /bracket to delete/i.test(document.body.innerText)));

const putBack = page.locator("button", { hasText: /put it back/i }).first();
check("the receipt offers a way back", await putBack.count() > 0);
if (await putBack.count()) {
  await putBack.click();
  await page.waitForFunction(() => !!window.__viewerGeom?.(), null, { timeout: 20_000 }).catch(() => {});
  check("Put it back returns the part", await onPlate());
  check("…and it is still a proposal, not silently applied", await page.locator(".ai-preview-bar").count() > 0);
}

check("no uncaught exception took the render down", pageErrors.length === 0, pageErrors.join(" | "));

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
