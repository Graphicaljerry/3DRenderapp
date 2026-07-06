import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

// Flat SVG → a printable extruded solid. A designer's native output (an
// Illustrator/Figma vector) becomes a real, dimensioned, Z-up mm part that
// flows through the same viewer / printability / export pipeline as everything
// else. Deterministic — no AI call, exact dimensions.

export interface SvgInfo {
  shapeCount: number;
  /** outline size in the SVG's own units (for aspect / default sizing) */
  w: number;
  h: number;
}

export interface ExtrudeResult {
  geometry: THREE.BufferGeometry;
  dims: { x: number; y: number; z: number };
}

function shapesOf(svgText: string): THREE.Shape[] {
  const data = new SVGLoader().parse(svgText);
  const shapes: THREE.Shape[] = [];
  for (const path of data.paths) for (const s of SVGLoader.createShapes(path)) shapes.push(s);
  return shapes;
}

/** Quick look at an SVG before extruding: how many filled shapes, and the
 *  outline's aspect (so the modal can show the resulting X × Y). */
export function svgInfo(svgText: string): SvgInfo {
  try {
    const shapes = shapesOf(svgText);
    const box = new THREE.Box2();
    for (const shape of shapes) for (const p of shape.extractPoints(8).shape) box.expandByPoint(p);
    const size = new THREE.Vector2();
    if (!box.isEmpty()) box.getSize(size);
    return { shapeCount: shapes.length, w: size.x, h: size.y };
  } catch {
    return { shapeCount: 0, w: 0, h: 0 };
  }
}

/** Extrude the SVG's filled shapes to a solid: `sizeMm` sets the longest side,
 *  `heightMm` the thickness. Result is centred on the bed, Z-up, in millimetres. */
export function extrudeSvg(svgText: string, opts: { sizeMm: number; heightMm: number }): ExtrudeResult {
  const shapes = shapesOf(svgText);
  if (!shapes.length) throw new Error("No filled shapes found — give the SVG solid fills, not just strokes/outlines.");

  let geom: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shapes, { depth: opts.heightMm, bevelEnabled: false, steps: 1 });
  if (geom.index) geom = geom.toNonIndexed();

  // Map the SVG's own units to mm on the longest side (Z/height is left as-is,
  // already in mm because ExtrudeGeometry's depth was heightMm and we don't scale Z).
  geom.computeBoundingBox();
  let bb = geom.boundingBox!;
  const maxSide = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) || 1;
  const s = opts.sizeMm / maxSide;

  // Scale XY to mm and flip SVG's Y-down to our Y-up. The negative Y is a
  // reflection, which inverts triangle winding — undo that so normals face out.
  geom.scale(s, -s, 1);
  reverseWinding(geom);
  geom.computeVertexNormals();

  // Centre in XY and sit flat on the bed.
  geom.computeBoundingBox();
  bb = geom.boundingBox!;
  geom.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);

  geom.computeBoundingBox();
  const size = new THREE.Vector3();
  geom.boundingBox!.getSize(size);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { geometry: geom, dims: { x: r1(size.x), y: r1(size.y), z: r1(size.z) } };
}

/** Swap two vertices of every triangle in a non-indexed buffer to reverse winding. */
function reverseWinding(geom: THREE.BufferGeometry) {
  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let i = 0; i + 8 < a.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = a[i + 3 + k];
      a[i + 3 + k] = a[i + 6 + k];
      a[i + 6 + k] = t;
    }
  }
  pos.needsUpdate = true;
}
