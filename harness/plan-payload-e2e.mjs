// The plan request must respect the same byte budget the build request does.
//
// The bug this exists to catch is invisible from the UI. Attach-time downscaling leaves
// PNGs as PNGs on purpose — sketch line art has to keep its edges — so a set of sketches
// or screenshots reaches the request at full weight. The BUILD path has always run the
// set through fitPhotoBudget for exactly this reason (a body the provider rejects reads
// to the user as "the AI is broken"). The PLAN path did not, which put the heaviest
// request in the flow on the one code path that swallows its own failures: draftPlan
// catches everything and returns null, so a rejected plan is not an error, it is the
// plan silently not happening — on precisely the heavily-referenced parts planning is
// for, while the Launchpad chip still says "Plan first · on".
//
// 1x1 test pixels cannot see any of this, which is why the plan-default probe missed it.
// These are real multi-megabyte PNGs, and the assertion is against the stub server's
// record of the bytes that actually arrived.
import { chromium } from "playwright";
import { writeFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const STUB = "http://localhost:8899";
// The app's own ceiling, from lib/downscale.ts. The fitted set must land under it.
const PHOTO_BUDGET_BYTES = 9 * 1024 * 1024;

// Start from an empty request log: the byte assertions cursor into it by index.
await fetch(`${STUB}/_reset`);

const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

// --- a genuinely heavy PNG ---------------------------------------------------
// Noise, so deflate cannot shrink it: this is what an unshrinkable screenshot set looks
// like to the encoder. Kept under 1568px on the long edge so the ATTACH-time resize
// passes it through untouched — the point is to arrive at the request still heavy.
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};
function noisePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0, o = 0; y < h; y++) { raw[o++] = 0; for (let x = 0; x < w * 3; x++) raw[o++] = (Math.random() * 256) | 0; }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = mkdtempSync(join(tmpdir(), "planheavy-"));
const files = [1, 2, 3, 4].map((n) => {
  const f = join(dir, `sketch${n}.png`);
  writeFileSync(f, noisePng(1100, 1100));
  return f;
});
const onDisk = files.reduce((n, f) => n + statSync(f).size, 0);
check("fixture is genuinely over budget before any fitting", onDisk > PHOTO_BUDGET_BYTES,
  `${(onDisk / 1024 / 1024).toFixed(1)} MB of PNG across ${files.length} files`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

await page.setInputFiles(".launch-composer input[type=file]", files);
await page.waitForSelector(".launch-imgchip", { timeout: 30_000 });

const before = (await (await fetch(`${STUB}/_stats`)).json()).length;
await page.locator(".launch-composer textarea").fill("A wall bracket for a 32 mm pipe");
await page.locator(".launch-composer .send").click();
await page.waitForSelector(".plan-card", { timeout: 180_000 });

const stats = await (await fetch(`${STUB}/_stats`)).json();
const planReq = stats.slice(before).find((s) => s.images > 0);
check("the plan still reached the planner with every reference", planReq?.images === files.length,
  `images=${planReq?.images ?? "none"}`);
check("the plan request body stayed under the photo budget", !!planReq && planReq.bytes < PHOTO_BUDGET_BYTES,
  planReq ? `${(planReq.bytes / 1024 / 1024).toFixed(1)} MB sent vs ${(onDisk / 1024 / 1024).toFixed(1)} MB attached` : "no request recorded");
// Fitting works by re-encoding to JPEG before it gives up any resolution, so a set that
// had to shrink says so in the mime types. This distinguishes "was fitted" from "the
// fixture happened to be small enough" — the way the check could pass for a wrong reason.
check("the oversized set was re-encoded, not sent raw", planReq?.each?.every((e) => e.mime === "image/jpeg"),
  (planReq?.each ?? []).map((e) => `${e.mime} ${(e.bytes / 1024 / 1024).toFixed(1)}MB`).join(", "));

// The plan is what the whole exercise is for: it has to have actually appeared.
const card = await page.locator(".plan-card").first().innerText();
check("a plan card was drafted from the heavy set", /pipe wall bracket/i.test(card), card.slice(0, 50));

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
