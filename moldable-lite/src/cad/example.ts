import type { ModelSpec } from "./spec";

// Canned primitive model so the viewer + STL export work with ZERO API spend
// (also the fallback engine's demo). An L-bracket with mounting holes.
export const EXAMPLE_SPEC: ModelSpec = {
  name: "L-bracket (example)",
  summary: "A 60 × 40 mm L-bracket, 4 mm thick, with a 30 mm upright wall and two 5 mm mounting holes.",
  units: "mm",
  solids: [
    { type: "box", size: [60, 40, 4], pos: [0, 0, 2] },
    { type: "box", size: [60, 4, 30], pos: [0, -18, 15] },
  ],
  cuts: [
    { type: "cylinder", r: 2.5, h: 12, pos: [-20, 6, 2] },
    { type: "cylinder", r: 2.5, h: 12, pos: [20, 6, 2] },
    { type: "cylinder", r: 2.5, h: 12, pos: [0, -18, 22], rot: [90, 0, 0] },
  ],
};

// Canned replicad program for the PRIMARY engine's example (same L-bracket idea).
export const EXAMPLE_REPLICAD = `function main(replicad, params) {
  const { drawRoundedRectangle } = replicad;
  // 60 x 40 base plate, 4mm thick, with two 5mm holes
  let base = drawRoundedRectangle(60, 40, 3)
    .sketchOnPlane("XY")
    .extrude(4);
  const hole = (x) =>
    replicad.makeCylinder(2.5, 12, [x, 6, -1], [0, 0, 1]);
  base = base.cut(hole(-20)).cut(hole(20));
  // 30mm upright wall along the back edge
  const wall = drawRoundedRectangle(60, 30, 2)
    .sketchOnPlane("XZ", -18)
    .extrude(4);
  return base.fuse(wall.translate(0, 0, 0));
}`;
