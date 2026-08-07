// Text → printable solid. Outlines come from opentype (so any TTF/OTF/woff2 works),
// tessellation and the bevel come from three's ExtrudeGeometry — which is exactly the
// bevel/extrude control a designer expects from a 3D text tool.
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { Font } from "opentype.js";
import { reverseWinding } from "../three/winding";

export interface TextSpec {
  text: string;
  family: string;
  custom?: boolean; // family refers to a registered file/local font, not Google
  size: number;     // cap height-ish: opentype's fontSize, in mm
  depth: number;    // extrusion, mm
  bevel: number;    // bevel size AND depth, mm; 0 = crisp edge
  spacing: number;  // extra tracking between glyphs, mm
  /** Spin about the face the text lies on, degrees. Pose, not shape — the builder
   *  below ignores it; the Viewer folds it into the placement quaternion. It lives on
   *  the spec so the panel can show it and so it survives retyping the words. */
  roll: number;
}

export const TEXT_DEFAULT: TextSpec = { text: "Text", family: "Inter", size: 12, depth: 3, bevel: 0.4, spacing: 0, roll: 0 };

/** Build the solid for a spec: lying in XY, extruding toward +Z, centred on the
 *  origin with its BASE at z = 0 — so placing it is "put the origin on the surface,
 *  aim +Z along the normal". */
export function buildTextGeometry(font: Font, spec: TextSpec): THREE.BufferGeometry {
  const upem = font.unitsPerEm || 1000;
  void upem;
  // Per-glyph paths so tracking can be applied; opentype's kerning still applies
  // inside getAdvanceWidth when spacing is 0.
  let x = 0;
  let d = "";
  for (const ch of spec.text) {
    const glyph = font.charToGlyph(ch);
    d += glyph.getPath(x, 0, spec.size).toPathData(3);
    x += (glyph.advanceWidth ?? 0) * (spec.size / (font.unitsPerEm || 1000)) + spec.spacing;
  }
  if (!d) throw new Error("Nothing to build — type some text first.");
  const svg = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
  const shapes = svg.paths.flatMap((p) => SVGLoader.createShapes(p));
  if (!shapes.length) throw new Error("That font gave no outlines for this text.");
  // The bevel eats into the glyph silhouette (bevelSize) — compensate a hair with
  // bevelOffset so thin strokes don't vanish at print size. Clamp bevel to the depth.
  const bevel = Math.max(0, Math.min(spec.bevel, spec.depth / 2 - 0.05));
  const g = new THREE.ExtrudeGeometry(shapes, {
    // ExtrudeGeometry adds bevelThickness at BOTH z-ends, so the straight walls must
    // give up twice the bevel or "Deep: 6" measures 6.8 — depth here means the TOTAL.
    depth: spec.depth - (bevel > 0 ? 2 * bevel : 0),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 8,
  });
  // Font paths are y-down; flip to y-up, then centre XY and rest the base at z=0.
  // The negative Y is a REFLECTION (det = -1), which reverses every triangle's winding
  // — and computeVertexNormals() below would then bake inward-facing normals into the
  // whole solid, so a FrontSide material shows you its interior shell. The SVG/logo
  // path (svg/extrude.ts) does the same flip and repairs it the same way; the text
  // path shipped without the repair.
  g.scale(1, -1, 1);
  reverseWinding(g);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  g.computeVertexNormals();
  return g;
}
