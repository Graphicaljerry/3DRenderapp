// Separation polish e2e: tutorial message posts ONCE (repeats are quiet), the
// separated part keeps the model's grey (no green recolor), and the transform
// gizmo sits ON the selected part, not off at the model origin.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the box with lid template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("box"), null, { timeout: 120_000 });
await page.waitForTimeout(600);

const tutorials = () => page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].filter((b) => (b.textContent ?? "").includes("Separated the model into")).length);

// 1) Separate → ONE tutorial message.
await page.getByRole("button", { name: "Objects", exact: true }).click();
await page.waitForSelector(".layers-panel");
await page.getByRole("button", { name: /Separate 2 parts/ }).click();
await page.waitForFunction(() => document.body.innerText.includes("Part 2"), null, { timeout: 60_000 });
await page.waitForTimeout(500);
check("first separation posts the tutorial once", (await tutorials()) === 1, `${await tutorials()} messages`);

// 2) Part keeps the model grey — no big green (#7fc4b9) region.
const canvas = page.locator(".viewerCanvas canvas");
const scan = async () => {
  const b64 = (await canvas.screenshot()).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let green = 0, redX = 0, redN = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (Math.abs(r - 0x7f) < 22 && Math.abs(gg - 0xc4) < 22 && Math.abs(b - 0xb9) < 22) green++;
      if (r > 190 && gg < 90 && b < 90) { redX += x; redN++; } // gizmo's red arrow/ring
    }
    return { green, gizmoX: redN ? redX / redN : -1, redN, w: c.width };
  }, b64);
};
const s1 = await scan();
// the mint "Merge all into model" button contributes a few hundred px — a green LID was ~50k
  check("separated part keeps the model grey (no green recolor)", s1.green < 3000, `${s1.green} green px`);

// 3) Gizmo is centred on the selected part (the lid, right of centre) — before the
// fix it sat at the mesh origin near the model, left of/at centre.
check("gizmo sits on the selected part", s1.redN > 50 && s1.gizmoX > s1.w * 0.5, `red centroid x=${Math.round(s1.gizmoX)} of ${s1.w}`);
await page.screenshot({ path: "shot-sandbox2.png" });

// 4) Regroup → separate again → still just ONE tutorial (repeat is quiet).
await page.getByRole("button", { name: "Regroup parts", exact: true }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /Separate 2 parts/ }).click();
await page.waitForFunction(() => document.body.innerText.includes("Part 2"), null, { timeout: 60_000 });
await page.waitForTimeout(500);
check("repeat separation stays quiet", (await tutorials()) === 1, `${await tutorials()} tutorial messages`);

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll separation-polish checks passed.");
