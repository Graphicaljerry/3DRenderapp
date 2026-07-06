import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Evaluator, Brush, SUBTRACTION } from "three-bvh-csg";
import { repairGeometry } from "../print/repair";

const csgMat = new THREE.MeshStandardMaterial();

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

/** Centre a Z-up geometry in XY and sit it flat on the bed; return its dims. */
function floorAndSize(geom: THREE.BufferGeometry): ExtrudeResult {
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  geom.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  geom.computeBoundingBox();
  const size = new THREE.Vector3();
  geom.boundingBox!.getSize(size);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { geometry: geom, dims: { x: r1(size.x), y: r1(size.y), z: r1(size.z) } };
}

function largestShape(shapes: THREE.Shape[]): THREE.Shape {
  let best = shapes[0], bestArea = -1;
  for (const s of shapes) {
    const box = new THREE.Box2();
    for (const p of s.extractPoints(6).shape) box.expandByPoint(p);
    const size = new THREE.Vector2();
    box.getSize(size);
    const area = size.x * size.y;
    if (area > bestArea) { bestArea = area; best = s; }
  }
  return best;
}

/** Revolve the SVG's silhouette around its LEFT edge (a lathe). Best for side
 *  profiles — vases, knobs, bottles. `sizeMm` sets the finished height. */
export function revolveSvg(svgText: string, opts: { sizeMm: number; segments?: number }): ExtrudeResult {
  const shapes = shapesOf(svgText);
  if (!shapes.length) throw new Error("No filled shapes found — give the SVG a solid fill.");
  const pts = largestShape(shapes).extractPoints(16).shape;
  const box = new THREE.Box2();
  for (const p of pts) box.expandByPoint(p);
  const size = new THREE.Vector2(); box.getSize(size);
  const scale = opts.sizeMm / (size.y || 1); // scale so height = sizeMm

  // Outer silhouette: max radius (distance from the left edge) per height band.
  const N = 160, yMax = opts.sizeMm;
  const rad: number[] = new Array(N).fill(NaN);
  for (const p of pts) {
    const r = (p.x - box.min.x) * scale, y = (p.y - box.min.y) * scale;
    const bi = Math.min(N - 1, Math.max(0, Math.round((y / yMax) * (N - 1))));
    rad[bi] = Math.max(isNaN(rad[bi]) ? 0 : rad[bi], r);
  }
  // Fill gaps by linear interpolation between known bands.
  let last = 0;
  for (let i = 0; i < N; i++) if (!isNaN(rad[i])) { last = rad[i]; break; }
  for (let i = 0; i < N; i++) {
    if (isNaN(rad[i])) {
      let j = i; while (j < N && isNaN(rad[j])) j++;
      const next = j < N ? rad[j] : last;
      rad[i] = last + (next - last) * ((i - (i - 1)) / Math.max(1, j - (i - 1)));
    } else last = rad[i];
  }

  // Radius 0 at the endpoints → true pole caps (a fan to a single axis point),
  // which stays manifold. A tiny positive interior floor avoids self-touching.
  const EPS = 0.02;
  const profile: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  for (let i = 0; i < N; i++) profile.push(new THREE.Vector2(Math.max(EPS, rad[i]), (i / (N - 1)) * yMax));
  profile.push(new THREE.Vector2(0, yMax));

  let geom: THREE.BufferGeometry = new THREE.LatheGeometry(profile, Math.max(24, opts.segments ?? 96));
  geom.rotateX(Math.PI / 2); // lathe spins around Y; make Y our Z-up
  // Weld the pole fans (coincident axis vertices) so the caps read as manifold.
  geom = repairGeometry(geom).geometry;
  return floorAndSize(geom);
}

/** Raise (or recess) the SVG art on a base plate. Perfect for logo coasters,
 *  tags, stamps, nameplates. */
export function embossSvg(svgText: string, opts: { sizeMm: number; baseMm: number; reliefMm: number; recessed: boolean }): ExtrudeResult {
  const overlap = 0.4;
  const art = extrudeSvg(svgText, { sizeMm: opts.sizeMm, heightMm: opts.reliefMm + overlap }); // centred, z 0..relief+overlap
  const margin = Math.max(3, opts.sizeMm * 0.08);
  const base = new THREE.BoxGeometry(art.dims.x + 2 * margin, art.dims.y + 2 * margin, opts.baseMm);
  base.translate(0, 0, opts.baseMm / 2); // z 0..baseMm
  const artGeom = art.geometry.clone();

  if (!opts.recessed) {
    // RAISED: sink the art `overlap` into the base and rise reliefMm above, then
    // merge the two solids WITHOUT a boolean. Each stays individually watertight
    // (so the manifold check passes); the slicer unions the overlap at print time
    // — a standard, robust move that avoids CSG's T-junctions entirely.
    artGeom.translate(0, 0, opts.baseMm - overlap);
    const merged = mergeGeometries([posOnly(base), posOnly(artGeom)], false);
    if (!merged) throw new Error("Couldn't assemble the emboss.");
    return floorAndSize(merged);
  }

  // RECESSED: subtract the art pocket from the base top — a real boolean. Weld +
  // fill the T-junctions three-bvh-csg leaves so it still reads watertight.
  artGeom.translate(0, 0, opts.baseMm - opts.reliefMm);
  const baseBrush = new Brush(base, csgMat); baseBrush.updateMatrixWorld(true);
  const artBrush = new Brush(artGeom, csgMat); artBrush.updateMatrixWorld(true);
  const result = new Evaluator().evaluate(baseBrush, artBrush, SUBTRACTION);
  const repaired = repairGeometry(result.geometry.clone());
  return floorAndSize(repaired.geometry);
}

/** Non-indexed, position-only clone — ready for a clean mergeGeometries. */
function posOnly(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const n of Object.keys(out.attributes)) if (n !== "position") out.deleteAttribute(n);
  return out;
}
