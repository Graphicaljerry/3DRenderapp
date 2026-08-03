// Screw holes the way makers actually drill them, in three fits:
//
//  "through"  — the screw SLIDES through this part and bites into the next one (or a
//               nut). Standard clearance bores (ISO 273 medium fit), with an optional
//               82° countersink so a flat head sits flush.
//  "bite"     — the screw threads INTO this part. The bore is the plastic tap size and
//               the wall carries a concentric ribbed profile at the thread pitch; a
//               machine or self-tapping screw cuts its own path through the ribs and
//               holds far better than a smooth pilot. (A true printed helix needs the
//               hole vertical on the plate and a calibrated printer; ribs print in any
//               orientation, which is why they're the default here.)
//  "insert"   — a heat-set brass insert gets melted in and the screw threads into
//               brass. Bore/length per the common Ruthex/CNC-Kitchen style inserts.
//
// Depths: "bite" defaults to 3×d (capped) — enough engagement that the plastic, not
// the screw, sets the strength; "insert" is the insert length plus a melt allowance.
//
// Every bore below is a book figure for an average machine, so it goes through
// bore() before it becomes geometry: once the user has printed the Tolerance test
// coupon, an M3 clearance hole is whatever passes an M3 on THEIR printer.

import { bore, boreNote } from "./fit";

export type ScrewFit = "through" | "bite" | "insert";

export interface ScrewSize {
  id: string;
  label: string;      // chip text
  d: number;          // nominal thread diameter (mm)
  pitch: number;      // thread pitch (mm) — drives the rib spacing
  clearance: number;  // through-hole bore (ISO 273 medium)
  bite: number;       // bore the ribs cut into (plastic tap size)
  head: number;       // countersunk head diameter, for the flush cone
  insertBore?: number;  // heat-set insert: hole diameter
  insertLen?: number;   // heat-set insert: length
  note?: string;
}

export const SCREW_SIZES: ScrewSize[] = [
  { id: "m2",   label: "M2",   d: 2,   pitch: 0.4,  clearance: 2.4, bite: 1.6,  head: 3.8,  insertBore: 3.2, insertLen: 4,    note: "electronics" },
  { id: "m2_5", label: "M2.5", d: 2.5, pitch: 0.45, clearance: 2.9, bite: 2.05, head: 4.7,  insertBore: 3.5, insertLen: 5.8,  note: "RPi / hobby boards" },
  { id: "m3",   label: "M3",   d: 3,   pitch: 0.5,  clearance: 3.4, bite: 2.5,  head: 5.6,  insertBore: 4.0, insertLen: 5.7,  note: "the maker staple" },
  { id: "m4",   label: "M4",   d: 4,   pitch: 0.7,  clearance: 4.5, bite: 3.3,  head: 7.5,  insertBore: 5.6, insertLen: 8.1 },
  { id: "m5",   label: "M5",   d: 5,   pitch: 0.8,  clearance: 5.5, bite: 4.2,  head: 9.2,  insertBore: 6.4, insertLen: 9.5 },
  { id: "m6",   label: "M6",   d: 6,   pitch: 1.0,  clearance: 6.6, bite: 5.0,  head: 11,   insertBore: 8.0, insertLen: 12.7, note: "furniture / rigs" },
  { id: "no6",  label: "#6 wood",  d: 3.5, pitch: 1.3, clearance: 4.0, bite: 2.5, head: 6.8, note: "wall anchors & wood" },
  { id: "no8",  label: "#8 wood",  d: 4.2, pitch: 1.4, clearance: 4.8, bite: 2.9, head: 8.0, note: "wall anchors & wood" },
];

export interface ScrewCut {
  minor: number;       // bore
  major: number;       // rib crest diameter (== minor when unthreaded)
  pitch: number;       // 0 = no ribs
  depth: number;       // 0 = through
  countersink: number; // head cone diameter; 0 = none
  what: string;        // receipt text
}

export function screwCut(s: ScrewSize, fit: ScrewFit, countersink: boolean): ScrewCut {
  const cal = boreNote(); // "" unless the user has measured their printer
  if (fit === "insert" && s.insertBore) {
    const d = bore(s.insertBore);
    const depth = (s.insertLen ?? 6) + 1.5;
    return {
      minor: d, major: d, pitch: 0, depth, countersink: 0,
      what: `${s.label} heat-set insert pocket (⌀${d} × ${depth.toFixed(1)} mm)${cal}`,
    };
  }
  if (fit === "bite") {
    const depth = Math.min(14, Math.round(3 * s.d * 10) / 10);
    const d = bore(s.bite);
    // Only the bore moves with the printer. The rib crest stays at nominal thread
    // diameter — that's the material the screw actually cuts, and letting it grow
    // with the allowance would trade the whole point of a bite hole for a loose one.
    return {
      minor: d, major: Math.max(s.d, d), pitch: s.pitch, depth, countersink: 0,
      what: `${s.label} thread-bite hole (⌀${d} bore, ribbed to ⌀${s.d}, ${depth} mm deep)${cal}`,
    };
  }
  const d = bore(s.clearance);
  return {
    minor: d, major: d, pitch: 0, depth: 0,
    countersink: countersink ? bore(s.head + 0.6) : 0,
    what: `${s.label} clearance hole (⌀${d}, through${countersink ? ", countersunk" : ""})${cal}`,
  };
}
