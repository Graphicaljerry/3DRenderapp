// Mobile UI consolidation, on a phone-sized viewport:
//  - the launchpad header no longer carries Privacy/Terms (they truncated "Sign in"),
//    and a standing footer does — for RETURNING visitors too, not just first-run.
//  - the workspace top row is a wordmark and a face: "+ New chat" and the light/dark
//    switch moved into the account menu, which now opens signed-OUT as well.
//  - that menu dismisses by outside tap (the old panel closed on mouse-leave, which a
//    finger cannot do) and stays inside the viewport.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };

await page.addInitScript(() => localStorage.setItem("moldable_signin_prompted", "1"));
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

// ---- launchpad: legal out of the header, into a footer that always renders --------
check("header carries no legal links", await page.locator(".launch-top .legal-link").count() === 0);
check("footer carries Privacy and Terms", await page.locator(".legal-foot .legal-link").count() === 2,
  await page.locator(".legal-foot").innerText().catch(() => "(no footer)"));
const hrefs = await page.locator(".legal-foot .legal-link").evaluateAll((a) => a.map((x) => new URL(x.href).pathname));
check("…pointing at the real static pages", hrefs.some((h) => h.endsWith("privacy.html")) && hrefs.some((h) => h.endsWith("terms.html")), hrefs.join(" "));

// The truncation Jerry photographed: the button's text must fit the button.
const signin = page.locator(".launch-top-right button", { hasText: /sign in/i }).first();
const fit = await signin.evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth, t: el.innerText }));
check("Sign in is no longer truncated", fit.s <= fit.c + 1, `"${fit.t}" scroll ${fit.s} vs client ${fit.c}`);

// The claim this footer exists for: a RETURNING visitor still gets it. `veteran` is
// `!!accountEmail || recent.length >= 2` (App.tsx), so two saved projects is the honest
// way in without an account — and it is the state that hides the first-run launch-foot,
// which is exactly why the legal links could not live in there.
await page.evaluate(async () => {
  const { newProject, putProject } = await import("/src/store/projects.ts");
  for (const n of ["Bracket", "Spacer"]) await putProject(newProject(n, "replicad"));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
await page.waitForFunction(() => document.querySelectorAll(".launch-recents .lp-card, .launch-recents a, .launch-recents button").length >= 2, null, { timeout: 30_000 }).catch(() => {});
const asVeteran = await page.evaluate(() => ({
  firstRunFooter: !!document.querySelector(".launch-foot"),
  legal: document.querySelectorAll(".legal-foot .legal-link").length,
}));
check("a returning visitor has no first-run footer", !asVeteran.firstRunFooter, JSON.stringify(asVeteran));
check("…but still gets Privacy and Terms", asVeteran.legal === 2, JSON.stringify(asVeteran));

await page.screenshot({ path: "shot-mobile-launch.png" });

// ---- workspace: one door instead of three ----------------------------------------
await page.locator("button", { hasText: /open an empty workspace/i }).first().click();
await page.waitForSelector(".topbar", { timeout: 30_000 });
check("no stand-alone New chat button in the top row", await page.locator(".topbar .primary.sm").count() === 0);
check("no stand-alone theme toggle in the top row", await page.locator(".topbar .theme-toggle").count() === 0);

// Signed OUT, the menu must still open — it used to be gated behind an account.
await page.locator(".topbar .profile").click();
const menu = page.locator(".pmenu.account-menu");
const opened = await menu.waitFor({ timeout: 10_000 }).then(() => true, () => false);
const items = opened ? (await menu.innerText()).split("\n").map((s) => s.trim()).filter(Boolean) : [];
check("the account menu opens when signed out", opened, items.join(" · "));
for (const want of ["New chat", "Templates", "Library", "Settings"]) {
  check(`…and carries ${want}`, items.includes(want));
}
check("…and the light/dark switch", items.some((t) => /^(Light|Dark) mode$/.test(t)));

// It must sit inside the phone's screen, not off its edge.
const box = await menu.boundingBox();
check("…and stays inside the viewport", box.x >= 0 && box.x + box.width <= 390, `x ${Math.round(box.x)} w ${Math.round(box.width)}`);
await page.screenshot({ path: "shot-mobile-menu.png" });

// The switch actually switches.
const before = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
await menu.locator("button", { hasText: /^(Light|Dark) mode$/ }).click();
await page.waitForTimeout(400);
const after = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
check("the menu's switch changes the theme", before !== after, `${before || "(unset)"} → ${after || "(unset)"}`);
check("…and picking an item closes the menu", await page.locator(".pmenu.account-menu").count() === 0);

// A second tap on the avatar closes it. AnchoredMenu's outside-mousedown handler used to
// fire before the trigger's own click, so the press that should have shut the menu shut
// it and immediately re-opened it — the first gesture anyone tries on a phone.
await page.locator(".topbar .profile").click();
await menu.waitFor({ timeout: 10_000 });
await page.locator(".topbar .profile").click();
await page.waitForTimeout(400);
check("a second tap on the avatar closes the menu", await page.locator(".pmenu.account-menu").count() === 0);

// The touch dismissal the old panel could not do: tap outside.
//
// Tapped on the canvas by its own box rather than at a hand-picked x,y — a magic
// coordinate is a guess about layout, and this one silently stopped landing on the
// element it was chosen for. The settle wait matters too: AnchoredMenu arms its
// outside-tap listener in a setTimeout after mount, so a tap fired the instant the
// menu attaches can beat the listener and prove nothing.
await page.locator(".topbar .profile").click();
await menu.waitFor({ timeout: 10_000 });
await page.waitForTimeout(300);
const canvas = await page.locator(".viewer, canvas").first().boundingBox();
await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.75);
await page.waitForTimeout(500);
check("an outside tap closes the menu", await page.locator(".pmenu.account-menu").count() === 0);

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll mobile-UI checks passed.");
