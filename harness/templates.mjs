import { bootPage, build } from "./lib.mjs";

const only = process.argv[2]; // optional template id filter

const { browser, page } = await bootPage();
const templates = await page.evaluate(async () => {
  const mod = await import("/src/cad/templates.ts");
  return mod.TEMPLATES.map((t) => ({ id: t.id, code: t.code }));
});

let failed = 0;
for (const t of templates) {
  if (only && t.id !== only) continue;
  const r = await build(page, t.code);
  if (r.ok) {
    console.log(`OK   ${t.id.padEnd(14)} ${r.dims.x} × ${r.dims.y} × ${r.dims.z} mm, ${r.triangles} tris`);
  } else {
    failed++;
    console.log(`FAIL ${t.id.padEnd(14)} ${r.error}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
