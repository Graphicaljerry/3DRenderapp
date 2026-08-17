// Which photo is the FRONT one, and can the user change it.
//
// Index 0 is load-bearing: the mesh engines read it as the front view and the named view
// slots literally label themselves "Front — the reference photo above". Until now it was
// whatever order the file picker happened to return, with no way to correct it short of
// removing every photo and re-picking them in the right sequence.
//
// The check reads the DOMINANT COLOUR of each thumbnail off a canvas rather than trusting
// src attributes or DOM order — a promote that re-rendered the list without actually
// moving the underlying blobs would pass any structural assertion and still send the
// wrong picture to the engine.
//
// Also covers the "?" hint, which was a bare `title=` attribute: a desktop-only
// affordance, so on the phone people actually photograph parts with, the shooting advice
// did not exist at all.
import { chromium } from "playwright";
await fetch("http://localhost:8899/_reset").catch(() => {});
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 1280, height: 950 } });
const fails = [];
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails.push(n); };
// Three photos with distinguishable dominant colours so a swap is provable.
const COLS = ["#0000ff", "#ff0000", "#00ff00"];
const P = [];
for (const c of COLS) {
  P.push(Buffer.from(await page.evaluate(async (col) => {
    const cv = document.createElement("canvas"); cv.width = 200; cv.height = 200;
    const x = cv.getContext("2d"); x.fillStyle = col; x.fillRect(0, 0, 200, 200);
    return cv.toDataURL("image/png").split(",")[1];
  }, c), "base64"));
}
await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60000 });
await page.locator(".launch-composer input[type=file]").first().setInputFiles(P.map((buf, i) => ({ name: `p${i}.png`, mimeType: "image/png", buffer: buf })));
await page.waitForSelector(".photostrip", { timeout: 20000 });
await page.waitForTimeout(600);

// Read the dominant colour of each thumbnail by drawing it to a canvas.
const colours = () => page.evaluate(async () => {
  const imgs = [...document.querySelectorAll(".ps-thumbs .refthumb img")];
  return Promise.all(imgs.map((im) => new Promise((res) => {
    const c = document.createElement("canvas"); c.width = c.height = 8;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0, 8, 8);
    const d = g.getImageData(3, 3, 1, 1).data;
    res(`${d[0]},${d[1]},${d[2]}`);
  })));
});
const before = await colours();
check("three photos attached, front first", before.length === 3, before.join(" | "));
check("only non-front photos are promotable", await page.locator(".ps-imgbtn").count() === 2);

// Promote the THIRD photo (green) to front.
await page.locator(".ps-imgbtn").nth(1).click();
await page.waitForTimeout(500);
const after = await colours();
check("the clicked photo became the front", after[0] === before[2], `front was ${before[0]}, now ${after[0]} (clicked ${before[2]})`);
check("the old front took the clicked photo's slot", after[2] === before[0], after.join(" | "));
check("the untouched photo did not move", after[1] === before[1], `${before[1]} -> ${after[1]}`);
check("still exactly three photos", after.length === 3);

// The hint must open on a click (touch has no hover).
await page.locator(".photostrip .hint").click();
await page.waitForTimeout(300);
const popped = await page.locator(".hint-pop").count();
check("the ? opens its text on click, not just hover", popped === 1);
const txt = popped ? await page.locator(".hint-pop").innerText() : "";
check("…and the text is the shooting advice", /ruler|coin|JPG|light/i.test(txt), txt.slice(0, 70));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Escape closes it", await page.locator(".hint-pop").count() === 0);

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await b.close();
process.exit(fails.length ? 1 : 0);
