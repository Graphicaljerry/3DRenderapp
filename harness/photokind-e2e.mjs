// Does the sketch-vs-photo classifier agree with a person?
//
// Runs the app's own module (bundled from src, never a copy of it) against the fixture
// pictures in photokind-fixtures.mjs, inside a real browser, through the same
// createImageBitmap → canvas path the app uses. Prints the measured numbers next to each
// verdict so a failure says WHICH property moved, not just that something did.
//
//   node photokind-e2e.mjs

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { FIXTURES, WANT } from "./photokind-fixtures.mjs";

const SRC = "../moldable-lite/src/lib/photoKind.ts";
const OUT = "/tmp/photokind.bundle.js";

execFileSync("../moldable-lite/node_modules/.bin/esbuild", [SRC, "--bundle", "--format=iife", "--global-name=PK", `--outfile=${OUT}`], { cwd: import.meta.dirname, stdio: "inherit" });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("about:blank");
await page.addScriptTag({ content: readFileSync(OUT, "utf8") });
await page.addScriptTag({ content: FIXTURES });

const rows = await page.evaluate(async (names) => {
  const out = [];
  for (const name of names) {
    const canvas = document.createElement("canvas");
    canvas.width = 760;
    canvas.height = 560;
    const ctx = canvas.getContext("2d");
    globalThis.FIXTURES[name](ctx, canvas.width, canvas.height);
    // Through a real encode, so the classifier sees JPEG mush like it will in the app.
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    const kind = await PK.photoKind(blob);
    // Measure again for the report — same pixels, same path as photoKind's own read.
    const bmp = await createImageBitmap(blob);
    const s = document.createElement("canvas");
    s.width = s.height = 96;
    const sctx = s.getContext("2d");
    sctx.drawImage(bmp, 0, 0, 96, 96);
    const stats = PK.measure(sctx.getImageData(0, 0, 96, 96).data, 96, 96);
    out.push({ name, kind, stats });
  }
  return out;
}, Object.keys(WANT));

let bad = 0;
const n2 = (x) => x.toFixed(2);
for (const { name, kind, stats } of rows) {
  const ok = kind === WANT[name];
  if (!ok) bad++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name.padEnd(28)} → ${kind.padEnd(6)} (want ${WANT[name]})` +
      `  page ${n2(stats.page)} mark ${n2(stats.mark)} stroke ${n2(stats.stroke)} colour ${n2(stats.colour)}`,
  );
}
await browser.close();
rmSync(OUT, { force: true });
console.log(bad ? `\n${bad} of ${rows.length} disagree` : `\nall ${rows.length} agree`);
process.exit(bad ? 1 : 0);
