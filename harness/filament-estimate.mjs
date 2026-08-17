// The filament estimator, checked against shapes whose answer is known without it.
//
// NOT a Playwright probe, deliberately. The panel that displays this — the mesh-stats
// overlay — does not populate in the harness: its printability report stays null after a
// build, which reproduces identically on code with none of this in it, so it is a
// pre-existing harness condition and not something the estimate introduced. Rather than
// ship a UI probe that hangs, this verifies the part that carries the risk: the
// arithmetic that turns a mesh into grams and money.
//
// The display path (the material picker, the row in the overlay) is therefore
// CODE-verified only, and says so in the build notes.
//
//   node filament-estimate.mjs      (needs npx tsx, no servers)
import { estimateFilament, materialById, DEFAULT_PRINT, MATERIALS } from "../moldable-lite/src/print/filament.ts";

const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const pla = materialById("pla");
const abs = materialById("abs");

// --- a 20 mm solid cube: 8000 mm³, 2400 mm² -------------------------------------
// By hand at 2 perimeters of 0.45 mm and 15% infill: shell 2160, interior 5840 × 0.15,
// = 3036 mm³ → 3.76 g of PLA. A slicer puts this cube at roughly 3.8 g.
const cube = estimateFilament(8000, 2400, pla, DEFAULT_PRINT);
check("20 mm cube lands where a slicer puts it", Math.abs(cube.grams - 3.76) < 0.1, `${cube.grams.toFixed(2)} g`);
check("…and is a fraction of solid, not all of it", cube.solidFraction > 0.3 && cube.solidFraction < 0.45,
  `${(cube.solidFraction * 100).toFixed(0)}% solid`);

// --- a 1 mm plate is ALL wall ---------------------------------------------------
// The cap is what stops a thin part being quoted as more plastic than the block it was
// cut from — the arithmetic without it says 20400 × 0.9 = 18.4 cm³ for a 10 cm³ plate.
const plate = estimateFilament(10000, 20400, pla, DEFAULT_PRINT);
check("a 1 mm plate is exactly 100% solid, never more", plate.solidFraction === 1,
  `${plate.solidFraction} · ${plate.grams.toFixed(1)} g`);

// --- material actually changes the answer, by the density ratio ------------------
const cubeABS = estimateFilament(8000, 2400, abs, DEFAULT_PRINT);
check("ABS weighs less than PLA for the same model", cubeABS.grams < cube.grams,
  `${cube.grams.toFixed(2)} → ${cubeABS.grams.toFixed(2)} g`);
check("…by exactly the density ratio", Math.abs(cubeABS.grams / cube.grams - abs.density / pla.density) < 1e-9,
  `${(cubeABS.grams / cube.grams).toFixed(4)} vs ${(abs.density / pla.density).toFixed(4)}`);

// --- money and metres ------------------------------------------------------------
// $22 per 1 kg spool → a 3.76 g cube is about 8 cents.
check("cost follows grams against the spool price", Math.abs(cube.cost - (cube.grams / 1000) * 22) < 1e-9,
  `$${cube.cost.toFixed(3)}`);
check("metres of 1.75 mm filament are sane", cube.metres > 0.5 && cube.metres < 3, `${cube.metres.toFixed(2)} m`);

// --- refuses to invent a number --------------------------------------------------
check("no volume → no estimate", estimateFilament(0, 2400, pla) === null);
check("no surface → no estimate", estimateFilament(8000, 0, pla) === null);

// --- every material is usable ----------------------------------------------------
const bad = MATERIALS.filter((m) => !(m.density > 0.8 && m.density < 2));
check("every material has a plausible density", bad.length === 0, bad.map((m) => m.label).join(", "));
check("materialById falls back rather than throwing", materialById("nonsense").id === MATERIALS[0].id);

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
process.exit(fails.length ? 1 : 0);
