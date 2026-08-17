// Load-cost probe: how long the library list and opening a project take when the
// account has real history — many projects, long chats with images, deep version
// stacks, and a heavy mesh. Seeds synthetic-but-realistic data, then times the paths.
import { chromium } from "playwright";
import { enterWorkspace } from "./enter.mjs";

const PROJECTS = Number(process.env.PROJECTS ?? 25);
const VERSIONS = Number(process.env.VERSIONS ?? 30);
const CHAT = Number(process.env.CHAT ?? 40);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.error("[PAGEERROR]", e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await enterWorkspace(page);

// ---- Seed a realistic library -------------------------------------------------
const NOTHUMB = !!process.env.NOTHUMB; // isolate what thumbnail decoding costs
const seeded = await page.evaluate(async ({ PROJECTS, VERSIONS, CHAT, NOTHUMB }) => {
  const { putProject } = await import("/src/store/projects.ts");
  // ~40 KB data-URL image, the size a model thumbnail or pasted screenshot lands at.
  const img = "data:image/png;base64," + "A".repeat(40_000);
  // A mesh blob in the megabytes, like a real generated model.
  const meshBytes = new Uint8Array(6 * 1024 * 1024);
  let bytes = 0;
  for (let p = 0; p < PROJECTS; p++) {
    const now = Date.now() - p * 60_000;
    const proj = {
      id: `perf-${p}`,
      name: `Perf project ${p}`,
      createdAt: now, updatedAt: now,
      engine: p % 3 === 0 ? "generative" : "replicad",
      thumb: NOTHUMB ? undefined : img,
      chat: Array.from({ length: CHAT }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        text: `Message ${i} — ` + "lorem ipsum dolor sit amet ".repeat(20),
        image: i % 7 === 0 ? img : undefined,
      })),
      versions: Array.from({ length: VERSIONS }, (_, i) => ({
        id: `v${i}`, at: now - i * 1000, label: `edit ${i}`,
        code: "// replicad program\n" + "const x = 1;\n".repeat(200),
        dims: { x: 40, y: 30, z: 20 },
      })),
      glb: p % 3 === 0 ? new Blob([meshBytes]) : undefined,
    };
    bytes += JSON.stringify(proj.chat).length + JSON.stringify(proj.versions).length;
    await putProject(proj);
  }
  return { projects: PROJECTS, textBytes: bytes };
}, { PROJECTS, VERSIONS, CHAT, NOTHUMB });
console.log(`seeded ${seeded.projects} projects · ${(seeded.textBytes / 1e6).toFixed(1)} MB of chat+version text · ${Math.round(PROJECTS / 3)} with a 6 MB mesh`);

// ---- 1) What the Library list costs -------------------------------------------
const listMs = await page.evaluate(async () => {
  const { listProjects } = await import("/src/store/projects.ts");
  const t0 = performance.now();
  const all = await listProjects();
  const t1 = performance.now();
  // How much of it the list actually needs (name/date/thumb) vs what it loaded.
  const needed = all.reduce((n, p) => n + (p.name.length + 40 + (p.thumb?.length ?? 0)), 0);
  const loaded = all.reduce((n, p) => n + JSON.stringify({ c: p.chat, v: p.versions }).length + (p.thumb?.length ?? 0), 0);
  return { ms: t1 - t0, count: all.length, neededMB: needed / 1e6, loadedMB: loaded / 1e6 };
});
console.log(`\nlistProjects(): ${listMs.ms.toFixed(0)}ms for ${listMs.count} projects`);
console.log(`  materialised ${listMs.loadedMB.toFixed(1)} MB to show ${listMs.neededMB.toFixed(1)} MB of name/date/thumb`);

// ---- 2) Opening the Library in the UI ------------------------------------------
await page.evaluate(() => { window.__t = performance.now(); });
await page.getByRole("button", { name: "Library", exact: true }).click();
await page.waitForSelector(".lib-card", { timeout: 60_000 });
const openLib = await page.evaluate(() => performance.now() - window.__t);
console.log(`Library panel visible: ${openLib.toFixed(0)}ms after the click`);

// ---- 3) Opening a mesh project (chat replay + mesh decode) ---------------------
const openMs = await page.evaluate(async () => {
  const { getProject } = await import("/src/store/projects.ts");
  const t0 = performance.now();
  const p = await getProject("perf-0"); // a generative one (has the 6 MB mesh)
  const t1 = performance.now();
  const buf = await p.glb.arrayBuffer(); // what rebuildHead does before parsing
  const t2 = performance.now();
  return { read: t1 - t0, blob: t2 - t1, mb: buf.byteLength / 1e6, chat: p.chat.length, versions: p.versions.length };
});
console.log(`\ngetProject(mesh project): ${openMs.read.toFixed(0)}ms record read + ${openMs.blob.toFixed(0)}ms mesh blob (${openMs.mb.toFixed(1)} MB, ${openMs.chat} chat turns, ${openMs.versions} versions)`);

// ---- 4) Opening a project in the UI: chat replay is the visible wait -----------
await page.evaluate(() => { window.__t = performance.now(); });
await page.locator(".lib-card .lib-open").first().click();
await page.waitForFunction(() => document.querySelectorAll(".msg .bubble").length > 10, null, { timeout: 60_000 });
const chatMs = await page.evaluate(() => performance.now() - window.__t);
const bubbles = await page.locator(".msg .bubble").count();
console.log(`\nproject open → ${bubbles} chat bubbles on screen: ${chatMs.toFixed(0)}ms`);

// Long-task census while that happened tells us if it was one big blocking render.
const blocking = await page.evaluate(() => {
  const longs = performance.getEntriesByType("longtask") ?? [];
  return { count: longs.length, total: longs.reduce((s, e) => s + e.duration, 0) };
});
if (blocking.count) console.log(`  ${blocking.count} long tasks, ${blocking.total.toFixed(0)}ms blocking the main thread`);

// ---- 5) Re-render cost of a loaded chat (typing re-renders the whole list) -----
const rerender = await page.evaluate(async () => {
  const el = document.querySelector(".composer textarea, textarea");
  if (!el) return null;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  const t0 = performance.now();
  for (let i = 0; i < 12; i++) {
    setter.call(el, "typing " + i);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
  }
  return (performance.now() - t0) / 12;
});
if (rerender) console.log(`typing in the composer with that chat loaded: ${rerender.toFixed(1)}ms per keystroke-frame`);

await browser.close();
