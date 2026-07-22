import { chromium } from "playwright";

export async function bootPage() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
  await page.goto("http://localhost:5173/");
  // Boot the engine once (OCCT WASM fetch + init) and keep it on window.
  await page.evaluate(async () => {
    const mod = await import("/src/engine/selectEngine.ts");
    window.__sel = await mod.getEngineSelection();
  });
  const kind = await page.evaluate(() => window.__sel.kind);
  if (kind !== "replicad") throw new Error("OCCT kernel did not boot; got engine: " + kind);
  return { browser, page };
}

/** Build replicad code, return dims + engine-space bbox (display bbox + recenter). */
export async function build(page, code, params) {
  return page.evaluate(async ({ code, params }) => {
    try {
      const res = await window.__sel.engine.build({ kind: "code", code, params });
      const g = res.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox;
      const rc = res.recenter ?? [0, 0, 0];
      return {
        ok: true,
        dims: res.dims,
        displayBox: { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] },
        recenter: rc,
        triangles: (g.index ? g.index.count : g.attributes.position.count) / 3,
      };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }, { code, params });
}
