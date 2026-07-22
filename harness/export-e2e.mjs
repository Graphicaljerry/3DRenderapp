// Repro of the "Export failed: This object has been deleted" bug: replicad's
// translate() deletes its source, and dropToBed was translating the build CACHE.
// Sequence that failed for the user: export STL → export STEP (dead cache).
// Also: transform ops consumed cached intermediates the same way.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails.push(name); };

await page.addInitScript(() => localStorage.setItem("moldable_entered", "1"));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".topbar", { timeout: 60_000 });

const res = await page.evaluate(async () => {
  const mod = await import("/src/engine/selectEngine.ts");
  const sel = await mod.getEngineSelection();
  const code = "const defaultParams = { size: 30 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  return replicad.makeBaseBox(p.size, p.size, p.size).fillet(3);\n}";
  const out = { steps: [] };
  const step = async (label, fn) => {
    try { const v = await fn(); out.steps.push({ label, ok: true, size: v?.size ?? v?.byteLength ?? null }); return v; }
    catch (e) { out.steps.push({ label, ok: false, err: String(e?.message ?? e).slice(0, 120) }); return null; }
  };
  await step("build", () => sel.engine.build({ kind: "code", code }));
  // The user's exact failing sequence: two worker exports back to back.
  const mkRes = (ops) => ({ source: { kind: "code", code, ops }, geometry: null, dims: {} });
  await step("export STL", () => sel.engine.export(mkRes(), "stl"));
  await step("export STEP", () => sel.engine.export(mkRes(), "step"));
  await step("export STEP again", () => sel.engine.export(mkRes(), "step"));
  // Transform op consumed the cached base the same way: op-rebuild, export, re-op.
  const ops1 = [{ type: "translate", delta: [5, 0, 0] }];
  await step("rebuild with a move op", () => sel.engine.build({ kind: "code", code, ops: ops1 }));
  await step("export STEP with the op", () => sel.engine.export(mkRes(ops1), "step"));
  const ops2 = [{ type: "translate", delta: [5, 0, 0] }, { type: "rotate", angleDeg: 30, center: [0, 0, 0], axis: [0, 0, 1] }];
  await step("append a rotate op (reuses cached intermediate)", () => sel.engine.build({ kind: "code", code, ops: ops2 }));
  await step("rebuild with NO ops (reuses cached base)", () => sel.engine.build({ kind: "code", code }));
  await step("final STEP export", () => sel.engine.export(mkRes(), "step"));
  return out;
});
for (const s of res.steps) check(s.label, s.ok, s.ok ? (s.size ? `${s.size} bytes` : "") : s.err);
const stepBlob = res.steps.find((s) => s.label === "export STEP");
check("STEP export produced a real file", !!stepBlob?.ok && (stepBlob.size ?? 0) > 5000, `${stepBlob?.size ?? 0} bytes`);

await browser.close();
if (fails.length) { console.log("\nFAILED: " + fails.join(", ")); process.exit(1); }
console.log("\nAll export checks passed.");
