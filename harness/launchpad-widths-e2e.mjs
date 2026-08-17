// The Launchpad composer's bottom row must never sit under the send button.
//
// The row (attach, Research, Plan) is absolutely positioned at the composer's
// bottom-LEFT; the send button is absolutely positioned at its bottom-RIGHT and comes
// later in the DOM, so when the row outgrows the gap between them it does not push or
// wrap — it slides underneath and the send circle paints on top. The covered part of a
// chip then taps as SEND, which fires a build instead of toggling the thing you aimed at.
//
// This is width arithmetic, so it can only be caught by measuring at the widths people
// actually hold: 320 (SE 1st gen), 344 (Fold cover screen), 360 (the most common Android
// width), 375 (SE 2/3, 13 mini), 390 (iPhone 13/14/15). The plan-first probe runs at
// 1440 and can never see any of it.
import { chromium } from "playwright";

const WIDTHS = [320, 344, 360, 375, 390, 414];
// Not just "no overlap": a row that clears by a hair is one chip away from the bug
// again, and the failure is silent — it looks fine on the phone you happened to test.
// 320 is the tightest width the app claims, and it is the one this floor is set for.
const MIN_CLEAR = 8;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

for (const width of WIDTHS) {
  const H = { 320: 568, 344: 882, 360: 800, 375: 812, 390: 844, 414: 896 };
  const page = await browser.newPage({ viewport: { width, height: H[width] ?? 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.setItem("moldable_theme", "dark");
    localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
    localStorage.setItem("moldable_signin_prompted", "1");
    // Four projects, so the shelf is the height it really is for anyone who has used
    // the app. The vertical check below is meaningless against an empty one.
    const thumb = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#eee"/></svg>');
    const open = indexedDB.open("moldable", 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("projects")) {
        const st = db.createObjectStore("projects", { keyPath: "id" });
        st.createIndex("by-updatedAt", "updatedAt");
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("projects", "readwrite");
      ["Phone stand", "Bracket", "Pen holder", "Cable clip"].forEach((n, i) => tx.objectStore("projects").put({
        id: "seed" + i, name: n, engine: "replicad", thumb,
        updatedAt: Date.now() - i * 3600e3, createdAt: Date.now(), messages: [], versions: [], headId: null,
      }));
    };
  });
  await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });
  await page.waitForSelector(".launch-recent", { timeout: 20_000 }).catch(() => {});

  const m = await page.evaluate(() => {
    const send = document.querySelector(".launch-composer .send");
    const sr = send.getBoundingClientRect();
    // Every child of the row, measured individually: the row's own box can look innocent
    // while a flex child overflows it (the row has no right-edge constraint).
    const kids = [...document.querySelectorAll(".launch-composer-foot > *")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { label: (el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 22), right: r.right, top: r.top, bottom: r.bottom };
      });
    // Vertical overlap too: a chip sitting well below the send button would not collide
    // even if it passed it horizontally.
    const vOverlap = (k) => Math.min(k.bottom, sr.bottom) - Math.max(k.top, sr.top) > 0;
    const clash = kids.filter((k) => k.right > sr.left && vOverlap(k));
    return {
      sendLeft: sr.left,
      last: kids[kids.length - 1],
      clearance: Math.round((sr.left - Math.max(...kids.map((k) => k.right))) * 10) / 10,
      clash: clash.map((k) => `${k.label} overruns by ${Math.round(k.right - sr.left)}px`),
      // Nothing may spill off the right edge of the screen either.
      offscreen: kids.filter((k) => k.right > window.innerWidth).map((k) => k.label),
    };
  });

  check(`${width}px: composer row clears the send button by ${MIN_CLEAR}px+`,
    m.clash.length === 0 && m.clearance >= MIN_CLEAR,
    m.clash.length ? m.clash.join("; ") : `${m.clearance}px clear, last chip "${m.last.label}"`);
  check(`${width}px: nothing spills off screen`, m.offscreen.length === 0, m.offscreen.join(", "));

  // Vertical fit. The headline grew and the project tiles shrank to pay for it, so the
  // thing to guard is that the shelf and the row of links under it stay ON SCREEN — the
  // whole point of the trade. Measured with a populated grid, because an empty Launchpad
  // fits trivially and would let this pass while the real screen scrolled.
  const v = await page.evaluate(() => {
    const t = document.querySelector(".launch-tabs");
    const cards = document.querySelectorAll(".launch-recent").length;
    return { tabsBottom: t ? Math.round(t.getBoundingClientRect().bottom) : null, vh: innerHeight, cards };
  });
  // Only on screens tall enough to be a fair ask. 320x568 is the 2016 SE: a third
  // shorter than a current phone, and squeezing the headline and the shelf into it would
  // cost every other device the design. It scrolls there, deliberately.
  if (v.cards >= 4 && v.vh >= 700) {
    check(`${width}px: the project shelf and its links stay above the fold`,
      v.tabsBottom !== null && v.tabsBottom <= v.vh, `links end at ${v.tabsBottom} of ${v.vh}`);
  }
  await page.close();
}

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
