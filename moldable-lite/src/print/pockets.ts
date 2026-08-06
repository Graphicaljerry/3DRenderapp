// Which way do the drilled pockets open in the CURRENT print orientation?
//
// A magnet or screw pocket is a small flat-roofed cylinder, and how it prints is
// decided entirely by which way its opening faces on the plate:
//
//   opening UP       → the flat bottom sits on solid material. Prints clean, no
//                      supports, the magnet drops in from above. The good case.
//   opening SIDEWAYS → the bore's crown is a round overhang. Small diameters mostly
//                      print, but the top of the circle sags into the pocket.
//   opening DOWN     → the pocket's flat interior end is a ceiling bridged over the
//                      full circle. Without slicer supports it droops — and on a
//                      2–3 mm-deep magnet pocket, 0.3 mm of droop is the difference
//                      between a press fit and a magnet that won't seat.
//
// The slicer only knows any of this if the user enables supports; the app knows it
// at design time, from the ops chain alone — no mesh analysis needed.

import * as THREE from "three";
import type { CadOp } from "../engine/types";

export interface PocketFacing {
  up: number;
  side: number;
  down: number;
  total: number;
}

/** Classify every drilled pocket (magnet, screw, custom hole) by the direction its
 *  opening faces after the rotations that were applied SINCE it was drilled. A hole
 *  is cut along −normal, so the opening faces +normal; rotate ops later in the chain
 *  carry the drilled solid — and the hole with it. */
export function pocketFacing(ops: readonly CadOp[] | undefined): PocketFacing | null {
  if (!ops?.length) return null;
  const out: PocketFacing = { up: 0, side: 0, down: 0, total: 0 };
  ops.forEach((op, i) => {
    if (op.type !== "hole" && op.type !== "screw") return;
    if (op.type === "hole" && op.depth === 0) return; // a through hole has no roof
    const n = new THREE.Vector3(...op.normal).normalize();
    for (let j = i + 1; j < ops.length; j++) {
      const r = ops[j];
      if (r.type === "rotate") n.applyAxisAngle(new THREE.Vector3(...r.axis).normalize(), (r.angleDeg * Math.PI) / 180);
    }
    out.total++;
    // 0.5 = 30° above horizontal. Shallower than that and the crown/roof problem is
    // already real; the exact boundary matters less than not calling a droop "fine".
    if (n.z >= 0.5) out.up++;
    else if (n.z <= -0.5) out.down++;
    else out.side++;
  });
  return out.total ? out : null;
}

/** One honest sentence for the gate. Empty when there is nothing to warn about. */
export function pocketAdvice(f: PocketFacing | null): string {
  if (!f || f.side + f.down === 0) return "";
  const bits: string[] = [];
  if (f.down) bits.push(`${f.down} open${f.down === 1 ? "s" : ""} downward — the flat roof over the circle droops without supports`);
  if (f.side) bits.push(`${f.side} open${f.side === 1 ? "s" : ""} sideways — the top of the bore sags slightly`);
  return `${bits.join("; ")}. Enable supports in your slicer, or rotate the model so pockets open upward (right-click a face → rest it on the plate) and they print clean with none.`;
}
