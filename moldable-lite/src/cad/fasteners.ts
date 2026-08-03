// Fastener presets for the hole tool: pick "M3 heat-set insert" and the hole gets
// the RIGHT diameter and depth for hobbyist FDM — no chart-hunting. Sources: CNC
// Kitchen's insert testing + common tapered-brass insert specs (Ruthex/CNC Kitchen
// style), standard ISO close-fit clearance holes, and accepted thread-forming pilot
// practice in printed plastic (~0.85 × nominal ⌀, depth ≥ 1.5 × ⌀ + slack).
//
// Diameters here are the chart values. The hole the tool actually cuts comes from
// fastenerHole(), which corrects them for the user's measured printer — so labels
// are built from that number rather than typed in alongside it.

import { bore, boreAllowance } from "../lib/fit";

export interface FastenerPreset {
  id: string;
  label: string;
  diameter: number; // mm — nominal, before this printer's bore allowance
  depth: number; // mm; 0 = through-hole
}

export interface FastenerGroup {
  group: string;
  items: FastenerPreset[];
}

export const FASTENER_GROUPS: FastenerGroup[] = [
  {
    group: "Heat-set insert — melt-in brass thread",
    items: [
      { id: "hsi-m2", label: "M2 heat-set insert", diameter: 3.2, depth: 4 },
      { id: "hsi-m2_5", label: "M2.5 heat-set insert", diameter: 3.6, depth: 5 },
      { id: "hsi-m3", label: "M3 heat-set insert", diameter: 4.0, depth: 5.5 },
      { id: "hsi-m4", label: "M4 heat-set insert", diameter: 5.6, depth: 7 },
      { id: "hsi-m5", label: "M5 heat-set insert", diameter: 6.4, depth: 8.5 },
    ],
  },
  {
    group: "Screw clearance — screw passes through freely",
    items: [
      { id: "cl-m2", label: "M2 clearance", diameter: 2.4, depth: 0 },
      { id: "cl-m2_5", label: "M2.5 clearance", diameter: 2.9, depth: 0 },
      { id: "cl-m3", label: "M3 clearance", diameter: 3.4, depth: 0 },
      { id: "cl-m4", label: "M4 clearance", diameter: 4.5, depth: 0 },
      { id: "cl-m5", label: "M5 clearance", diameter: 5.5, depth: 0 },
    ],
  },
  {
    group: "Thread-forming pilot — screw bites the plastic",
    items: [
      { id: "tf-m2", label: "M2 pilot", diameter: 1.7, depth: 6 },
      { id: "tf-m2_5", label: "M2.5 pilot", diameter: 2.15, depth: 7 },
      { id: "tf-m3", label: "M3 pilot", diameter: 2.5, depth: 8 },
      { id: "tf-m4", label: "M4 pilot", diameter: 3.4, depth: 10 },
      { id: "tf-m5", label: "M5 pilot", diameter: 4.2, depth: 12 },
    ],
  },
];

/** The hole this preset actually cuts on the user's printer. */
export function fastenerHole(p: FastenerPreset): { diameter: number; depth: number } {
  return { diameter: bore(p.diameter), depth: p.depth };
}

/** Menu text: the fastener, then the size it will really be drilled at. */
export function fastenerLabel(p: FastenerPreset): string {
  const { diameter, depth } = fastenerHole(p);
  return `${p.label} (⌀${diameter} · ${depth === 0 ? "through" : `${depth} mm`})`;
}

/** Which preset a draft hole came from — matched on the corrected size, because that
 *  is what got written into the draft. */
export function fastenerFor(diameter: number, depth: number): FastenerPreset | undefined {
  for (const g of FASTENER_GROUPS) {
    const hit = g.items.find((i) => i.depth === depth && Math.abs(bore(i.diameter) - diameter) < 0.005);
    if (hit) return hit;
  }
  return undefined;
}

/** One line telling the user where the number came from, or null when uncalibrated. */
export function fastenerCalNote(): string | null {
  const a = boreAllowance();
  if (!a) return null;
  return `Sizes include the ${a > 0 ? "+" : "−"}${Math.abs(Math.round(a * 200) / 100)} mm you measured on your printer.`;
}

export function findFastener(id: string): FastenerPreset | undefined {
  for (const g of FASTENER_GROUPS) {
    const hit = g.items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Boss guidance shown when an insert preset is chosen: wall the insert needs around it. */
export function insertBossHint(p: FastenerPreset): string | null {
  if (!p.id.startsWith("hsi-")) return null;
  const wall = Math.round(p.diameter * 2 * 10) / 10;
  return `Give the insert ≥ ${wall} mm of surrounding material (a ⌀${wall} mm boss) and ~1 mm of floor under it.`;
}
