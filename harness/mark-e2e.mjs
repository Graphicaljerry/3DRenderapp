// Mark & ask e2e: draw a circle on the viewport → annotated screenshot in the composer.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Templates", exact: true }).click();
await page.locator(".overlay").getByTitle("Build the phone stand template").click();
await page.waitForFunction(() => document.querySelector(".msg.assistant .bubble")?.textContent?.includes("phone stand"), null, { timeout: 120_000 });

// 1) Enter Mark mode: overlay + hint appear.
await page.getByRole("button", { name: "Mark", exact: true }).click();
await page.waitForSelector(".mark-overlay");
check("mark overlay + hint shown", (await page.locator(".mark-hint").innerText()).includes("Draw around"));

// 2) Draw a rough circle over the model.
const ov = page.locator(".mark-overlay canvas");
const b = await ov.boundingBox();
const cx = b.x + b.width * 0.5, cy = b.y + b.height * 0.5, r = Math.min(b.width, b.height) * 0.18;
await page.mouse.move(cx + r, cy);
await page.mouse.down();
for (let i = 1; i <= 28; i++) {
  const a = (i / 28) * Math.PI * 2;
  await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
}
await page.mouse.up();

// 3) The composer now holds a marked screenshot; mark mode exited.
await page.waitForSelector(".imgchip img", { timeout: 30_000 });
check("marked screenshot attached to composer", (await page.locator(".imgchip span").first().innerText()).includes("marked screenshot"));
check("mark mode exits after drawing", (await page.locator(".mark-overlay").count()) === 0);
check("no Measure button on a markup chip", (await page.locator(".imgchip-measure").count()) === 0);

// 4) The image really is the view + a red stroke: decode and scan pixels.
const px = await page.evaluate(async () => {
  const img = document.querySelector(".imgchip img");
  const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let red = 0, nonBg = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200 && d[i + 1] < 110 && d[i + 2] < 110) red++;
    if (Math.abs(d[i] - d[i + 1]) > 12 || Math.abs(d[i + 1] - d[i + 2]) > 12) nonBg++;
  }
  return { w: bmp.width, h: bmp.height, red, total: d.length / 4 };
});
check("screenshot has real size and a red marker stroke", px.w >= 600 && px.red > 300, JSON.stringify(px));

// 5) Esc cancels a fresh mark session without attaching.
await page.getByRole("button", { name: "Mark", exact: true }).click();
await page.waitForSelector(".mark-overlay");
await page.keyboard.press("Escape");
check("Esc cancels mark mode", (await page.locator(".mark-overlay").count()) === 0);

// 6) Removing the chip clears it.
await page.locator(".imgchip button[aria-label='Remove reference image']").click();
check("chip removable", (await page.locator(".imgchip").count()) === 0);

await page.screenshot({ path: "shot-mark.png" });
await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll mark checks passed.");
