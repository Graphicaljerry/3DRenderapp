// Touch/selection policy e2e: chrome is unselectable (the iPad blue-sweep fix),
// content opts back in, and a real drag across the page selects NOTHING. Plus a
// phone-width (390px) overflow audit of the stacked layout.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

{
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.locator(".overlay").getByTitle("Build the box with lid template").click();
  await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("box"), null, { timeout: 120_000 });
  await page.waitForTimeout(500);

  const sel = await page.evaluate(() => ({
    body: getComputedStyle(document.body).userSelect,
    toolbar: getComputedStyle(document.querySelector(".viewer-head")).userSelect,
    canvas: getComputedStyle(document.querySelector(".viewerCanvas canvas")).userSelect,
    bubble: getComputedStyle(document.querySelector(".msg .bubble")).userSelect,
    textarea: getComputedStyle(document.querySelector(".composer textarea")).userSelect,
    tap: getComputedStyle(document.body).webkitTapHighlightColor ?? "n/a",
    overscroll: getComputedStyle(document.documentElement).overscrollBehavior,
  }));
  check("chrome is unselectable (body/toolbar/canvas)", sel.body === "none" && sel.toolbar === "none" && sel.canvas === "none", JSON.stringify(sel));
  check("chat + composer opt back in to selection", sel.bubble === "text" && sel.textarea === "text");
  check("overscroll disabled (no rubber-band while orbiting)", sel.overscroll === "none", sel.overscroll);

  // A drag that starts on a toolbar label and sweeps across the app must select nothing.
  const head = await page.locator(".viewer-head").boundingBox();
  await page.mouse.move(head.x + 40, head.y + 12);
  await page.mouse.down();
  await page.mouse.move(head.x + 500, head.y + 400, { steps: 12 });
  await page.mouse.up();
  const selected = await page.evaluate(() => String(window.getSelection() ?? ""));
  check("sweep-drag across the app selects no text", selected.trim().length === 0, JSON.stringify(selected.slice(0, 40)));

  // Chat text is still copyable: select inside a bubble works.
  const bub = await page.locator(".msg .bubble").first().boundingBox();
  await page.mouse.move(bub.x + 10, bub.y + 10);
  await page.mouse.down();
  await page.mouse.move(bub.x + 200, bub.y + 12, { steps: 6 });
  await page.mouse.up();
  const bubSel = await page.evaluate(() => String(window.getSelection() ?? ""));
  check("chat bubbles remain selectable/copyable", bubSel.trim().length > 3, JSON.stringify(bubSel.slice(0, 30)));
  await page.close();
}

// ---- Phone-width audit (stacked layout): nothing crosses the viewport. ----
for (const [name, w, h] of [["iphone", 390, 844], ["iphone-max", 430, 932]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 2 || r.left < -2) bad.push({ sel: (el.className?.toString?.() || el.tagName).slice(0, 50), l: Math.round(r.left), r: Math.round(r.right) });
    }
    return { hscroll: document.documentElement.scrollWidth > vw + 2, bad: bad.slice(0, 8), vw };
  });
  check(`${name} (${w}px): no horizontal overflow`, !report.hscroll && report.bad.length === 0, JSON.stringify(report.bad));
  await page.screenshot({ path: `shot-${name}.png` });
  await page.close();
}

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll touch-policy checks passed.");
