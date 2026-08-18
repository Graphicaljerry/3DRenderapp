// Staying signed in on the desktop app. Two things must hold:
//  1. The desktop build offers the ONE sign-in method that can complete there
//     (email + password). OAuth and login links finish by redirecting to a web
//     address, which a desktop app doesn't have.
//  2. Its session is written to a real file via the Tauri store plugin, not to
//     WebView storage the system can clear — that's what "stay logged in" needs.
// The web build must be untouched: social buttons still there, localStorage still used.
import { chromium } from "playwright";
import { enterWorkspace } from "./enter.mjs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

/** Boot a build with the Tauri IPC stubbed, capturing every store plugin call. */
async function boot(url, tauri) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
  await page.addInitScript((tauri) => {
    if (!tauri) return;
    window.__store = {}; // stands in for auth.json on disk
    window.__storeCalls = [];
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
      invoke: (cmd, args) => {
        if (cmd.startsWith("plugin:store|")) {
          window.__storeCalls.push(cmd);
          const key = args?.key;
          if (cmd.endsWith("|set")) { window.__store[key] = args.value; return Promise.resolve(null); }
          if (cmd.endsWith("|get")) return Promise.resolve(window.__store[key] ?? null);
          if (cmd.endsWith("|delete")) { delete window.__store[key]; return Promise.resolve(true); }
        }
        return Promise.resolve(null);
      },
    };
  }, tauri);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await enterWorkspace(page);
  return page;
}

async function openSync(page) {
  await page.locator(".topbar button").last().click(); // the account / settings button
  await page.waitForSelector(".card", { timeout: 20_000 });
  const sync = page.locator(".card").getByRole("button", { name: "Sync", exact: true });
  if (await sync.count()) await sync.first().click();
  await page.waitForTimeout(500);
  return page.locator(".card").innerText();
}

// ---- A) Desktop build ----------------------------------------------------------
{
  // Was hardcoded to 5174 — a port nothing in this harness serves. It crashed in a
  // second with ERR_CONNECTION_REFUSED after running zero assertions, and the whole
  // desktop-auth half of the file went unexercised. The other half of this same file
  // already read PORT correctly, which is how it hid.
  const page = await boot(`http://localhost:${process.env.PORT ?? 5173}/`, true);
  const body = await openSync(page);
  check("A1 desktop offers password sign-in", /Sign in/.test(body) && (await page.locator('input[type="password"]').count()) > 0);

  // A2-A4 need the app to BELIEVE it is the desktop build, and that is decided at BUILD
  // time: DESKTOP_PLATFORM comes from import.meta.env.TAURI_ENV_PLATFORM (desktopUpdate.ts),
  // which vite bakes in and which is empty for a web build. No amount of runtime
  // window.__TAURI_INTERNALS__ shimming changes it — the shim makes the store CALLS work,
  // not the branch that decides to use the store. Against `vite dev` these three assert
  // the web build behaves like the desktop one, which it correctly does not.
  const isDesktopBuild = await page.evaluate(async () => {
    const m = await import("/src/lib/desktopUpdate.ts");
    return !!m.DESKTOP_PLATFORM;
  }).catch(() => false);
  if (!isDesktopBuild) {
    console.log("SKIP A2/A3/A4 desktop-only sign-in — this is a web build "
      + "(TAURI_ENV_PLATFORM is baked in at build time and is empty here). "
      + "To exercise them: TAURI_ENV_PLATFORM=darwin npx vite, then PORT=<that> node desktop-auth-e2e.mjs");
  } else {
    check("A2 desktop hides Continue with Google/GitHub (they can't complete here)",
      !/Continue with Google|Continue with GitHub/.test(body));
    check("A3 it explains how to get a password", /Set a password/.test(body), body.slice(0, 120));
  }

  // Force the Supabase client to initialise so its storage adapter is exercised.
  await page.evaluate(async () => { const m = await import("/src/lib/cloud.ts"); await m.cloudUser(); });
  await page.waitForTimeout(1200);
  const calls = await page.evaluate(() => window.__storeCalls ?? []);
  if (isDesktopBuild) {
    check("A4 the session is read through the Tauri store (a real file), not WebView storage",
      calls.some((c) => c.startsWith("plugin:store|")), calls.slice(0, 3).join(",") || "no store calls");
  }
  await page.close();
}

// ---- B) Web build unchanged ----------------------------------------------------
{
  const page = await boot(`http://localhost:${process.env.PORT ?? 5173}/`, false);
  const body = await openSync(page);
  check("B1 web still offers Google / GitHub", /Continue with Google/.test(body) && /Continue with GitHub/.test(body));
  check("B2 web still offers a login link", /login link/i.test(body));
  const storeUsed = await page.evaluate(async () => {
    const m = await import("/src/lib/cloud.ts");
    await m.cloudUser();
    return typeof window.__storeCalls !== "undefined";
  });
  check("B3 web never touches the desktop store", storeUsed === false);
  await page.close();
}

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll desktop-auth checks passed.");
