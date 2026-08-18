// The hardware table's matching, and the fact that it now reaches the prompt at all.
//
// lib/hardware.ts sat unused for its whole history — 692 lines of ISO-sourced bearing,
// nut, washer, extrusion and board dimensions, and its own docstring described a caller
// ("a prompt builder feeding it free text") that was never written. It is wired into the
// CAD prompt now, so this guards two things:
//
//   1. The phrasings people actually type resolve to the right ROW. Wiring it up exposed
//      a lopsided index — a washer's id carries its category ("w_m2"), so "washer m5"
//      resolved, while a hex nut is keyed on the bare thread ("m3"), so "M3 nut trap" and
//      "M5 nyloc" resolved to nothing. The token sweep could not rescue them either: it
//      skips keys under three characters, and every M-thread key is two.
//   2. A near miss still returns NOTHING. That is the whole point of the table — a
//      confident wrong dimension is worse than no dimension, because the user finds out
//      after the print. "washer m5" must never come back a nut.
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage();
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
const out = await page.evaluate(async () => {
  const { lookupHardware } = await import("/src/lib/hardware.ts");
  const cases = [
    ["a bracket that holds a 608 bearing", "bearing", "608"],
    ["608zz holder", "bearing", "608"],
    ["pocket for an M5 nyloc", "hexNut", "M5"],
    ["M3 nut trap", "hexNut", "M3"],
    ["captive m4 nut slot", "hexNut", "M4"],
    ["an M5 washer recess", "washer", null],
    ["washer m5", "washer", null],
    ["2020 v-slot end cap", "extrusion", null],
    ["a case for a Pi 5", "board", null],
    ["a plain rounded box", null, null],
    ["something with a hole in it", null, null],
    ["a 20 mm cube", null, null],
  ];
  return cases.map(([q, wantCat, wantLabel]) => {
    const h = lookupHardware(q);
    return { q, got: h ? `${h.category}/${h.part.label}` : null, wantCat, wantLabel,
      ok: wantCat === null ? h === null : (!!h && h.category === wantCat && (!wantLabel || h.part.label === wantLabel)) };
  });
});
let bad = 0;
for (const r of out) { if (!r.ok) bad++; console.log(`${r.ok ? "PASS" : "FAIL"} ${r.q.padEnd(34)} → ${r.got ?? "(none)"}   want ${r.wantCat ?? "(none)"}${r.wantLabel ? "/" + r.wantLabel : ""}`); }
console.log(bad ? `\n✗ ${bad} lookups wrong` : "\n✓ every phrasing resolves, and near misses stay silent");
await b.close();
process.exit(bad ? 1 : 0);
