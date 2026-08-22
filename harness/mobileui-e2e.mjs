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

// A returning visitor (veteran) must still get the footer — it sits outside launch-foot.
await page.evaluate(() => localStorage.setItem("moldable_seen_launch", "1"));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
check("the footer survives a reload", await page.locator(".legal-foot .legal-link").count() === 2);

await page.screenshot({ path: "shot-mobile-launch.png" });

// ---- workspace: one door instead of three ----------------------------------------
await page.locator("button", { hasText: /open an empty workspace/i }).first().click();
await page.waitForSelector(".topbar", { timeout: 30_000 });
check("no stand-alone New chat button in the top row", await page.locator(".topbar .primary.sm").count() === 0);
check("no stand-alone theme toggle in the top row", await page.locator(".topbar .theme-toggle").count() === 0);

// Signed OUT, the menu must still open — it used to be gated behind an account.
await page.locator(".topbar .profile").click();
const menu = page.locator(".pmenu.account-menu");
await menu.waitFor({ timeout: 10_000 });
const items = (await menu.innerText()).split("\n").map((s) => s.trim()).filter(Boolean);
check("the account menu opens when signed out", true, items.join(" · "));
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

// The touch dismissal the old panel could not do: tap outside.
await page.locator(".topbar .profile").click();
await menu.waitFor({ timeout: 10_000 });
await page.mouse.click(195, 700);
await page.waitForTimeout(400);
check("an outside tap closes the menu", await page.locator(".pmenu.account-menu").count() === 0);

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll mobile-UI checks passed.");
