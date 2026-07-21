// Fastener presets for the hole tool: pick "M3 heat-set insert" and the hole gets
// the RIGHT diameter and depth for hobbyist FDM — no chart-hunting. Sources: CNC
// Kitchen's insert testing + common tapered-brass insert specs (Ruthex/CNC Kitchen
// style), standard ISO close-fit clearance holes, and accepted thread-forming pilot
// practice in printed plastic (~0.85 × nominal ⌀, depth ≥ 1.5 × ⌀ + slack).

export interface FastenerPreset {
  id: string;
  label: string;
  diameter: number; // mm
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
      { id: "hsi-m2", label: "M2 heat-set insert (⌀3.2 · 4 mm)", diameter: 3.2, depth: 4 },
      { id: "hsi-m2_5", label: "M2.5 heat-set insert (⌀3.6 · 5 mm)", diameter: 3.6, depth: 5 },
      { id: "hsi-m3", label: "M3 heat-set insert (⌀4.0 · 5.5 mm)", diameter: 4.0, depth: 5.5 },
      { id: "hsi-m4", label: "M4 heat-set insert (⌀5.6 · 7 mm)", diameter: 5.6, depth: 7 },
      { id: "hsi-m5", label: "M5 heat-set insert (⌀6.4 · 8.5 mm)", diameter: 6.4, depth: 8.5 },
    ],
  },
  {
    group: "Screw clearance — screw passes through freely",
    items: [
      { id: "cl-m2", label: "M2 clearance (⌀2.4 · through)", diameter: 2.4, depth: 0 },
      { id: "cl-m2_5", label: "M2.5 clearance (⌀2.9 · through)", diameter: 2.9, depth: 0 },
      { id: "cl-m3", label: "M3 clearance (⌀3.4 · through)", diameter: 3.4, depth: 0 },
      { id: "cl-m4", label: "M4 clearance (⌀4.5 · through)", diameter: 4.5, depth: 0 },
      { id: "cl-m5", label: "M5 clearance (⌀5.5 · through)", diameter: 5.5, depth: 0 },
    ],
  },
  {
    group: "Thread-forming pilot — screw bites the plastic",
    items: [
      { id: "tf-m2", label: "M2 pilot (⌀1.7 · 6 mm)", diameter: 1.7, depth: 6 },
      { id: "tf-m2_5", label: "M2.5 pilot (⌀2.15 · 7 mm)", diameter: 2.15, depth: 7 },
      { id: "tf-m3", label: "M3 pilot (⌀2.5 · 8 mm)", diameter: 2.5, depth: 8 },
      { id: "tf-m4", label: "M4 pilot (⌀3.4 · 10 mm)", diameter: 3.4, depth: 10 },
      { id: "tf-m5", label: "M5 pilot (⌀4.2 · 12 mm)", diameter: 4.2, depth: 12 },
    ],
  },
];

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
