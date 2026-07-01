import type { ModelSpec } from "./spec";

// Canned model so the viewer + STL export can be tested with ZERO API spend.
// An L-bracket: base plate + upright wall, with two 5 mm mounting holes.
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
