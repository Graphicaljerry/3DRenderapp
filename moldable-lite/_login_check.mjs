import { chromium } from "playwright";
const S = (n) => `/tmp/claude-0/-home-user-3DRenderapp/49ff597c-a1ef-5e3a-876f-cb2f9d890a6b/scratchpad/${n}.png`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("http://127.0.0.1:4601/", { waitUntil: "load" });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(500);
await p.locator("text=/start free/i").first().click();
await p.waitForTimeout(300);
await p.locator("text=/settings|add key/i").first().click();
await p.waitForTimeout(300);
await p.locator(".stabs button", { hasText: "Sync" }).click();
await p.waitForTimeout(600);
console.log("GitHub button:", await p.locator("text=Continue with GitHub").count());
console.log("Google button:", await p.locator("text=Continue with Google").count());
console.log("magic-link button:", await p.locator("text=Email me a login link").count());
console.log("password behind details:", await p.locator("details summary", { hasText: "password" }).count());
await p.screenshot({ path: S("login-pane") });
// click GitHub → provider not enabled OR network error → friendly status
await p.locator("text=Continue with GitHub").click();
let status = "";
for (let i = 0; i < 20; i++) { await p.waitForTimeout(1000); status = (await p.locator(".sync-status").textContent().catch(() => "")) || ""; if (status && !/Taking you/.test(status)) break; }
console.log("github click status:", JSON.stringify(status.slice(0, 130)));
console.log("page errors:", errs.slice(0, 3).join(" | ") || "none");
await b.close();
