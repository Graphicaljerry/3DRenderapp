// Neodymium DISC magnets — the sizes makers actually buy. ⌀×height in mm; the
// catalogue mirrors what sells in bulk for print projects (miniatures → boxes →
// cosplay helmets): 3×1/5×2 for tiny latches and minis, 6×2/6×3 the general-purpose
// workhorse, 8×3 and 10×2/10×3 the cosplay-helmet staples (visors, removable
// panels, mandibles), 12×3/15×3 for lids that carry weight, 20×3 for load-bearing
// mounts. Pull strengths at N35–N52 run roughly 0.5 kg (5×2) → 2–3 kg (10×3) →
// 6 kg+ (20×3), steel-on-magnet.
//
// Fit numbers (community consensus, PLA/PETG FDM): a press-in pocket wants about
// +0.1 mm on the diameter — snug enough to hold without glue, loose enough to seat
// with a thumb; a drop of CA wants +0.2–0.3 mm all around plus a little extra
// depth so the glue has somewhere to live. Depth = magnet height + ~0.1 mm keeps
// the face flush (magnets grip through plastic fine); glue fits sink an extra
// ~0.3 mm. First layer of a pocket printed over a magnet bridges best when the
// magnet sits ≥0.5 mm below the surface — that's the pair-print trick, not this
// tool's flush pockets, but the depth field accepts either.

import { bore } from "./fit";

export type MagnetSize = { d: number; h: number; note?: string };

export const MAGNET_SIZES: MagnetSize[] = [
  { d: 3, h: 1, note: "miniatures" },
  { d: 5, h: 2, note: "small latches" },
  { d: 6, h: 2, note: "general purpose" },
  { d: 6, h: 3 },
  { d: 8, h: 2 },
  { d: 8, h: 3, note: "helmet panels" },
  { d: 10, h: 2, note: "helmet visors" },
  { d: 10, h: 3 },
  { d: 12, h: 2 },
  { d: 12, h: 3, note: "boxes & lids" },
  { d: 15, h: 3 },
  { d: 20, h: 3, note: "load-bearing" },
];

export type MagnetFit = "press" | "glue";

/** Pocket dimensions for a magnet + fit: press-in = friction hold, glue-in = room for CA.
 *  Press/glue is the user's intent and stays fixed; the diameter then goes through
 *  bore() so the printed pocket actually lands there. Depth is left alone — Z on an
 *  FDM machine is layer-accurate, and the coupon only measures XY holes. */
export function magnetPocket(size: MagnetSize, fit: MagnetFit): { diameter: number; depth: number } {
  return fit === "press"
    ? { diameter: bore(size.d + 0.1), depth: size.h + 0.1 }
    : { diameter: bore(size.d + 0.25), depth: size.h + 0.4 };
}

export const fmtMagnet = (s: MagnetSize) => `${s.d}×${s.h}`;
