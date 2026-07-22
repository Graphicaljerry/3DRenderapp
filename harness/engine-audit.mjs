// Engine audit: drive the REAL OCCT worker through the engine layer (no UI) and
// hammer every template with the full op/param/export matrix:
//   build → dims sane → rotate → scale → chamferBottom → param tweak → STL/STEP/
//   OBJ/3MF exports → STL again (cache-consumption regression) → base rebuild.
// Plus: repeated-build stability and humanized kernel errors.
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION|favicon/.test(m.text())) console.error("[page]", m.text().slice(0, 200)); });
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });

const report = await page.evaluate(async () => {
  const { getEngineSelection } = await import("/src/engine/selectEngine.ts");
  const { TEMPLATES } = await import("/src/cad/templates.ts");
  const sel = await getEngineSelection();
  const out = { kind: sel.kind, templates: [], errors: [], notes: [], repeat: null, badCode: null };
  if (sel.kind !== "replicad") { out.errors.push("OCCT kernel failed to boot: " + sel.kind); return out; }
  const eng = sel.engine;

  const firstParam = (code) => {
    const m = /defaultParams\s*=\s*\{\s*(\w+)\s*:\s*([\d.]+)/.exec(code);
    return m ? { k: m[1], v: parseFloat(m[2]) } : null;
  };

  for (const t of TEMPLATES) {
    const r = { id: t.id, ok: true, steps: {}, note: "" };
    out.templates.push(r);
    const step = async (name, fn, optional = false) => {
      try {
        const v = await fn();
        r.steps[name] = v ?? "ok";
      } catch (e) {
        const msg = String(e?.message ?? e).slice(0, 140);
        if (optional) { r.steps[name] = "SKIP: " + msg; r.note += `${name}: ${msg}; `; }
        else { r.steps[name] = "FAIL: " + msg; r.ok = false; }
      }
    };

    let base = null;
    await step("build", async () => {
      base = await eng.build({ kind: "code", code: t.code });
      const d = base.dims;
      if (!(d.x > 0.5 && d.y > 0.5 && d.z > 0.5 && d.x < 500 && d.y < 500 && d.z < 500)) throw new Error(`weird dims ${JSON.stringify(d)}`);
      return `${d.x}×${d.y}×${d.z}`;
    });
    if (!base) continue;

    await step("rotate90", async () => {
      const res = await eng.build({ kind: "code", code: t.code, ops: [{ type: "rotate", axis: [1, 0, 0], angleDeg: 90, center: [0, 0, 0] }] });
      if (!(res.dims.x > 0)) throw new Error("no dims");
    });
    await step("scale1.5", async () => {
      const res = await eng.build({ kind: "code", code: t.code, ops: [{ type: "scale", factor: 1.5, center: [0, 0, 0] }] });
      const grew = res.dims.x > base.dims.x * 1.2 || res.dims.y > base.dims.y * 1.2 || res.dims.z > base.dims.z * 1.2;
      if (!grew) throw new Error(`didn't grow: ${JSON.stringify(res.dims)}`);
    });
    // Elephant-foot on arbitrary real parts: allowed to decline politely (some bottom
    // geometries can't take a 0.3 chamfer) but must never crash the worker or garble.
    await step("chamferBottom", async () => {
      const res = await eng.build({ kind: "code", code: t.code, ops: [{ type: "chamferBottom", size: 0.3 }] });
      if (!(res.dims.x > 0)) throw new Error("no dims");
    }, true);
    await step("paramTweak", async () => {
      const p = firstParam(t.code);
      if (!p) return "no params";
      const res = await eng.build({ kind: "code", code: t.code, params: { [p.k]: p.v * 1.15 } });
      if (!(res.dims.x > 0)) throw new Error("no dims");
    });
    for (const fmt of ["stl", "step", "obj", "3mf"]) {
      await step("export-" + fmt, async () => {
        const blob = await eng.export(base, fmt);
        if (!blob || blob.size < 300) throw new Error(`tiny blob ${blob?.size}`);
        return blob.size;
      });
    }
    // The classic regression: a second STL export used to die on the consumed cache.
    await step("export-stl-again", async () => {
      const blob = await eng.export(base, "stl");
      if (!blob || blob.size < 300) throw new Error(`tiny blob ${blob?.size}`);
    });
    await step("rebuild", async () => {
      const res = await eng.build({ kind: "code", code: t.code });
      if (Math.abs(res.dims.x - base.dims.x) > 0.2) throw new Error(`dims drifted ${res.dims.x} vs ${base.dims.x}`);
    });
  }

  // Stability: rebuild the same part 10× with alternating ops — caches must not
  // leak dead shapes or corrupt intermediates.
  try {
    const code = TEMPLATES.find((t) => t.id === "coaster").code;
    for (let i = 0; i < 10; i++) {
      const ops = i % 2 ? [{ type: "rotate", axis: [0, 0, 1], angleDeg: 15 * i, center: [0, 0, 0] }] : [];
      const res = await eng.build({ kind: "code", code, ops });
      if (!(res.dims.x > 0)) throw new Error("no dims at iter " + i);
    }
    out.repeat = "ok";
  } catch (e) {
    out.repeat = "FAIL: " + String(e?.message ?? e).slice(0, 140);
  }

  // Kernel errors must reach users as words, never a raw wasm pointer ("8759440").
  try {
    await eng.build({ kind: "code", code: "function main(r){ return r.makeBaseBox(10, 10, 0); }" });
    out.badCode = "unexpected success";
  } catch (e) {
    const msg = String(e?.message ?? e);
    out.badCode = /^\d+$/.test(msg.trim()) ? "FAIL: raw pointer error: " + msg : "ok: " + msg.slice(0, 90);
  }
  return out;
});

let fails = 0;
console.log(`kernel: ${report.kind}`);
for (const t of report.templates) {
  const bad = Object.entries(t.steps).filter(([, v]) => String(v).startsWith("FAIL"));
  const skips = Object.entries(t.steps).filter(([, v]) => String(v).startsWith("SKIP"));
  console.log(`${bad.length ? "FAIL" : "PASS"} ${t.id} — build ${t.steps.build}${skips.length ? ` (${skips.map(([k]) => k).join(",")} declined politely)` : ""}`);
  for (const [k, v] of bad) { console.log(`   ✗ ${k}: ${v}`); fails++; }
  for (const [k, v] of skips) console.log(`   ~ ${k}: ${v}`);
}
console.log(`repeat-build ×10: ${report.repeat}`);
console.log(`bad-code error path: ${report.badCode}`);
if (String(report.repeat).startsWith("FAIL")) fails++;
if (String(report.badCode).startsWith("FAIL")) fails++;
for (const e of report.errors) { console.log("ERROR " + e); fails++; }

await browser.close();
if (fails) { console.log(`\n${fails} audit failure(s).`); process.exit(1); }
console.log("\nEngine audit clean.");
