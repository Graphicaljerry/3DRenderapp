// HF quota auto-fallback e2e: stub the Space's Gradio API so the free GPU
// "rejects" the job (empty SSE error = the ZeroGPU quota kill), with a Meshy key
// configured — the app must announce and attempt the keyed fallback automatically,
// and surface BOTH errors if the fallback also fails.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.addInitScript(() => {
  localStorage.setItem("moldable_entered", "1");
  localStorage.setItem("moldable_geneng", JSON.stringify({ provider: "hf", model: "stabilityai/stable-fast-3d" }));
  localStorage.setItem("moldable_provider_keys", JSON.stringify({ meshy: "msy_mock" }));
  // Record the transient "retrying…" placeholder the moment it renders — the keyed
  // fallback can fail fast in dev, replacing it before a poll would see it.
  window.__retrySeen = [];
  new MutationObserver(() => {
    for (const b of document.querySelectorAll(".msg.assistant .bubble")) {
      if (b.textContent && b.textContent.includes("retrying on your Meshy")) window.__retrySeen.push(1);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
});

// Stub the Space: healthy API info, accepts the upload and the call, then kills
// the job exactly like ZeroGPU does — an SSE error event with a null payload.
await page.route("**/*.hf.space/**", async (route) => {
  const url = route.request().url();
  if (url.includes("/gradio_api/info")) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  if (url.includes("/gradio_api/upload")) return route.fulfill({ status: 200, contentType: "application/json", body: '["tmp/img.png"]' });
  if (/\/gradio_api\/call\/[^/]+$/.test(url)) return route.fulfill({ status: 200, contentType: "application/json", body: '{"event_id":"e1"}' });
  if (/\/gradio_api\/call\/[^/]+\/e1$/.test(url)) {
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: "event: error\ndata: null\n\n" });
  }
  return route.fulfill({ status: 404, body: "" });
});

// Slow the Meshy relay down so the "retrying…" placeholder is observable (in
// production a real generation keeps it up for seconds-to-minutes anyway).
await page.route("**/prox/meshy/**", async (route) => {
  await new Promise((r) => setTimeout(r, 1800));
  return route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"invalid key"}' });
});

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });
await page.getByRole("button", { name: "Generative (AI mesh)" }).click();
await page.locator('input[type="file"]').first().setInputFiles({ name: "car.png", mimeType: "image/png", buffer: PNG });
await page.waitForTimeout(500);
await page.locator(".composer textarea").first().click();
await page.keyboard.press("Enter");

// The announcement shows while the keyed retry runs…
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => b.textContent.includes("retrying on your Meshy")), null, { timeout: 60_000 });
check("fallback announced before the keyed retry", true);
// …then the combined error proves the whole chain (rejection → fallback attempt →
// honest double report).
await page.waitForFunction(() => [...document.querySelectorAll(".msg.assistant .bubble")].some((b) => /Fallback \(Meshy\)/.test(b.textContent)), null, { timeout: 180_000 });
const finalTxt = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .bubble")].map((b) => b.textContent).join(" | "));
check("both errors surfaced (free GPU + fallback)", /Free GPU:.*(quota|rejected)/i.test(finalTxt) && /Fallback \(Meshy\)/.test(finalTxt), finalTxt.slice(-160));
await page.screenshot({ path: "shot-hf-fallback.png" });

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll HF-fallback checks passed.");
