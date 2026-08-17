// The build number has to be readable on the device you are holding.
//
// Three media queries hid `.build-tag` — and they meant the STATUSBAR's copy, which is a
// diagnostic competing for room in a scrolling row of real controls. The selector was
// bare, so it also took down the version beside the wordmark on the Launchpad, at every
// phone width and in iPad portrait.
//
// That is the one place a phone user can answer "did my update actually land?", and it
// went missing in the same week a docs-only commit desynced the number I was quoting from
// the number the app was showing. Reported by Jerry: "I don't see the version number on
// mobile size."
//
// The check hit-tests the chip at its own centre rather than trusting display/opacity: an
// element can be in the DOM, styled visible, and still be covered by the header bar or
// pushed off the edge — all of which read as "missing" to the person looking at it.
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };
for (const [tag, w, h] of [["phone 390", 390, 844], ["phone 320", 320, 812], ["iPad portrait 834", 834, 1112], ["desktop 1280", 1280, 950]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(() => {
    localStorage.setItem("moldable_theme", "dark");
    localStorage.setItem("moldable_signin_prompted", "1");
  });
  await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60000 });
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const t = document.querySelector(".launch-top .build-tag");
    if (!t) return { present: false };
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    const mid = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return {
      present: true, text: t.textContent.trim(), display: cs.display, visibility: cs.visibility,
      w: Math.round(r.width), h: Math.round(r.height),
      onScreen: r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      // not merely in the DOM — actually the thing you'd hit at its own centre
      hittable: !!mid && (mid === t || t.contains(mid)),
    };
  });
  check(`${tag}: the version is visible on the launchpad`,
    m.present && m.display !== "none" && m.w > 0 && m.onScreen && m.hittable, JSON.stringify(m));
  await page.close();
}
console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await b.close();
process.exit(fails.length ? 1 : 0);
