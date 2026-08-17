// How much plastic, and what it costs.
//
// The Printability panel could tell you a model was watertight and had 4,812 triangles,
// which are facts about a mesh, not about printing it. The two questions people actually
// ask before a print — "how much filament is this" and "is it worth the spool" — had no
// answer anywhere in the app, and the second one is the whole reason to check a design
// BEFORE running it rather than after.
//
// This is an ESTIMATE and says so everywhere it surfaces. A slicer knows the real answer
// because it generates the toolpath; we are working from a closed surface and the same
// arithmetic a slicer starts from:
//
//   shell    = surface area × (perimeters × extrusion width)   — walls, and the top and
//              bottom solid layers, which are surface area too
//   interior = whatever volume is left, times the infill density
//
// Checked against shapes with a known answer: a 20 mm PLA cube comes out at 3.8 g (a
// slicer says ~3.8), a 1 mm plate at exactly 100% solid, and a 3DBenchy at 14.3 g against
// a real 11-13 g. It errs in both directions and it is worth knowing which:
//
//   HIGH on hollow or shelled parts — a closed shell's surface area counts the inside
//        face as well as the outside, so a thin wall is billed roughly twice.
//   LOW  on support-heavy prints — supports, brim and raft are not modelled at all.
//
// Call it good to about ±20%, which is the band that answers the question people are
// actually asking: is this 5 g or 50 g, and can I finish it on the spool I have open.

/** Densities are the manufacturer-published figures for the base polymer, which is what
 *  a spool of that material actually weighs per cm³. Filled variants (CF, wood, glow)
 *  differ enough to be worth their own rows — carbon fill RAISES density despite the
 *  marketing implying a lighter part. */
export interface Material {
  id: string;
  label: string;
  density: number; // g/cm³
  note?: string;
}

export const MATERIALS: Material[] = [
  { id: "pla", label: "PLA", density: 1.24, note: "the default for almost everything" },
  { id: "petg", label: "PETG", density: 1.27, note: "tougher, takes heat better" },
  { id: "abs", label: "ABS", density: 1.04, note: "lightest of the common three" },
  { id: "asa", label: "ASA", density: 1.07, note: "ABS that survives sunlight" },
  { id: "tpu", label: "TPU", density: 1.21, note: "flexible" },
  { id: "nylon", label: "Nylon (PA)", density: 1.14, note: "gears, living hinges" },
  { id: "pc", label: "Polycarbonate", density: 1.20, note: "stiff and heat-resistant" },
  { id: "pla_cf", label: "PLA-CF", density: 1.29, note: "carbon fill — heavier, not lighter" },
  { id: "petg_cf", label: "PETG-CF", density: 1.31 },
  { id: "wood", label: "Wood-fill PLA", density: 1.28 },
];

export const DEFAULT_MATERIAL = "pla";
/** A 1 kg spool at a price that is neither the cheapest nor the branded one. Editable —
 *  the figure only matters relative to what the user actually pays. */
export const DEFAULT_SPOOL = { grams: 1000, price: 22, currency: "$" };

export interface PrintSettings {
  /** Extrusion width per perimeter. A slicer runs slightly wider than the nozzle; 1.125×
   *  is the common default and the difference is real at 2 perimeters. */
  nozzleMM: number;
  perimeters: number;
  /** 0–1. 15% is the slicer default nearly everywhere. */
  infill: number;
}

export const DEFAULT_PRINT: PrintSettings = { nozzleMM: 0.4, perimeters: 2, infill: 0.15 };

export interface FilamentEstimate {
  grams: number;
  cm3: number;
  /** Metres of 1.75 mm filament — the unit people eyeball a spool in. */
  metres: number;
  cost: number | null;
  /** What fraction of the bounding solid actually gets plastic. Surfaces the reason two
   *  parts of the same size can differ threefold. */
  solidFraction: number;
}

const FILAMENT_DIA = 1.75;

/** Grams, metres and money for one closed model.
 *
 *  volumeMM3 / surfaceAreaMM2 come straight from the printability pass, so this costs
 *  nothing extra to compute — the mesh has already been walked. */
export function estimateFilament(
  volumeMM3: number,
  surfaceAreaMM2: number,
  material: Material,
  print: PrintSettings = DEFAULT_PRINT,
  spool: { grams: number; price: number } | null = DEFAULT_SPOOL,
): FilamentEstimate | null {
  if (!(volumeMM3 > 0) || !(surfaceAreaMM2 > 0)) return null;
  const extrusionWidth = print.nozzleMM * 1.125;
  const shellThickness = extrusionWidth * Math.max(1, print.perimeters);
  // A thin part is ALL shell — capping here is what stops a 1 mm plate being quoted as
  // more plastic than the solid block it was cut from.
  const shell = Math.min(volumeMM3, surfaceAreaMM2 * shellThickness);
  const interior = Math.max(0, volumeMM3 - shell);
  const used = shell + interior * Math.min(1, Math.max(0, print.infill));
  const cm3 = used / 1000;
  const grams = cm3 * material.density;
  const area = Math.PI * (FILAMENT_DIA / 2) ** 2; // mm²
  return {
    grams,
    cm3,
    metres: used / area / 1000,
    cost: spool && spool.grams > 0 ? (grams / spool.grams) * spool.price : null,
    solidFraction: volumeMM3 > 0 ? used / volumeMM3 : 0,
  };
}

export function fmtGrams(g: number): string {
  return g < 10 ? `${Math.round(g * 10) / 10} g` : `${Math.round(g)} g`;
}

export function fmtMoney(v: number, currency = "$"): string {
  // Below a cent the honest rendering is "<$0.01", not "$0.00" — which reads as free.
  if (v > 0 && v < 0.01) return `<${currency}0.01`;
  return `${currency}${v.toFixed(2)}`;
}

export function materialById(id: string): Material {
  return MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];
}
