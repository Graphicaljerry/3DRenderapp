import { bootPage, build } from "./lib.mjs";

const probes = {
  // Where does an off-origin solid land? Deduce recenter semantics.
  recenter: `function main(r){ return r.makeCylinder(5, 10, [100, 0, 0], [0,0,1]); }`,
  // XZ sketch: which Y range does extrude(+20) occupy?
  xz: `function main(r){ return r.drawRectangle(10, 10).sketchOnPlane("XZ").extrude(20); }`,
  // YZ sketch: drawing x→? ; asymmetric rect 30 wide (drawing x) × 10 (drawing y), extrude 20.
  yz: `function main(r){ return r.drawRectangle(30, 10).sketchOnPlane("YZ").extrude(20); }`,
  // XY sketch at z-offset 5: does extrude go +Z?
  xyOff: `function main(r){ return r.drawRectangle(10, 10).sketchOnPlane("XY", 5).extrude(20); }`,
  // Disjoint fuse: two separated boxes — does it build + mesh both?
  disjoint: `function main(r){
    const a = r.makeBaseBox(10, 10, 10);
    const b = r.makeBaseBox(10, 10, 20).translate([40, 0, 0]);
    return a.fuse(b);
  }`,
};

const { browser, page } = await bootPage();
for (const [name, code] of Object.entries(probes)) {
  const r = await build(page, code);
  console.log("\n==", name);
  console.log(JSON.stringify(r, null, 1));
}
await browser.close();
