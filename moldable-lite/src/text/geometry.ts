// Text → printable solid. Outlines come from opentype (so any TTF/OTF/woff2 works),
// tessellation and the bevel come from three's ExtrudeGeometry — which is exactly the
// bevel/extrude control a designer expects from a 3D text tool.
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Font } from "opentype.js";
import { reverseWinding } from "../three/winding";

/** How far a chord may run before the curve gets another vertex, in mm.
 *
 *  ExtrudeGeometry's own `curveSegments` divides every curve into the same fixed count,
 *  whatever its length — and font outlines are wildly uneven: an OTF (Inter) draws a
 *  whole bowl of a "D" as one or two long cubics, a TTF (Poppins) draws it as a dozen
 *  short quadratics. A fixed count leaves the long cubics as visible polygons (measured
 *  before this: p95 facet angle 22.7°, worst 59.8° — real corners in the slicer, not a
 *  shading artifact) while wasting points on the short quads. Sampling by ARC LENGTH
 *  makes smoothness a physical property of the print instead: a 0.3mm chord on a 2mm
 *  glyph corner deviates ~6µm from the true curve — an order of magnitude under a
 *  0.05mm layer line — and letters scaled up simply spend more vertices. */
const CHORD_MM = 0.3;

/** How far a letter sinks into the surface it stands on, in mm. Two layer lines at
 *  0.12mm — enough that a slicer always finds overlapping material to fuse, small
 *  enough to be invisible. Clamped against thin text in buildTextGeometry. */
const BITE_MM = 0.25;

/** Re-sample a shape's curves by arc length so every chord is ≈CHORD_MM long. The
 *  result carries straight lines only — ExtrudeGeometry then tessellates exactly what
 *  is here, nothing resampled behind our back. */
function flattenShape(shape: THREE.Shape): THREE.Shape {
  const flat = (path: THREE.Path): THREE.Vector2[] => {
    const pts: THREE.Vector2[] = [];
    for (const curve of path.curves) {
      let n = 1;
      if (!(curve as THREE.Curve<THREE.Vector2> & { isLineCurve?: boolean }).isLineCurve) {
        // Two criteria, take the stricter. Length alone under-samples TIGHT curves: a
        // 0.5mm corner round is barely 1mm long, so 0.3mm chords turn ~34° each — a
        // visible knuckle. Estimating the total turn from three tangents (slightly low
        // on an S-curve, close enough for glyphs) caps every step at ~12° regardless
        // of how small the feature is.
        const byLength = Math.ceil(curve.getLength() / CHORD_MM);
        const t0 = curve.getTangent(0), t1 = curve.getTangent(0.5), t2 = curve.getTangent(1);
        const byTurn = Math.ceil((t0.angleTo(t1) + t1.angleTo(t2)) / (Math.PI / 15));
        n = Math.min(64, Math.max(2, byLength, byTurn));
      }
      const p = curve.getPoints(n);
      for (let i = pts.length ? 1 : 0; i < p.length; i++) pts.push(p[i]); // skip the shared joint
    }
    return pts;
  };
  const out = new THREE.Shape(flat(shape));
  out.holes = shape.holes.map((h) => new THREE.Path(flat(h)));
  return out;
}

export interface TextSpec {
  text: string;
  family: string;
  custom?: boolean; // family refers to a registered file/local font, not Google
  size: number;     // cap height-ish: opentype's fontSize, in mm
  depth: number;    // extrusion, mm
  bevel: number;    // bevel size AND depth, mm; 0 = crisp edge
  spacing: number;  // extra tracking between glyphs, mm
  /** Follow the curve of whatever it is standing on. On means the solid is bent to the
   *  wall's radius and the layer re-seats itself on the surface every time it moves; off
   *  means it stays a flat plaque you can position freely. Pose, not shape, like `roll` —
   *  the builder ignores it and the wrap is applied after. */
  wrap: boolean;
  /** Spin about the face the text lies on, degrees. Pose, not shape — the builder
   *  below ignores it; the Viewer folds it into the placement quaternion. It lives on
   *  the spec so the panel can show it and so it survives retyping the words. */
  roll: number;
}

export const TEXT_DEFAULT: TextSpec = { text: "Text", family: "Inter", size: 12, depth: 3, bevel: 0.4, spacing: 0, roll: 0, wrap: true };

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
  const shapes = svg.paths.flatMap((p) => SVGLoader.createShapes(p)).map(flattenShape);
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
    bevelSegments: 3, // the rim reads round instead of two flat bands
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
  // The base sits slightly BELOW the surface, not exactly on it. A letter placed exactly
  // tangent shares a zero-thickness contact with the wall, and a slicer has nothing to
  // fuse: Bambu sliced "Dry Erase Markers" into scattered floating islands and warned
  // about floating regions, because at every layer the letter's outline merely touched
  // the wall's perimeter instead of overlapping it. A bite makes the union unambiguous
  // for the slicer AND for the CSG in Merge. It comes out of the depth the user asked
  // for, so a letter still stands `depth` proud of the surface.
  const bite = Math.min(BITE_MM, spec.depth * 0.35);
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z - bite);
  smoothTextNormals(g);
  return g;
}

/** Wall shading without the venetian blinds.
 *
 *  ExtrudeGeometry is non-indexed, so `computeVertexNormals()` is flat shading: every
 *  wall quad carries its own normal and a curved glyph renders as a run of lighting
 *  bands, however fine the tessellation (measured: 0% of shared wall positions agreed
 *  on a normal). Creased normals average across neighbours within 40° — the curved
 *  walls become one continuous surface — while anything sharper (the stem of a D, the
 *  arris where wall meets bevel) stays a crisp edge. In place: our text geometry is
 *  always non-indexed, and toCreasedNormals only clones when it must de-index first.
 *
 *  bend.ts calls this after bending/conforming too — moving vertices invalidates
 *  normals, and re-running computeVertexNormals there would re-flatten everything
 *  this just smoothed. */
export function smoothTextNormals(g: THREE.BufferGeometry): void {
  toCreasedNormals(g, THREE.MathUtils.degToRad(40));
}
