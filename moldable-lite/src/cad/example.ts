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

// Shown in the Source tab after a STEP import: renders the imported solid as-is
// and doubles as documentation for hand-editing it.
export const IMPORT_PASSTHROUGH = `const defaultParams = {};
function main(replicad, params, imported) {
  // \`imported\` is your STEP file, loaded as an editable solid.
  // Ask the AI to change it — or edit here, e.g.:
  //   return imported.cut(replicad.makeCylinder(2.1, 100, [10, 0, -1], [0, 0, 1]));
  return imported;
}`;

// Canned replicad program for the PRIMARY engine's example (same L-bracket idea).
// Declares defaultParams so the example also demonstrates the live sliders.
export const EXAMPLE_REPLICAD = `const defaultParams = { width: 60, depth: 40, thickness: 4, wallHeight: 30, holeDiameter: 5 };
function main(replicad, params) {
  const p = { ...defaultParams, ...params };
  const { drawRoundedRectangle } = replicad;
  let base = drawRoundedRectangle(p.width, p.depth, 3)
    .sketchOnPlane("XY")
    .extrude(p.thickness);
  const hole = (x) =>
    replicad.makeCylinder(p.holeDiameter / 2, p.thickness + 8, [x, 6, -1], [0, 0, 1]);
  base = base.cut(hole(-p.width / 3)).cut(hole(p.width / 3));
  const wall = drawRoundedRectangle(p.width, p.wallHeight, 2)
    .sketchOnPlane("XZ", -(p.depth / 2 - p.thickness / 2))
    .extrude(p.thickness);
  return base.fuse(wall);
}`;
