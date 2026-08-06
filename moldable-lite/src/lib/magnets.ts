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
 *
 *  Depth = magnet height EXACTLY, both fits, so the magnet face lands flush with the
 *  surface — that's what makes it actually grab: magnetic force falls off steeply with
 *  distance, and every tenth of recess is air between the magnet and what it holds.
 *  The fit difference lives in the DIAMETER alone; glue, when used, is a small drop in
 *  the bottom that squeezes up into the side ring. Giving glue its own depth (+0.4)
 *  was how magnets ended up sunk down their own wells, gripping nothing.
 *
 *  The diameter goes through bore() so the printed pocket lands where the chart says;
 *  depth stays uncorrected — Z on an FDM machine is layer-accurate, and the coupon
 *  only measures XY holes. */
/** `seatProud` shaves the pocket SHALLOWER so the magnet stands that far out of the
 *  surface. Dead-flush design meets two real-world minuses — magnets run a whisker
 *  under nominal thickness, printed top surfaces land a whisker low — and the result
 *  is a hair of recess and a weaker pull. The prop-maker fix is 0.1–0.2 mm proud:
 *  the bump vanishes into the joint and the two magnets are guaranteed to touch. */
export function magnetPocket(size: MagnetSize, fit: MagnetFit, seatProud = 0): { diameter: number; depth: number } {
  const depth = Math.max(0.4, Math.round((size.h - seatProud) * 100) / 100);
  return fit === "press"
    ? { diameter: bore(size.d + 0.1), depth }
    : { diameter: bore(size.d + 0.25), depth };
}

export const fmtMagnet = (s: MagnetSize) => `${s.d}×${s.h}`;
